CREATE TABLE `evidence_attachments` (
 `id` CHAR(36) NOT NULL, `tenant_id` INTEGER NOT NULL, `subject_kind` VARCHAR(20) NOT NULL,
 `subject_id` INTEGER NOT NULL, `filename` VARCHAR(160) NOT NULL, `media_type` VARCHAR(40) NOT NULL,
 `size` INTEGER NOT NULL, `sha256` CHAR(64) NOT NULL, `content_bytes` LONGBLOB NOT NULL,
 `created_by` INTEGER NOT NULL, `withdrawn_at` DATETIME(3) NULL, `withdrawal_reason` VARCHAR(1000) NULL,
 `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL,
 INDEX `evidence_attachments_subject_idx` (`tenant_id`,`subject_kind`,`subject_id`,`created_at`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
