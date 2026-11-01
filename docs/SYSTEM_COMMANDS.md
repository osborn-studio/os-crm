# System command primitive · design §4.0 / B3

`runSystemCommand` is an internal TypeScript application boundary next to `runCommand`.
There are no production callers, HTTP/MCP routes, scheduled jobs, Worker or cron added.
The unit suite and existing CI `identity-smoke.mjs` scan all production API source for
callers of the system entry points, including intermediate services. Adding a future
caller requires revisiting that guard and reviewing its entire transport reachability.

## Contract: `system.command.run@1.0`

Permission: an object issued by `createSystemPrincipal`, held in a module-private WeakSet.
JSON, structural casts, copies and user-supplied objects cannot pass issuance validation.
The object and its capability list are frozen. Server composition supplies one positive
tenant ID, one fixed job name and a bounded jobRunId. No body field supplies identity.
The code-owned policy map currently reserves `renewal@1.0 → renewal.generate` and
`forecast@1.0 → forecast.lock`; these are permissions only, not implemented business
capabilities or a callable registry. Future business handlers need their own schemas,
permissions, state/version guards and tests before either policy can be used in production.

Input schema for the primitive envelope:

```json
{
  "type": "object",
  "required": ["requestKey"],
  "properties": { "requestKey": { "type": "string", "minLength": 1, "maxLength": 80 } },
  "additionalProperties": true
}
```

The requestKey is trimmed and must remain nonempty. Additional properties are the
business payload, hashed canonically along with capability and policyVersion. Reserved
identity/control fields (`tenantId`, `actorId`, `userId`, `system`, `principal`, `jobName`,
`capability`, `allowedCapabilities`, `policyVersion`, `jobRunId`) are rejected at the
command envelope. Nested business data never creates or modifies a principal.
Output schema: a JSON value (`object`, `array`, `string`, `number`, `boolean`, or `null`),
exactly the persisted callback result; each future business capability must narrow it.
The work callback is trusted server code, never selected from a body or tool name.

State guards: issued principal, current policy allow-list, and live active/trial tenant
are checked before receipt replay inside Serializable. Business callbacks must use the
same transaction and principal tenant, enforce their business guards and optimistic
versions (e.g. `checkVersion` plus scoped conditional updates). The primitive grants no
arbitrary SQL or database tool to agents. External effects must not occur in a callback
that can be retried; outbox/notification policies are a later milestone.

Effect/evidence: callback writes, durable receipt and audit commit atomically. Both
runners share the unchanged three-attempt P2034/P2002 Serializable retry policy and
15-second timeout. Human validateActor, beforeReplay, payload hash and receipt queries
retain their existing semantics. System receipts live in a separate table, uniquely
keyed by `(tenantId, jobName, requestKey)`. Neither runner queries the other's table.
Changing payload/capability/policyVersion for the same key conflicts; a new jobRunId
replays the first committed result and retains the original run's evidence.

Audit has `source=system`, `principalLabel=system:<jobName>`, no userId, result,
policyVersion, original jobRunId and requestKey. The additive migration introduces
`AuditSource` (`human/agent/system/import`) and defaults existing/unannotated rows to
human for compatibility; it does not infer or backfill historical agent/import origins.
Existing delegated/import audit writers are not reclassified by this primitive change.

## Verification boundary

Unit tests cover issuance forgery, immutable policies, capability denial, body identity
rejection, replay/conflict, tenant revocation and bounded retry. Existing MySQL 8 CI
identity smoke adds persisted replay, changed payload, denied capability, both directions
of human/system receipt separation, concurrent same-key calls, transaction rollback,
system audit attribution, absence of production callers and a missing HTTP system route.
Fixture tests do not establish real database behavior. See PROGRESS for checks actually run.
