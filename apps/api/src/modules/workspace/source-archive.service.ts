import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../../common/types/actor';
import { validateActor } from './command-runner';
import {compareSortValues} from './workspace-sort';

export interface SourceSheet {
  name: string;
  headers: string[];
  rows: { sourceRow: number; cells: (string | number | boolean | null)[] }[];
}
const meta = { id: true, filename: true, sha256: true, size: true, rowCount: true, summary: true, createdAt: true } as const;
function identifier(value: string) {
  if (!/^[a-f0-9-]{36}$/i.test(value)) throw new BadRequestException('资料编号无效');
  return value;
}
export function archiveReader(a: Actor) {
  if (!a.roles.includes('super_admin')) throw new ForbiddenException('原始资料含完整联系及财务信息，仅管理员可读取；业务单据遵守各自数据权限');
}
export const sourceArchiveCapabilities = [
  { id: 'source.archive.list', endpoint: 'GET /source-archives', inputSchema: { type: 'object', additionalProperties: false } },
  { id: 'source.archive.rows', endpoint: 'GET /source-archives/{id}/rows', inputSchema: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, sheet: { type: 'integer', minimum: 0 }, page: { type: 'integer', minimum: 1 }, keyword: { type: 'string', maxLength: 100 },sortBy:{type:'string',pattern:'^(sourceRow|cell:[0-9]{1,3})$'},sortOrder:{enum:['asc','desc']} }, required: ['id'] } },
  { id: 'source.archive.download', endpoint: 'GET /source-archives/{id}/content', inputSchema: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] } },
].map(c => ({ ...c, version: '1.0', effect: 'read', agentEnabled: false, permission: 'super_admin',
  outputSchema: { type: 'object' }, guards: ['live authenticated company-scoped administrator', 'immutable source rows, bounded page', 'original download SHA256 verification'], evidence: ['source file SHA256', 'original worksheet and row', 'business import audit', 'download metadata-only audit'] }));

@Injectable()
export class SourceArchiveService {
  constructor(private readonly prisma: PrismaService) {}
  async list(a: Actor) {
    archiveReader(a);
    return this.prisma.system.$transaction(async tx => {
      await validateActor(tx, a);
      const items = await tx.sourceArchive.findMany({ where: { tenantId: a.tenantId }, select: meta, orderBy: { createdAt: 'desc' }, take: 101 });
      if (items.length > 100) throw new BadRequestException('资料超过100份，请联系管理员分批整理');
      return { items };
    });
  }
  async rows(a: Actor, id: string, q: Record<string, string>) {
    archiveReader(a); identifier(id);
    if (Object.keys(q).some(k => !['sheet', 'page', 'keyword','sortBy','sortOrder'].includes(k))) throw new BadRequestException('资料查询参数无效');
    const sheetIndex = q.sheet ?? '0', pageText = q.page ?? '1';
    if (!/^\d{1,4}$/.test(sheetIndex) || !/^[1-9]\d{0,5}$/.test(pageText) || (q.keyword?.length ?? 0) > 100) throw new BadRequestException('分页或检索参数无效');
    return this.prisma.system.$transaction(async tx => {
      await validateActor(tx, a);
      const archive = await tx.sourceArchive.findFirst({ where: { id, tenantId: a.tenantId }, select: { ...meta, sheets: true } });
      if (!archive) throw new NotFoundException('资料不存在');
      const sheets = archive.sheets as unknown as SourceSheet[], sheet = sheets[Number(sheetIndex)];
      if (!sheet) throw new BadRequestException('工作表不存在');
      const sortBy=q.sortBy??'sourceRow',sortOrder=q.sortOrder??'asc';
      if(!['asc','desc'].includes(sortOrder)||(sortBy!=='sourceRow'&&(!/^cell:\d{1,3}$/.test(sortBy)||Number(sortBy.slice(5))>=sheet.headers.length)))throw new BadRequestException('资料排序字段或方向无效');
      const keyword = (q.keyword ?? '').trim().toLocaleLowerCase(), page = Number(pageText), pageSize = 30;
      const rows = sheet.rows.filter(r => !keyword || r.cells.some(v => String(v ?? '').toLocaleLowerCase().includes(keyword)));
      rows.sort((a,b)=>{const av=sortBy==='sourceRow'?a.sourceRow:a.cells[Number(sortBy.slice(5))],bv=sortBy==='sourceRow'?b.sourceRow:b.cells[Number(sortBy.slice(5))],empty=(v:unknown)=>v==null||v==='';return empty(av)||empty(bv)?(empty(av)&&empty(bv)?0:empty(av)?1:-1):(compareSortValues(av,bv)||a.sourceRow-b.sourceRow)*(sortOrder==='asc'?1:-1);});
      return { archive: { ...archive, sheets: undefined }, sheets: sheets.map(s => ({ name: s.name, count: s.rows.length })), headers: sheet.headers,
        items: rows.slice((page - 1) * pageSize, page * pageSize), meta: { page, pageSize, total: rows.length } };
    });
  }
  async download(a: Actor, id: string) {
    archiveReader(a); identifier(id);
    return this.prisma.system.$transaction(async tx => {
      await validateActor(tx, a);
      const archive = await tx.sourceArchive.findFirst({ where: { tenantId: a.tenantId, id } });
      if (!archive) throw new NotFoundException('资料不存在');
      if (createHash('sha256').update(archive.contentBytes).digest('hex') !== archive.sha256 || archive.contentBytes.length !== archive.size)
        throw new BadRequestException('原始文件校验失败，禁止下载');
      await tx.auditLog.create({ data: { tenantId: a.tenantId, userId: a.userId, action: 'source.archive.download', objectType: 'source-archive', afterData: { id, sha256: archive.sha256 } } });
      return { filename: archive.filename, sha256: archive.sha256, contentBase64: Buffer.from(archive.contentBytes).toString('base64') };
    });
  }
}
