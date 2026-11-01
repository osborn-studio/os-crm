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
    return rows.map((r) => ({ ...r, customerName: names.get(r.customerId) ?? '历史客户' }));
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
      events,
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
      await this.event(tx, a, r.id, 'registered', note, {
        amount: amount.toFixed(2),
        reference,
        customerId,
        contractId,
      });
      return { id: r.id };
    });
  }
  async command(a: Actor, receiptId: number, action: string, body: Record<string, unknown>) {
    ledgerWriter(a);
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
