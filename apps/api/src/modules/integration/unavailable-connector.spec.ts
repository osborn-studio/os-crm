import { ServiceUnavailableException } from '@nestjs/common';
import { DingtalkService } from './dingtalk/dingtalk.service';
import { EmailService } from './email/email.service';
import { YonyouService } from './yonyou/yonyou.service';
const config = { tenantId: 1, enabled: true, credentials: { token: 'synthetic-not-valid' }, settings: {} };
const payload = { objectType: 'customer', action: 'create' as const, data: {} };
describe('Dormant legacy connectors fail closed', () => {
  test.each([new DingtalkService(), new EmailService(), new YonyouService()])(
    '$code cannot report a configured stub as connected',
    async (connector) => {
      await expect(connector.connect(config)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect((await connector.healthCheck()).connected).toBe(false);
      expect((await connector.sync('outbound', payload)).success).toBe(false);
      expect((await connector.sync('inbound', payload)).success).toBe(false);
    },
  );
  test('unimplemented webhook verifier rejects arbitrary and empty signatures', () => {
    const connector = new DingtalkService();
    expect(connector.verifyCallbackSignature('', '', '', '')).toBe(false);
    expect(connector.verifyCallbackSignature('forged', '123', 'nonce', '{}')).toBe(false);
  });
  test('external notification, login and approval stubs never return success', async () => {
    const connector = new DingtalkService();
    await expect(connector.getAccessToken()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(connector.getUserIdByAuthCode('synthetic')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(connector.sendWorkNotification('1', 'test', '', '', '')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(connector.createApprovalInstance('test', '1', {})).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(connector.syncOrganization(1)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  test('email and reconciliation stubs fail rather than issue fake receipts', async () => {
    const email = new EmailService(),
      yonyou = new YonyouService();
    await expect(email.sendEmail(payload)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(email.sendTemplate('synthetic', 'test', {})).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(email.pollEmails(1)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(yonyou.syncViaMiddleDB(1, 'customer')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(yonyou.reconcile(1)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
