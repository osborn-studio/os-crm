ALTER TABLE `customers` ADD COLUMN `name_fingerprint` CHAR(64) NULL;
-- Existing built-in sales roles that already create contracts may edit/submit their scoped drafts.
-- Deliberately stripped or custom roles are not granted new privileges.
UPDATE `roles` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'contract:update')
WHERE `code` = 'sales' AND JSON_TYPE(`permissions`) = 'ARRAY'
  AND JSON_CONTAINS(`permissions`, JSON_QUOTE('contract:create'))
  AND JSON_CONTAINS(`permissions`, JSON_QUOTE('contract:read'))
  AND NOT JSON_CONTAINS(`permissions`, JSON_QUOTE('contract:update'))
  AND NOT JSON_CONTAINS(`permissions`, JSON_QUOTE('contract:*'));
ALTER TABLE `contracts` ADD COLUMN `quote_snapshot` JSON NULL;
CREATE UNIQUE INDEX `customers_tenant_id_name_fingerprint_key` ON `customers` (`tenant_id`, `name_fingerprint`);
ALTER TABLE `contract_changes` MODIFY `status` ENUM('pending', 'approved', 'rejected', 'withdrawn') NOT NULL DEFAULT 'pending';
CREATE TABLE `customer_imports` (
  `id` CHAR(36) NOT NULL, `tenant_id` INTEGER NOT NULL, `actor_id` INTEGER NOT NULL,
  `source_hash` CHAR(64) NOT NULL, `digest` CHAR(64) NOT NULL, `preview` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'preview', `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `customer_imports_tenant_id_actor_id_created_at_idx` (`tenant_id`, `actor_id`, `created_at`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `opportunity_quotes` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `tenant_id` INTEGER NOT NULL, `opportunity_id` INTEGER NOT NULL,
  `version` INTEGER NOT NULL, `total` DECIMAL(15,2) NOT NULL, `items` JSON NOT NULL, `created_by` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `opportunity_quotes_tenant_id_opportunity_id_version_key` (`tenant_id`, `opportunity_id`, `version`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
