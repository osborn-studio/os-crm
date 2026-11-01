ALTER TABLE `audit_logs`
  ADD COLUMN `source` ENUM('human', 'agent', 'system', 'import') NOT NULL DEFAULT 'human',
  ADD COLUMN `principal_label` VARCHAR(100) NULL;

CREATE TABLE `system_command_executions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `job_name` VARCHAR(50) NOT NULL,
  `policy_version` VARCHAR(40) NOT NULL,
  `job_run_id` VARCHAR(80) NOT NULL,
  `request_key` VARCHAR(80) NOT NULL,
  `command` VARCHAR(100) NOT NULL,
  `payload_hash` VARCHAR(64) NOT NULL,
  `result` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `system_command_identity_key` (`tenant_id`, `job_name`, `request_key`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
