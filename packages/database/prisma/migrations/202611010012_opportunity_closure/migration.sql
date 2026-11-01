-- Preserve historical timestamps; a won row without win_date remains unknown (NULL).
ALTER TABLE `opportunities` ADD COLUMN `closed_at` DATETIME(3) NULL;

UPDATE `opportunities`
SET `closed_at` = CASE
  WHEN `status` = 'won' THEN `win_date`
  WHEN `status` = 'lost' THEN `updated_at`
END
WHERE `status` IN ('won', 'lost');
