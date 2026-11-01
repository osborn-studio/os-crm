import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../../common/types/actor';
import { WorkspaceService } from './workspace.service';
import { admin } from './access';
import { checkVersion, id, text, json, runCommand, type Tx } from './command-runner';
import {
  ledgerWriter,
  ledgerKeys,
  ledgerMoney,
  ledgerDate,
  ledgerStamp,
  referenceKey,
  receiptBalance,
  contractBalances,
  financeEventsForActor,
  receiptSnapshot,
  financeAuditReader,
} from './finance-policy';
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}
  async list(a: Actor) {
    const tx = this.prisma.system;
    const rows = await tx.receipt.findMany({
      where: await this.workspace.scope(tx, a, 'receipts'),
      orderBy: { id: 'desc' },
      take: 100,
      select: {
        id: true,
        receiptNo: true,
        customerId: true,
        contractId: true,
        amount: true,
        allocatedAmount: true,
        unallocatedAmount: true,
        receiptDate: true,
        status: true,
        ledgerManaged: true,
        createdBy: true,
        replacesId: true,
        updatedAt: true,
      },
    });
    const names = new Map(
      (
        await tx.customer.findMany({
          where: { tenantId: a.tenantId, id: { in: rows.map((r) => r.customerId) } },
          select: { id: true, name: true },
        })
      ).map((c) => [c.id, c.name]),
    );
    return rows.map(({ replacesId, ...r }) => ({
      ...r,
      ...(financeAuditReader(a) ? { replacesId } : {}),
      customerName: names.get(r.customerId) ?? '历史客户',
    }));
  }
  private async receipt(tx: Tx, a: Actor, receiptId: number) {
    const r = await tx.receipt.findFirst({
      where: { ...(await this.workspace.scope(tx, a, 'receipts')), id: receiptId },
    });
    if (!r) throw new NotFoundException('收款不存在或无权访问');
    return r;
  }
  async detail(a: Actor, receiptId: number) {
    const tx = this.prisma.system,
      r = await this.receipt(tx, a, receiptId);
    const allocations = await tx.receiptAllocation.findMany({
      where: { tenantId: a.tenantId, receiptId },
      orderBy: { id: 'desc' },
      take: 100,
    });
    const events = await tx.financeEvent.findMany({
      where: { tenantId: a.tenantId, receiptId },
      orderBy: { id: 'desc' },
      take: 100,
    });
    return {
      id: r.id,
      customerName:
        (await tx.customer.findFirst({ where: { tenantId: a.tenantId, id: r.customerId }, select: { name: true } }))
          ?.name ?? '历史客户',
      receiptNo: r.receiptNo,
      customerId: r.customerId,
      contractId: r.contractId,
      contract:
        admin(a) && r.contractId
          ? await tx.contract.findFirst({
              where: { tenantId: a.tenantId, id: r.contractId },
              select: { id: true, contractNo: true, name: true, status: true, customerId: true },
            })
          : null,
      amount: r.amount,
      allocatedAmount: r.allocatedAmount,
      unallocatedAmount: r.unallocatedAmount,
      receiptDate: r.receiptDate,
      serialNo: r.ledgerManaged ? r.serialNo : null,
      status: r.status,
      ledgerManaged: r.ledgerManaged,
      createdBy: r.createdBy,
      confirmedBy: r.confirmedBy,
      updatedAt: r.updatedAt,
      allocations,
      events: financeEventsForActor(a, events),
      previous:
        financeAuditReader(a) && r.replacesId
          ? await tx.receipt.findFirst({
              where: { tenantId: a.tenantId, id: r.replacesId },
              select: { id: true, receiptNo: true, status: true },
            })
          : null,
      replacement: financeAuditReader(a)
        ? await tx.receipt.findFirst({
            where: { tenantId: a.tenantId, replacesId: r.id },
            select: { id: true, receiptNo: true, status: true },
          })
        : null,
      canCorrect:
        admin(a) &&
        r.ledgerManaged &&
        r.allocatedAmount.eq(0) &&
        !!(await tx.receiptVoucher.findFirst({
          where: { tenantId: a.tenantId, currentReceiptId: r.id },
          select: { currentReceiptId: true },
        })),
    };
  }
  async plans(a: Actor) {
    const tx = this.prisma.system;
    return tx.paymentPlan.findMany({
      where: { ...(await this.workspace.scope(tx, a, 'payment-plans')), status: { not: 'cancelled' } },
      select: {
        id: true,
        planNo: true,
        contractId: true,
        amount: true,
        receivedAmount: true,
        outstandingAmount: true,
        dueDate: true,
        status: true,
        updatedAt: true,
        contract: { select: { customerId: true, contractNo: true } },
      },
      orderBy: { id: 'desc' },
      take: 100,
    });
  }
  private async event(tx: Tx, a: Actor, receiptId: number, kind: string, note: string, evidence: unknown) {
    const u = await tx.user.findFirst({ where: { tenantId: a.tenantId, id: a.userId }, select: { name: true } });
    await tx.financeEvent.create({
      data: {
        tenantId: a.tenantId,
        receiptId,
        actorId: a.userId,
        kind,
        note,
        evidence: json({ actorName: u?.name, ...(evidence as Record<string, unknown>) }),
      },
    });
  }
  async create(a: Actor, body: Record<string, unknown>) {
    ledgerWriter(a);
    ledgerKeys(body, ['requestKey', 'customerId', 'contractId', 'amount', 'receiptDate', 'reference', 'note']);
    const customerId = id(body.customerId),
      amount = ledgerMoney(body.amount),
      receiptDate = ledgerDate(body.receiptDate),
      reference = text(body.reference, '外部到账凭据编号', 50),
      note = text(body.note, '登记依据', 1000);
    return runCommand(this.prisma, a, 'finance.receipt.register', body, async (tx) => {
      if (
        !(await tx.customer.findFirst({
          where: { ...(await this.workspace.scope(tx, a, 'customers')), id: customerId },
        }))
      )
        throw new NotFoundException('客户不可用');
      let contractId: number | null = null;
      if (body.contractId !== undefined && body.contractId !== null) {
        contractId = id(body.contractId);
        const c = await contractBalances(tx, a.tenantId, contractId);
        if (c.customerId !== customerId) throw new BadRequestException('合同与客户不符');
      }
      if (await tx.receipt.findFirst({ where: { tenantId: a.tenantId, referenceKey: referenceKey(reference) } }))
        throw new ConflictException('该凭据已登记，含已作废历史，不可重复录入');
      const legacyReferences = await tx.receipt.findMany({
        where: { tenantId: a.tenantId, referenceKey: null, serialNo: { not: null } },
        select: { serialNo: true },
      });
      if (legacyReferences.some((r) => r.serialNo && referenceKey(r.serialNo) === referenceKey(reference)))
        throw new ConflictException('该凭据已有历史登记，请先人工核对，不可重复录入');
      const r = await tx.receipt.create({
        data: {
          tenantId: a.tenantId,
          receiptNo: 'SK' + randomUUID().replaceAll('-', '').slice(0, 24),
          customerId,
          contractId,
          amount,
          unallocatedAmount: amount,
          receiptDate,
          serialNo: reference,
          referenceKey: referenceKey(reference),
          ledgerManaged: true,
          status: 'draft',
          createdBy: a.userId,
          remark: note,
        },
      });
      await tx.receiptVoucher.create({
        data: {
          tenantId: a.tenantId,
          referenceKey: referenceKey(reference),
          originalReceiptId: r.id,
          currentReceiptId: r.id,
        },
      });
      await this.event(tx, a, r.id, 'registered', note, {
        amount: amount.toFixed(2),
        reference,
        customerId,
        contractId,
      });
      return { id: r.id };
    });
  }
  async correct(a: Actor, receiptId: number, body: Record<string, unknown>) {
    ledgerWriter(a);
    ledgerKeys(body, ['requestKey', 'expectedUpdatedAt', 'customerId', 'contractId', 'amount', 'receiptDate', 'note']);
    const customerId = id(body.customerId),
      amount = ledgerMoney(body.amount),
      receiptDate = ledgerDate(body.receiptDate),
      note = text(body.note, '更正原因及凭据说明', 1000);
    if (!Object.hasOwn(body, 'contractId')) throw new BadRequestException('更正须明确绑定合同编号或null（不绑定）');
    const contractId = body.contractId === null ? null : id(body.contractId);
    return runCommand(this.prisma, a, 'finance.receipt.correct', { ...body, receiptId }, async (tx) => {
      const old = await this.receipt(tx, a, receiptId);
      checkVersion(old, body.expectedUpdatedAt);
      if (!old.ledgerManaged || !old.serialNo || !['draft', 'confirmed', 'voided'].includes(old.status))
        throw new ConflictException('该收款不能通过本地台账更正');
      await receiptBalance(tx, old);
      if (
        old.allocatedAmount.gt(0) ||
        (await tx.receiptAllocation.count({ where: { tenantId: a.tenantId, receiptId: old.id, active: true } }))
      )
        throw new ConflictException('请先撤销全部有效核销，再更正登记');
      const voucher = await tx.receiptVoucher.findFirst({ where: { tenantId: a.tenantId, currentReceiptId: old.id } });
      if (!voucher || voucher.referenceKey !== referenceKey(old.serialNo))
        throw new ConflictException('凭据已被更正或来源记录不完整，请查看当前登记');
      if (
        old.contractId &&
        (await tx.contractChange.count({
          where: { tenantId: a.tenantId, contractId: old.contractId, status: 'pending' },
        }))
      )
        throw new ConflictException('原合同变更审批中，暂不能更正绑定');
      const customer = await tx.customer.findFirst({
        where: { ...(await this.workspace.scope(tx, a, 'customers')), id: customerId },
        select: { id: true, name: true },
      });
      if (!customer) throw new NotFoundException('更正后的客户不可用');
      let nextContractNo: string | null = null;
      if (contractId !== null) {
        const c = await contractBalances(tx, a.tenantId, contractId);
        if (c.customerId !== customerId) throw new BadRequestException('更正后的客户与合同不符');
        nextContractNo = c.contractNo;
      }
      if (
        old.status !== 'voided' &&
        old.customerId === customerId &&
        old.contractId === contractId &&
        old.amount.eq(amount) &&
        old.receiptDate.getTime() === receiptDate.getTime()
      )
        throw new BadRequestException('没有实际登记变更；若需重新开立已作废登记，请填写原因');
      const next = await tx.receipt.create({
        data: {
          tenantId: a.tenantId,
          receiptNo: 'SK' + randomUUID().replaceAll('-', '').slice(0, 24),
          ledgerManaged: true,
          replacesId: old.id,
          customerId,
          contractId,
          amount,
          unallocatedAmount: amount,
          receiptDate,
          serialNo: old.serialNo,
          status: 'draft',
          createdBy: a.userId,
          remark: note,
        },
      });
      await tx.receipt.update({
        where: { id: old.id },
        data: {
          status: 'voided',
          unallocatedAmount: 0,
          voidReason: old.status === 'voided' ? old.voidReason : '登记更正：' + note.slice(0, 190),
          voidedAt: old.voidedAt ?? new Date(),
          updatedAt: ledgerStamp(old.updatedAt),
        },
      });
      const moved = await tx.receiptVoucher.updateMany({
        where: { tenantId: a.tenantId, referenceKey: voucher.referenceKey, currentReceiptId: old.id },
        data: { currentReceiptId: next.id, updatedAt: ledgerStamp(voucher.updatedAt) },
      });
      if (moved.count !== 1) throw new ConflictException('凭据当前登记已变化，请刷新');
      const oldCustomer = await tx.customer.findFirst({
        where: { tenantId: a.tenantId, id: old.customerId },
        select: { name: true },
      });
      const oldContract = old.contractId
        ? await tx.contract.findFirst({
            where: { tenantId: a.tenantId, id: old.contractId },
            select: { contractNo: true },
          })
        : null;
      const evidence = {
        originalReceiptId: voucher.originalReceiptId,
        sourceReceiptId: old.id,
        replacementReceiptId: next.id,
        reference: old.serialNo,
        before: {
          ...receiptSnapshot(old),
          customerName: oldCustomer?.name ?? '历史客户',
          contractNo: oldContract?.contractNo ?? null,
        },
        after: { ...receiptSnapshot(next), customerName: customer.name, contractNo: nextContractNo },
      };
      await this.event(tx, a, old.id, 'correction.replaced', note, evidence);
      await this.event(tx, a, next.id, 'correction.registered', note, evidence);
      return { id: next.id, sourceId: old.id, action: 'correct' };
    });
  }
  async command(a: Actor, receiptId: number, action: string, body: Record<string, unknown>) {
    ledgerWriter(a);
    if (action === 'correct') return this.correct(a, receiptId, body);
    if (!['confirm', 'allocate', 'reverse', 'void'].includes(action)) throw new BadRequestException('不支持的台账操作');
    ledgerKeys(body, [
      'requestKey',
      'expectedUpdatedAt',
      'note',
      ...(action === 'allocate'
        ? ['paymentPlanId', 'expectedPlanUpdatedAt', 'amount']
        : action === 'reverse'
          ? ['allocationId', 'expectedPlanUpdatedAt']
          : []),
    ]);
    const note = text(body.note, '复核/核销或撤销依据', 1000);
    return runCommand(this.prisma, a, 'finance.receipt.' + action, { ...body, receiptId }, async (tx) => {
      const r = await this.receipt(tx, a, receiptId);
      checkVersion(r, body.expectedUpdatedAt);
      if (!r.ledgerManaged) throw new ConflictException('历史演示/外部记录为只读，不可从本地台账改写');
      await receiptBalance(tx, r);
      if (action === 'confirm') {
        if (r.status !== 'draft') throw new ConflictException('仅待复核收款可确认');
        if (r.createdBy === a.userId) throw new ForbiddenException('登记人不可复核本人收款，请由另一名管理员处理');
        await tx.receipt.update({
          where: { id: r.id },
          data: {
            status: 'confirmed',
            confirmedBy: a.userId,
            confirmedAt: new Date(),
            updatedAt: ledgerStamp(r.updatedAt),
          },
        });
        await this.event(tx, a, r.id, 'confirmed', note, { amount: r.amount.toFixed(2), registeredBy: r.createdBy });
      } else if (action === 'void') {
        if (!['draft', 'confirmed'].includes(r.status) || r.allocatedAmount.gt(0))
          throw new ConflictException('请先撤销全部有效核销，再作废登记');
        await tx.receipt.update({
          where: { id: r.id },
          data: {
            status: 'voided',
            unallocatedAmount: 0,
            voidReason: note.slice(0, 200),
            voidedAt: new Date(),
            updatedAt: ledgerStamp(r.updatedAt),
          },
        });
        await this.event(tx, a, r.id, 'voided', note, { previousStatus: r.status, amount: r.amount.toFixed(2) });
      } else {
        if (r.status !== 'confirmed') throw new ConflictException('独立复核确认后才能核销或撤销');
        const allocation =
          action === 'reverse'
            ? await tx.receiptAllocation.findFirst({
                where: { tenantId: a.tenantId, receiptId: r.id, id: id(body.allocationId) },
              })
            : null;
        if (action === 'reverse' && (!allocation || !allocation.active))
          throw new ConflictException('核销记录不存在或已经撤销');
        const planId = allocation?.paymentPlanId ?? id(body.paymentPlanId);
        const p = await tx.paymentPlan.findFirst({
          where: { ...(await this.workspace.scope(tx, a, 'payment-plans')), id: planId },
        });
        if (!p || p.status === 'cancelled') throw new NotFoundException('回款计划不可用');
        checkVersion(p, body.expectedPlanUpdatedAt);
        const c = await contractBalances(tx, a.tenantId, p.contractId);
        if (c.customerId !== r.customerId || (r.contractId !== null && r.contractId !== c.id))
          throw new BadRequestException('不能跨客户或跨收款绑定合同核销');
        const amount = allocation?.amount ?? ledgerMoney(body.amount);
        const reverse = action === 'reverse';
        if (!reverse && (amount.gt(r.unallocatedAmount) || amount.gt(p.outstandingAmount)))
          throw new ConflictException('超出未核销收款或计划剩余金额');
        const delta = reverse ? amount.neg() : amount,
          received = p.receivedAmount.add(delta),
          allocated = r.allocatedAmount.add(delta);
        if (received.lt(0) || allocated.lt(0)) throw new ConflictException('余额不支持撤销，请先对账');
        let allocationId = allocation?.id;
        if (reverse)
          await tx.receiptAllocation.update({
            where: { id: allocation!.id },
            data: { active: false, reversedAt: new Date(), reversedBy: a.userId, reverseReason: note },
          });
        else
          allocationId = (
            await tx.receiptAllocation.create({
              data: {
                tenantId: a.tenantId,
                receiptId: r.id,
                paymentPlanId: p.id,
                amount,
                allocatedBy: a.userId,
                remark: note.slice(0, 200),
              },
            })
          ).id;
        await tx.receipt.update({
          where: { id: r.id },
          data: {
            allocatedAmount: allocated,
            unallocatedAmount: r.amount.sub(allocated),
            updatedAt: ledgerStamp(r.updatedAt),
          },
        });
        await tx.paymentPlan.update({
          where: { id: p.id },
          data: {
            receivedAmount: received,
            outstandingAmount: p.amount.sub(received),
            status: received.eq(p.amount) ? 'completed' : received.gt(0) ? 'partial' : 'pending',
            updatedAt: ledgerStamp(p.updatedAt),
          },
        });
        await tx.contract.update({
          where: { id: c.id },
          data: {
            totalReceived: c.totalReceived.add(delta),
            totalOutstanding: c.totalOutstanding.sub(delta),
            updatedAt: ledgerStamp(c.updatedAt),
          },
        });
        await this.event(tx, a, r.id, reverse ? 'allocation.reversed' : 'allocated', note, {
          allocationId,
          paymentPlanId: p.id,
          contractId: c.id,
          amount: amount.toFixed(2),
          before: {
            receiptAllocated: r.allocatedAmount.toFixed(2),
            planReceived: p.receivedAmount.toFixed(2),
            contractReceived: c.totalReceived.toFixed(2),
          },
          after: {
            receiptAllocated: allocated.toFixed(2),
            planReceived: received.toFixed(2),
            contractReceived: c.totalReceived.add(delta).toFixed(2),
          },
        });
      }
      return { id: r.id, action };
    });
  }
}
