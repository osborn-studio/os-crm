-- The first delegated-agent release exposes only version 1.0. Preserve all old
-- receipts and explicitly backfill that known version without new executions.
ALTER TABLE `agent_executions`
  ADD COLUMN `capability_version` VARCHAR(10) NOT NULL DEFAULT '1.0' AFTER `capability_id`;
