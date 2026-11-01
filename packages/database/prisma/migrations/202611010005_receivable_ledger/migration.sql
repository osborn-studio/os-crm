ALTER TABLE `receipts`
  ADD COLUMN `ledger_managed` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `reference_key` CHAR(64) NULL;
CREATE UNIQUE INDEX `receipts_tenant_id_reference_key_key` ON `receipts` (`tenant_id`, `reference_key`);
ALTER TABLE `receipt_allocations`
  ADD COLUMN `active` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `reversed_at` DATETIME(3) NULL,
  ADD COLUMN `reversed_by` INTEGER NULL,
  ADD COLUMN `reverse_reason` VARCHAR(1000) NULL;
CREATE INDEX `receipt_allocations_receipt_id_payment_plan_id_idx` ON `receipt_allocations` (`receipt_id`, `payment_plan_id`);
DROP INDEX `receipt_allocations_receipt_id_payment_plan_id_key` ON `receipt_allocations`;
CREATE INDEX `receipt_allocations_ledger_active_idx` ON `receipt_allocations` (`tenant_id`, `receipt_id`, `payment_plan_id`, `active`);
CREATE TABLE `finance_events` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `tenant_id` INTEGER NOT NULL,
  `receipt_id` INTEGER NOT NULL, `actor_id` INTEGER NOT NULL,
  `kind` VARCHAR(40) NOT NULL, `note` VARCHAR(1000) NOT NULL,
  `evidence` JSON NOT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `finance_events_tenant_id_receipt_id_id_idx` (`tenant_id`, `receipt_id`, `id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
