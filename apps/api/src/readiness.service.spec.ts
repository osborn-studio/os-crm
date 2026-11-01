import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './database/prisma.service';
import { ReadinessService } from './readiness.service';
describe('Readiness is distinct from process liveness', () => {
  const setup = (query: jest.Mock) =>
    new ReadinessService({ system: { $queryRaw: query } } as unknown as PrismaService);
  afterEach(() => jest.useRealTimers());
  test('probes database with a constant query and briefly caches success', async () => {
    const query = jest.fn().mockResolvedValue([{ 1: 1 }]),
      service = setup(query);
    expect((await service.check()).status).toBe('ready');
    await service.check();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0][0]).toBe('SELECT 1');
  });
  test('database failure returns sanitized 503 without driver credentials', async () => {
    const service = setup(jest.fn().mockRejectedValue(new Error('private SQL connection detail')));
    try {
      await service.check();
      throw Error('must fail');
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceUnavailableException);
      expect((e as ServiceUnavailableException).getStatus()).toBe(503);
      expect((e as Error).message).not.toContain('private SQL');
    }
  });
  test('hung probes time out, concurrent checks share one query, later checks can recover', async () => {
    jest.useFakeTimers();
    let complete!: (value: unknown[]) => void;
    const query = jest.fn().mockImplementation(
      () =>
        new Promise<unknown[]>((resolve) => {
          complete = resolve;
        }),
    );
    const service = setup(query);
    const results = Promise.allSettled([service.check(), service.check()]);
    await jest.advanceTimersByTimeAsync(2001);
    expect(
      (await results).every((r) => r.status === 'rejected' && r.reason instanceof ServiceUnavailableException),
    ).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    complete([{ 1: 1 }]);
    await jest.advanceTimersByTimeAsync(1);
    expect((await service.check()).status).toBe('ready');
  });
  test('a failed result is re-probed after cache expiration', async () => {
    jest.useFakeTimers();
    const query = jest
      .fn()
      .mockRejectedValueOnce(Error('unavailable'))
      .mockResolvedValue([{ 1: 1 }]);
    const service = setup(query);
    await expect(service.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await jest.advanceTimersByTimeAsync(1001);
    expect((await service.check()).status).toBe('ready');
    expect(query).toHaveBeenCalledTimes(2);
  });
});
