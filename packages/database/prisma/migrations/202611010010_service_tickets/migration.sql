CREATE TABLE `service_tickets` (
 `id` INTEGER NOT NULL AUTO_INCREMENT, `tenant_id` INTEGER NOT NULL, `project_id` INTEGER NOT NULL,
 `customer_id` INTEGER NOT NULL, `title` VARCHAR(200) NOT NULL, `description` TEXT NOT NULL,
 `priority` VARCHAR(10) NOT NULL, `status` VARCHAR(20) NOT NULL DEFAULT 'open',
 `created_by` INTEGER NOT NULL, `assignee_id` INTEGER NULL, `resolved_by` INTEGER NULL, `resolution` TEXT NULL,
 `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL,
 INDEX `service_tickets_tenant_id_project_id_id_idx` (`tenant_id`,`project_id`,`id`),
 INDEX `service_tickets_tenant_id_assignee_id_status_idx` (`tenant_id`,`assignee_id`,`status`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `service_ticket_events` (
 `id` INTEGER NOT NULL AUTO_INCREMENT, `tenant_id` INTEGER NOT NULL, `ticket_id` INTEGER NOT NULL,
 `actor_id` INTEGER NOT NULL, `actor_name` VARCHAR(100) NOT NULL, `kind` VARCHAR(30) NOT NULL,
 `note` TEXT NOT NULL, `evidence` JSON NOT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX `service_ticket_events_tenant_id_ticket_id_id_idx` (`tenant_id`,`ticket_id`,`id`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
