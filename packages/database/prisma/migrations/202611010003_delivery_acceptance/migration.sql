ALTER TABLE `projects`
  ADD COLUMN `acceptance_state` VARCHAR(20) NOT NULL DEFAULT 'not_requested',
  ADD COLUMN `acceptance_submitted_by` INTEGER NULL;

UPDATE `projects` SET `acceptance_state` = 'legacy_completed' WHERE `status` = 'completed';

CREATE TABLE `delivery_events` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `project_id` INTEGER NOT NULL,
  `task_id` INTEGER NULL,
  `actor_id` INTEGER NOT NULL,
  `kind` VARCHAR(40) NOT NULL,
  `note` TEXT NOT NULL,
  `evidence` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `delivery_events_tenant_id_project_id_id_idx` (`tenant_id`, `project_id`, `id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
