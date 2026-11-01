import { ServiceUnavailableException } from '@nestjs/common';
import type { Connector, HealthStatus, SyncPayload, SyncResult, TenantIntegrationConfig } from './connector.interface';

/** Retained prototype API, unavailable until a tenant-bound implementation is reviewed. */
export abstract class UnavailableConnector implements Connector {
  abstract readonly code: string;
  abstract readonly name: string;
  protected unavailable(): never {
    throw new ServiceUnavailableException(`${this.name}旧连接器尚未实现，不能报告连接、发送或同步成功`);
  }
  async connect(_config: TenantIntegrationConfig): Promise<void> {
    this.unavailable();
  }
  async disconnect(): Promise<void> {}
  async healthCheck(): Promise<HealthStatus> {
    return { connected: false, lastError: '未实现，不是有效连接' };
  }
  async sync(_direction: 'inbound' | 'outbound', _payload: SyncPayload): Promise<SyncResult> {
    return { success: false, error: '连接器尚未实现，未进行同步或外部写入' };
  }
}
