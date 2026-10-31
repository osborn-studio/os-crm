CREATE TABLE `auth_sessions` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `refresh_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `auth_sessions_tenant_id_user_id_revoked_at_idx` (`tenant_id`, `user_id`, `revoked_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `auth_attempts` (
  `key` CHAR(64) NOT NULL,
  `failures` INTEGER NOT NULL DEFAULT 0,
  `window_started_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
