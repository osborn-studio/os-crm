import type { Tx } from './command-runner';
import { tradeProvider, type TradeClassification } from './trade-policy';
/** Only object IDs already visible to the caller may be passed to this lookup. */
export async function contractTrades(
  tx: Tx,
  tenantId: number,
  ids: number[],
): Promise<Map<number, TradeClassification>> {
  const mappings = await tx.integrationMapping.findMany({
    where: { tenantId, provider: tradeProvider, kind: 'contracts', localId: { in: ids } },
  });
  const runs = await tx.integrationRun.findMany({
    where: {
      tenantId,
      provider: tradeProvider,
      kind: 'contracts',
      status: 'applied',
      id: { in: mappings.map((m) => m.externalId) },
    },
  });
  const data = new Map(runs.map((r) => [r.id, r.snapshot as unknown as TradeClassification]));
  return new Map(
    mappings.flatMap((m) => (data.has(m.externalId) ? [[m.localId, data.get(m.externalId)!] as const] : [])),
  );
}
