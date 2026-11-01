// Provider-independent MCP client. Supply only an opaque grant credential, never a human JWT/password.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client } = await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StreamableHTTPClientTransport } = await import(
  require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')
);
const base = new URL(process.env.CRM_URL || 'http://localhost:3000');
if (base.username || base.password || base.search || base.hash || base.pathname !== '/')
  throw Error('CRM_URL must be a bare CRM origin');
if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname)))
  throw Error('Remote CRM requires HTTPS');
const token = process.env.CRM_AGENT_TOKEN;
if (!token || !/^tbcrm_agent_[A-Za-z0-9_-]{43}$/.test(token))
  throw Error('Set CRM_AGENT_TOKEN to an issued opaque grant credential');
const client = new Client({ name: 'crm-delegated-local-client', version: '1.0.0' });
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/api/v1/agent-runtime/mcp', base), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  console.log('Granted tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
  const mode = process.env.CRM_AGENT_MODE || 'search';
  let result;
  if (mode === 'search')
    result = await client.callTool({
      name: 'customer.search',
      arguments: { requestKey: randomUUID(), keyword: process.env.CRM_KEYWORD || '', pageSize: 5 },
    });
  else if (mode === 'propose') {
    const targetId = Number(process.env.CRM_CUSTOMER_ID);
    if (!Number.isSafeInteger(targetId) || targetId < 1) throw Error('Set CRM_CUSTOMER_ID');
    result = await client.callTool({
      name: 'action.propose',
      arguments: {
        requestKey: randomUUID(),
        targetId,
        title: process.env.CRM_ACTION_TITLE || '待人工核对的跟进行动',
        content: process.env.CRM_ACTION_CONTENT || '请委托人核对客户、内容和计划日期后再决定是否批准。',
      },
    });
  } else if (mode === 'execute') {
    if (!process.env.CRM_PROPOSAL_ID) throw Error('Set CRM_PROPOSAL_ID after the owner reviews and approves');
    result = await client.callTool({
      name: 'action.execute',
      arguments: { requestKey: randomUUID(), proposalId: process.env.CRM_PROPOSAL_ID },
    });
  } else if (mode === 'receipt') {
    if (!process.env.CRM_EXECUTION_ID) throw Error('Set CRM_EXECUTION_ID');
    result = await client.callTool({ name: 'agent.receipt', arguments: { executionId: process.env.CRM_EXECUTION_ID } });
  } else throw Error('CRM_AGENT_MODE must be search, propose, execute or receipt');
  if (result.isError) throw Error(JSON.stringify(result));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.close();
}
