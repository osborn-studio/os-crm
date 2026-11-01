import { Injectable } from '@nestjs/common';
import type { SyncPayload, SyncResult } from '../connector.interface';
import { UnavailableConnector } from '../unavailable-connector';

@Injectable()
export class EmailService extends UnavailableConnector {
  readonly code = 'email';
  readonly name = '邮件集成';
  async sendEmail(_payload: SyncPayload): Promise<SyncResult> {
    this.unavailable();
  }
  async sendTemplate(_to: string, _templateCode: string, _variables: Record<string, unknown>): Promise<SyncResult> {
    this.unavailable();
  }
  async pollEmails(_tenantId: number): Promise<{ processed: number; leadsCreated: number }> {
    this.unavailable();
  }
}
