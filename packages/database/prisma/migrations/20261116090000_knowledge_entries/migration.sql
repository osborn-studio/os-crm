CREATE TABLE `knowledge_entries` (
 `id` INTEGER NOT NULL AUTO_INCREMENT, `tenant_id` INTEGER NOT NULL,
 `source_key` VARCHAR(120) NOT NULL, `kind` VARCHAR(20) NOT NULL,
 `title` VARCHAR(200) NOT NULL, `customer_id` INTEGER NULL,
 `summary` TEXT NOT NULL, `evidence_status` VARCHAR(30) NOT NULL,
 `sources` JSON NOT NULL, `content` JSON NOT NULL, `activity_links` JSON NULL,
  `content_hash` VARCHAR(64) NOT NULL,
 `version` INTEGER NOT NULL DEFAULT 1, `created_by` INTEGER NOT NULL, `updated_by` INTEGER NOT NULL,
 `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL,
 PRIMARY KEY (`id`), UNIQUE INDEX `knowledge_entries_tenant_id_source_key_key` (`tenant_id`,`source_key`),
 INDEX `knowledge_entries_tenant_id_kind_customer_id_idx` (`tenant_id`,`kind`,`customer_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Unknown catalogue prices must not appear as free products. Existing prices stay unchanged.
ALTER TABLE `products` MODIFY `list_price` DECIMAL(12,2) NULL, MODIFY `tax_rate` DECIMAL(5,2) NULL, ADD COLUMN `pricing_status` VARCHAR(30) NOT NULL DEFAULT 'fixed';
