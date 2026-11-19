import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
const day=z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).refine(v=>v>='2010-01-01'&&v<='2060-12-31'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
export const opportunityFollowSchema=z.object({content:z.string().trim().min(1).max(5000),method:z.enum(['visit','phone','wechat','email','meeting','other']).default('other'),nextAction:z.string().trim().min(1).max(200).optional(),nextFollowAt:day.optional(),createAction:z.boolean().default(false)}).strict().superRefine((v,c)=>{if(v.createAction&&(!v.nextAction||!v.nextFollowAt))c.addIssue({code:'custom',message:'生成行动和日程须填写下一步及跟进日期'});});
export function opportunityFollowInput(value:unknown){const p=opportunityFollowSchema.safeParse(value);if(!p.success)throw new BadRequestException(p.error.issues[0]?.message??'跟进参数无效');return p.data;}
