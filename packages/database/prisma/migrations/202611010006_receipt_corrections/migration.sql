ALTER TABLE `receipts` ADD COLUMN `replaces_id` INTEGER NULL;
CREATE UNIQUE INDEX `receipts_tenant_id_replaces_id_key` ON `receipts` (`tenant_id`, `replaces_id`);
CREATE TABLE `receipt_vouchers` (
  `tenant_id` INTEGER NOT NULL,
  `reference_key` CHAR(64) NOT NULL,
  `original_receipt_id` INTEGER NOT NULL,
  `current_receipt_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenant_id`, `reference_key`),
  UNIQUE INDEX `receipt_vouchers_current_receipt_id_key` (`current_receipt_id`),
  UNIQUE INDEX `receipt_vouchers_tenant_id_original_receipt_id_key` (`tenant_id`, `original_receipt_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO `receipt_vouchers` (`tenant_id`, `reference_key`, `original_receipt_id`, `current_receipt_id`, `created_at`, `updated_at`)
SELECT `tenant_id`, `reference_key`, `id`, `id`, `created_at`, CURRENT_TIMESTAMP(3)
FROM `receipts` WHERE `ledger_managed` = true AND `reference_key` IS NOT NULL;
