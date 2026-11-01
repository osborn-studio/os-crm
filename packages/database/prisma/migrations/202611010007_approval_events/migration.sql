CREATE TABLE `approval_events` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `approval_id` INTEGER NOT NULL,
  `node_id` INTEGER NULL,
  `actor_id` INTEGER NOT NULL,
  `actor_name` VARCHAR(100) NOT NULL,
  `action` VARCHAR(30) NOT NULL,
  `note` TEXT NOT NULL,
  `evidence` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `approval_events_tenant_id_approval_id_id_idx` (`tenant_id`, `approval_id`, `id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
