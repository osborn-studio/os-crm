import { Prisma } from '@prisma/client';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../database/prisma.service';
import { runSystemCommand, type Tx } from './command-runner';
import { createSystemPrincipal, type SystemPrincipal } from './system-principal';

function fixture() {
  const receipts = new Map<string, { command: string; payloadHash: string; result: unknown }>();
  const audit = jest.fn().mockResolvedValue({});
  const tenant = jest.fn().mockResolvedValue({ id: 1 });
  const tx = {
    tenant: { findFirst: tenant },
    systemCommandExecution: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { tenantId_jobName_requestKey: { tenantId: number; jobName: string; requestKey: string } };
        }) => receipts.get(JSON.stringify(where.tenantId_jobName_requestKey)),
      ),
      create: jest.fn(
        async ({
          data,
        }: {
          data: {
            tenantId: number;
            jobName: string;
            requestKey: string;
            command: string;
            payloadHash: string;
            result: unknown;
          };
        }) => {
          receipts.set(
            JSON.stringify({ tenantId: data.tenantId, jobName: data.jobName, requestKey: data.requestKey }),
            data,
          );
        },
      ),
    },
    auditLog: { create: audit },
  };
  const transaction = jest.fn(async (work: (client: Tx) => Promise<unknown>) => work(tx as unknown as Tx));
  return {
    prisma: { system: { $transaction: transaction } } as unknown as PrismaService,
    transaction,
    audit,
    tenant,
    receipts,
  };
}
const principal = () => createSystemPrincipal(1, 'renewal', 'run-1');
const capability = 'renewal.generate';

describe('server-only system command boundary', () => {
  it('replays across job runs exactly once and rejects changed payloads', async () => {
    const f = fixture();
    const work = jest.fn().mockResolvedValue({ saved: 1 });
    const body = { requestKey: 'one', value: 1 };
    await expect(runSystemCommand(f.prisma, principal(), capability, body, work)).resolves.toEqual({ saved: 1 });
    await expect(
      runSystemCommand(f.prisma, createSystemPrincipal(1, 'renewal', 'run-2'), capability, body, work),
    ).resolves.toEqual({ saved: 1 });
    await expect(runSystemCommand(f.prisma, principal(), capability, { ...body, value: 2 }, work)).rejects.toThrow();
    expect(work).toHaveBeenCalledTimes(1);
    expect(f.audit).toHaveBeenCalledTimes(1);
    expect(f.audit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: 'system',
        principalLabel: 'system:renewal',
        tenantId: 1,
      }),
    });
    expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      timeout: 15000,
    });
  });
  it('rejects forged or copied principals and denied capabilities before work', async () => {
    const f = fixture();
    const work = jest.fn();
    for (const p of [JSON.parse(JSON.stringify(principal())) as SystemPrincipal, { ...principal() }]) {
      await expect(runSystemCommand(f.prisma, p, capability, { requestKey: 'one' }, work)).rejects.toThrow();
    }
    await expect(
      runSystemCommand(f.prisma, principal(), 'forecast.lock', { requestKey: 'one' }, work),
    ).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
    expect(f.transaction).not.toHaveBeenCalled();
    expect(Object.isFrozen(principal().allowedCapabilities)).toBe(true);
  });
  it('keeps receipt identities scoped to one tenant and one job', async () => {
    const f = fixture();
    const body = { requestKey: 'shared' };
    await runSystemCommand(f.prisma, principal(), capability, body, async () => ({ tenant: 1 }));
    await expect(
      runSystemCommand(f.prisma, createSystemPrincipal(2, 'renewal', 'run'), capability, body, async () => ({
        tenant: 2,
      })),
    ).resolves.toEqual({ tenant: 2 });
    await expect(
      runSystemCommand(f.prisma, createSystemPrincipal(1, 'forecast', 'run'), 'forecast.lock', body, async () => ({
        job: 'forecast',
      })),
    ).resolves.toEqual({ job: 'forecast' });
    expect(f.receipts.size).toBe(3);
  });
  it('rechecks tenant availability even for replay', async () => {
    const f = fixture();
    await runSystemCommand(f.prisma, principal(), capability, { requestKey: 'one' }, async () => ({}));
    f.tenant.mockResolvedValue(null);
    await expect(
      runSystemCommand(f.prisma, principal(), capability, { requestKey: 'one' }, async () => ({})),
    ).rejects.toThrow();
  });
  it.each(['tenantId', 'actorId', 'system', 'jobName', 'capability', 'policyVersion', 'jobRunId', 'principal'])(
    'rejects body identity field %s',
    async (field) => {
      const f = fixture();
      await expect(
        runSystemCommand(
          f.prisma,
          principal(),
          capability,
          { requestKey: 'one', [field]: 'injected' },
          async () => ({}),
        ),
      ).rejects.toThrow();
      expect(f.transaction).not.toHaveBeenCalled();
    },
  );
  it.each(['P2034', 'P2002'])('retries %s with a bounded Serializable transaction', async (code) => {
    const f = fixture();
    const error = new Prisma.PrismaClientKnownRequestError('retry', { code, clientVersion: '6' });
    f.transaction.mockRejectedValueOnce(error);
    await expect(
      runSystemCommand(f.prisma, principal(), capability, { requestKey: 'one' }, async () => ({ ok: true })),
    ).resolves.toEqual({ ok: true });
    expect(f.transaction).toHaveBeenCalledTimes(2);
    f.transaction.mockRejectedValue(error);
    await expect(
      runSystemCommand(f.prisma, principal(), capability, { requestKey: 'two' }, async () => ({})),
    ).rejects.toThrow(error);
    expect(f.transaction).toHaveBeenCalledTimes(5);
  });
  it('has no production caller or adapter capable of reaching the system entry points', () => {
    // Stronger than a controller-only check: there are no transitive service callers either.
    function scan(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) scan(path);
        else if (
          path.endsWith('.ts') &&
          !path.endsWith('.spec.ts') &&
          !['command-runner.ts', 'system-principal.ts'].includes(entry.name)
        ) {
          expect(readFileSync(path, 'utf8')).not.toMatch(
            /\b(runSystemCommand|createSystemPrincipal|validateSystemPrincipal)\b/,
          );
        }
      }
    }
    scan(join(__dirname, '../..'));
  });
});
