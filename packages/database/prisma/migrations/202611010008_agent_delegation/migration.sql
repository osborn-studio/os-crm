CREATE TABLE `agent_grants` (
  `id` CHAR(36) NOT NULL, `tenant_id` INTEGER NOT NULL, `owner_id` INTEGER NOT NULL,
  `owner_session_id` CHAR(36) NOT NULL, `name` VARCHAR(100) NOT NULL, `purpose` VARCHAR(1000) NOT NULL,
  `token_hash` CHAR(64) NOT NULL, `context_hash` CHAR(64) NOT NULL, `capabilities` JSON NOT NULL,
  `max_calls` INTEGER NOT NULL, `used_calls` INTEGER NOT NULL DEFAULT 0,
  `expires_at` DATETIME(3) NOT NULL, `revoked_at` DATETIME(3) NULL, `revoke_reason` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `agent_grants_token_hash_key` (`token_hash`),
  INDEX `agent_grants_tenant_id_owner_id_created_at_idx` (`tenant_id`, `owner_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `agent_proposals` (
  `id` CHAR(36) NOT NULL, `tenant_id` INTEGER NOT NULL, `grant_id` CHAR(36) NOT NULL, `owner_id` INTEGER NOT NULL,
  `request_key` CHAR(36) NOT NULL, `input_hash` CHAR(64) NOT NULL, `input` JSON NOT NULL,
  `customer_id` INTEGER NOT NULL, `customer_version` DATETIME(3) NOT NULL, `customer_name` VARCHAR(200) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending', `decision_note` VARCHAR(1000) NULL,
  `decided_by` INTEGER NULL, `decided_at` DATETIME(3) NULL, `action_id` INTEGER NULL, `compensation` JSON NULL, `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `agent_proposals_grant_id_request_key_key` (`grant_id`, `request_key`),
  INDEX `agent_proposals_tenant_id_owner_id_created_at_idx` (`tenant_id`, `owner_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `agent_executions` (
  `id` CHAR(36) NOT NULL, `tenant_id` INTEGER NOT NULL, `grant_id` CHAR(36) NOT NULL, `owner_id` INTEGER NOT NULL,
  `capability_id` VARCHAR(60) NOT NULL, `request_key` CHAR(36) NOT NULL, `input_hash` CHAR(64) NOT NULL,
  `status` VARCHAR(20) NOT NULL, `result` JSON NULL, `error_code` INTEGER NULL, `duration_ms` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `completed_at` DATETIME(3) NULL,
  UNIQUE INDEX `agent_executions_grant_id_request_key_key` (`grant_id`, `request_key`),
  INDEX `agent_executions_tenant_id_owner_id_created_at_idx` (`tenant_id`, `owner_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
