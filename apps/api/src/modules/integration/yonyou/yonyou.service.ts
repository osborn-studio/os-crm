import { Injectable } from '@nestjs/common';
import type { SyncResult } from '../connector.interface';
import { UnavailableConnector } from '../unavailable-connector';

@Injectable()
export class YonyouService extends UnavailableConnector {
  readonly code = 'yonyou';
  readonly name = '用友集成';
  async syncViaMiddleDB(_tenantId: number, _objectType: string): Promise<SyncResult> {
    this.unavailable();
  }
  async reconcile(_tenantId: number): Promise<{ matched: number; mismatched: number; details: unknown[] }> {
    this.unavailable();
  }
}
