import {
  Injectable,
  ForbiddenException,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../../common/types/actor';
import { WorkspaceService } from './workspace.service';
import { ServiceTicketService } from './service-ticket.service';
import { admin, allowWrite, hasPermission, ownerScope } from './access';
import { runCommand, validateActor, checkVersion, text, id, type Tx } from './command-runner';
import { ticketKeys } from './service-ticket-policy';
import { attachmentInput, MAX_TENANT_ATTACHMENT_BYTES } from './attachment-policy';
const metadata = {
  id: true,
  subjectKind: true,
  subjectId: true,
  filename: true,
  mediaType: true,
  size: true,
  sha256: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  withdrawnAt: true,
  withdrawalReason: true,
} as const;
@Injectable()
export class AttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    private readonly tickets: ServiceTicketService,
  ) {}
  private kind(value: unknown) {
    if (!['projects', 'tasks', 'service-tickets'].includes(String(value)))
      throw new BadRequestException('不支持的附件对象');
    return String(value);
  }
  private async parent(tx: Tx, a: Actor, kind: string, subjectId: number, write = false) {
    await validateActor(tx, a);
    if (write) {
      allowWrite(a);
      if (!hasPermission(a, 'project:update')) throw new ForbiddenException('没有附件编辑权限');
    }
    if (kind === 'service-tickets') {
      await this.tickets.authorizeAttachment(tx, a, subjectId, write);
      return;
    }
    const scoped = await this.workspace.scope(tx, a, kind);
    const task = kind === 'tasks' ? await tx.projectTask.findFirst({ where: { ...scoped, id: subjectId } }) : null;
    const project = await tx.project.findFirst({
      where: {
        tenantId: a.tenantId,
        deletedAt: null,
        ...(kind === 'tasks' ? { id: task?.projectId ?? -1 } : { ...scoped, id: subjectId }),
      },
    });
    if (!project) throw new NotFoundException('附件所属对象不存在或无权访问');
    if (!write) return;
    if (project.status !== 'active' || project.acceptanceState === 'pending')
      throw new ConflictException('仅进行中且未在验收审核的项目可增撤附件');
    if (task && ['done', 'cancelled'].includes(task.status)) throw new ConflictException('已完成任务的附件冻结');
    const manage =
      admin(a) ||
      project.pmId === a.userId ||
      (a.roles.includes('sales_manager') &&
        !!(await tx.project.findFirst({
          where: { tenantId: a.tenantId, id: project.id, ...(await ownerScope(tx, a, 'pmId')) },
          select: { id: true },
        })));
    if (!manage && !(task && task.assigneeId === a.userId))
      throw new ForbiddenException('仅项目管理人或当前任务处理人可增撤附件');
  }
  async list(a: Actor, rawKind: string, rawId: number) {
    const kind = this.kind(rawKind),
      subjectId = id(rawId),
      tx = this.prisma.system;
    await this.parent(tx, a, kind, subjectId);
    // At most100 records per object, including tombstones: complete history without hidden truncation.
    return tx.evidenceAttachment.findMany({
      where: { tenantId: a.tenantId, subjectKind: kind, subjectId },
      select: metadata,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
  private async touch(tx: Tx, a: Actor, kind: string, subjectId: number) {
    const next = (v: Date) => new Date(Math.max(Date.now(), v.getTime() + 1));
    if (kind === 'service-tickets') {
      const row = await tx.serviceTicket.findFirstOrThrow({ where: { tenantId: a.tenantId, id: subjectId } });
      await tx.serviceTicket.update({ where: { id: row.id }, data: { updatedAt: next(row.updatedAt) } });
    } else {
      let projectId = subjectId;
      if (kind === 'tasks') {
        const task = await tx.projectTask.findFirstOrThrow({ where: { tenantId: a.tenantId, id: subjectId } });
        await tx.projectTask.update({ where: { id: task.id }, data: { updatedAt: next(task.updatedAt) } });
        projectId = task.projectId;
      }
      const project = await tx.project.findFirstOrThrow({ where: { tenantId: a.tenantId, id: projectId } });
      await tx.project.update({ where: { id: project.id }, data: { updatedAt: next(project.updatedAt) } });
    }
  }
  async upload(a: Actor, body: Record<string, unknown>) {
    ticketKeys(body, ['requestKey', 'subjectKind', 'subjectId', 'filename', 'contentBase64', 'acknowledged']);
    if (body.acknowledged !== true) throw new BadRequestException('需确认文件来源及尚未进行病毒扫描');
    const kind = this.kind(body.subjectKind),
      subjectId = id(body.subjectId),
      file = attachmentInput(body.filename, body.contentBase64);
    const command = {
      requestKey: body.requestKey,
      subjectKind: kind,
      subjectId,
      filename: file.filename,
      size: file.size,
      sha256: file.sha256,
    };
    return runCommand(
      this.prisma,
      a,
      'attachment.upload',
      command,
      async (tx) => {
        await this.parent(tx, a, kind, subjectId, true);
        const total = await tx.evidenceAttachment.aggregate({ where: { tenantId: a.tenantId }, _sum: { size: true } });
        if ((total._sum.size ?? 0) + file.size > MAX_TENANT_ATTACHMENT_BYTES)
          throw new ConflictException('企业附件保留容量已达16MiB，撤回不释放历史容量');
        if (
          (await tx.evidenceAttachment.count({ where: { tenantId: a.tenantId, subjectKind: kind, subjectId } })) >= 100
        )
          throw new ConflictException('当前对象附件历史已达100条');
        const result = await tx.evidenceAttachment.create({
          data: {
            id: randomUUID(),
            tenantId: a.tenantId,
            subjectKind: kind,
            subjectId,
            filename: file.filename,
            mediaType: file.mediaType,
            size: file.size,
            sha256: file.sha256,
            contentBytes: new Uint8Array(file.bytes),
            createdBy: a.userId,
          },
          select: metadata,
        });
        await this.touch(tx, a, kind, subjectId);
        return result;
      },
      async (tx) => {
        await this.parent(tx, a, kind, subjectId);
      },
    );
  }
  private async require(tx: Tx, a: Actor, attachmentId: string) {
    if (!/^[a-f0-9-]{36}$/i.test(attachmentId)) throw new BadRequestException('附件编号无效');
    const row = await tx.evidenceAttachment.findFirst({
      where: { tenantId: a.tenantId, id: attachmentId },
      select: metadata,
    });
    if (!row) throw new NotFoundException('附件不存在或无权访问');
    await this.parent(tx, a, row.subjectKind, row.subjectId);
    return row;
  }
  async download(a: Actor, attachmentId: string) {
    // Download and its audit share a snapshot with the live record/withdrawal check.
    return this.prisma.system.$transaction(
      async (tx) => {
        const row = await this.require(tx, a, attachmentId);
        if (row.withdrawnAt && !admin(a)) throw new ForbiddenException('已撤回附件仅管理员可追溯下载');
        const binary = await tx.evidenceAttachment.findUniqueOrThrow({
          where: { id: row.id },
          select: { contentBytes: true },
        });
        const bytes = Buffer.from(binary.contentBytes);
        if (bytes.length !== row.size || createHash('sha256').update(bytes).digest('hex') !== row.sha256)
          throw new ConflictException('附件完整性校验失败');
        await tx.auditLog.create({
          data: {
            tenantId: a.tenantId,
            userId: a.userId,
            action: 'attachment.download',
            objectType: 'attachment',
            afterData: {
              attachmentId: row.id,
              subjectKind: row.subjectKind,
              subjectId: row.subjectId,
              sha256: row.sha256,
              withdrawn: !!row.withdrawnAt,
            },
          },
        });
        return { ...row, contentBase64: bytes.toString('base64') };
      },
      { isolationLevel: 'Serializable', timeout: 15000 },
    );
  }
  async withdraw(a: Actor, attachmentId: string, body: Record<string, unknown>) {
    ticketKeys(body, ['requestKey', 'expectedUpdatedAt', 'reason']);
    return runCommand(
      this.prisma,
      a,
      'attachment.withdraw',
      { ...body, attachmentId },
      async (tx) => {
        const row = await this.require(tx, a, attachmentId);
        await this.parent(tx, a, row.subjectKind, row.subjectId, true);
        if (row.createdBy !== a.userId && !admin(a)) throw new ForbiddenException('仅上传人或管理员可撤回');
        checkVersion(row, body.expectedUpdatedAt);
        if (row.withdrawnAt) throw new ConflictException('附件已经撤回');
        const result = await tx.evidenceAttachment.update({
          where: { id: row.id },
          data: {
            withdrawnAt: new Date(),
            withdrawalReason: text(body.reason, '撤回原因', 1000),
            updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)),
          },
          select: metadata,
        });
        await this.touch(tx, a, row.subjectKind, row.subjectId);
        return result;
      },
      async (tx) => {
        await this.require(tx, a, attachmentId);
      },
    );
  }
}
