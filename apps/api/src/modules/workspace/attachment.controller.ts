import { Body, Controller, Get, Header, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
import { AttachmentService } from './attachment.service';
import { attachmentCapabilities } from './attachment-contract';
@Controller('evidence-attachments')
export class AttachmentController {
  constructor(private readonly service: AttachmentService) {}
  @Get('schema') schema() {
    return attachmentCapabilities;
  }

  @Get() @Header('Cache-Control', 'no-store') list(
    @CurrentUser() a: Actor,
    @Query('subjectKind') kind: string,
    @Query('subjectId', ParseIntPipe) id: number,
  ) {
    return this.service.list(a, kind, id);
  }
  @Get(':id/content') @Header('Cache-Control', 'no-store') download(@CurrentUser() a: Actor, @Param('id') id: string) {
    return this.service.download(a, id);
  }
  @Post() upload(@CurrentUser() a: Actor, @Body() body: Record<string, unknown>) {
    return this.service.upload(a, body);
  }
  @Post(':id/withdraw') withdraw(
    @CurrentUser() a: Actor,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.withdraw(a, id, body);
  }
}
