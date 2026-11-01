import { Injectable } from '@nestjs/common';
import { UnavailableConnector } from '../unavailable-connector';

/** Legacy prototype only. Real token/directory preview uses tenant-bound PlatformService. */
@Injectable()
export class DingtalkService extends UnavailableConnector {
  readonly code = 'dingtalk';
  readonly name = '钉钉集成';
  async getAccessToken(): Promise<string> {
    this.unavailable();
  }
  async getUserIdByAuthCode(_authCode: string): Promise<string | null> {
    this.unavailable();
  }
  async sendWorkNotification(
    _userId: string,
    _title: string,
    _markdown: string,
    _btnTitle: string,
    _btnUrl: string,
  ): Promise<boolean> {
    this.unavailable();
  }
  async createApprovalInstance(
    _processCode: string,
    _originatorUserId: string,
    _formValues: Record<string, unknown>,
  ): Promise<string | null> {
    this.unavailable();
  }
  async syncOrganization(_tenantId: number): Promise<{ depts: number; users: number }> {
    this.unavailable();
  }
  verifyCallbackSignature(_signature: string, _timestamp: string, _nonce: string, _body: string): boolean {
    return false;
  }
}
