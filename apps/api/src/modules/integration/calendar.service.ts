import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../../common/types/actor';
import { checkVersion, id, object, runCommand, text, validateActor } from '../workspace/command-runner';
import { allowWrite, requirePermission } from '../workspace/access';
import { statisticsScope } from '../workspace/statistics-scope';
export function exactFields(body: Record<string, unknown>, fields: string[]) {
  object(body);
  if (Object.keys(body).some((key) => !fields.includes(key))) throw new BadRequestException('不允许的日程或同步字段');
}
export function calendarDate(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new BadRequestException('请填写带时区的日程时间');
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (
    new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== value.slice(0, 10) ||
    Number(value.slice(11, 13)) > 23
  )
    throw new BadRequestException('日程日期或时间不存在');
  return new Date(Math.floor(Date.parse(value) / 1000) * 1000);
}
@Injectable()
export class CalendarService {
  constructor(private prisma: PrismaService) {}
  async list(a: Actor, from: unknown, until: unknown, query: Record<string,string> = {}) {
    requirePermission(a, 'actions', 'read');
    const start = calendarDate(from),
      end = calendarDate(until);
    if (end <= start || end.getTime() - start.getTime() > 93 * 86400000)
      throw new BadRequestException('日程查询范围须为1—93天');
    return this.prisma.system.$transaction(async (tx) => {
      await validateActor(tx, a);
      const audience=await statisticsScope(tx,a,query);
      const includeOwn=audience.ownerIds===null||audience.ownerIds.includes(a.userId);
      const items = await tx.calendarEntry.findMany({
        where: { tenantId: a.tenantId, AND:[{OR:[...(includeOwn?[{ownerId:a.userId}]:[]),{origin:'crm_plan',...(audience.ownerIds!==null?{ownerId:{in:audience.ownerIds}}:{})}]}], OR: [{ startsAt: { gte: start, lt: end } }, { startsAt: { lt: start }, endsAt: { gt: start } }] },
        orderBy: { startsAt: 'asc' },
        take: 5001,
      });
      if (items.length > 5000) throw new BadRequestException('日程超过5000条，请缩小时间或人员范围');
      const people=await tx.user.findMany({where:{tenantId:a.tenantId,id:{in:[...new Set(items.map(e=>e.ownerId))]}},select:{id:true,name:true}});
      return { items:items.map(e=>({...e,ownerName:people.find(p=>p.id===e.ownerId)?.name??'历史负责人'})), audience, timeZone: 'Asia/Shanghai' };
    });
  }
  save(a: Actor, entryId: number | null, body: Record<string, unknown>) {
    if (entryId !== null) id(entryId);
    allowWrite(a);
    requirePermission(a, 'actions', entryId !== null ? 'update' : 'create');
    exactFields(body, ['requestKey', 'expectedUpdatedAt', 'data']);
    const data = object(body.data);
    exactFields(data, ['title', 'description', 'location', 'startsAt', 'endsAt', 'freeBusy', 'status']);
    const title = text(data.title, '日程主题', 200),
      startsAt = calendarDate(data.startsAt),
      endsAt = calendarDate(data.endsAt);
    if (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 31 * 86400000)
      throw new BadRequestException('日程结束须晚于开始，单次不超过31天');
    const description = data.description ?? '',
      location = data.location ?? '';
    if (
      typeof description !== 'string' ||
      description.length > 2000 ||
      typeof location !== 'string' ||
      location.length > 300
    )
      throw new BadRequestException('描述或地点超出范围');
    const freeBusy = data.freeBusy ?? 'busy',
      status = data.status ?? 'scheduled';
    if (!['busy', 'free'].includes(String(freeBusy)) || !['scheduled', 'cancelled'].includes(String(status)))
      throw new BadRequestException('日程状态无效');
    return runCommand(
      this.prisma,
      a,
      entryId ? 'calendar.update@1.0' : 'calendar.create@1.0',
      { ...body, entryId },
      async (tx) => {
        let updatedAt: Date | undefined;
        if (entryId) {
          const prior = await tx.calendarEntry.findFirst({
            where: { id: id(entryId), tenantId: a.tenantId, ownerId: a.userId },
          });
          if (!prior) throw new NotFoundException('日程不存在或不属于本人');
          if (prior.origin === 'dingtalk') throw new BadRequestException('钉钉来源日程请在钉钉修改后同步，避免修改会议参与人或重复创建');
          checkVersion(prior, body.expectedUpdatedAt);
          updatedAt = new Date(Math.max(Date.now(), prior.updatedAt.getTime() + 1));
        }
        const fields = {
          title,
          description,
          location,
          startsAt,
          endsAt,
          freeBusy: String(freeBusy),
          status: String(status),
        };
        return entryId
          ? tx.calendarEntry.update({
              where: { id: entryId },
              data: { ...fields, revision: { increment: 1 }, updatedAt },
            })
          : tx.calendarEntry.create({ data: { tenantId: a.tenantId, ownerId: a.userId, ...fields } });
      },
      async (tx) => {
        if (
          entryId &&
          !(await tx.calendarEntry.findFirst({ where: { id: entryId, tenantId: a.tenantId, ownerId: a.userId } }))
        )
          throw new NotFoundException('日程不存在或不属于本人');
      },
    );
  }
}
