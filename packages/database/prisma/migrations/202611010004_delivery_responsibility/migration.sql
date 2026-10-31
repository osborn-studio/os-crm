-- Compatibility repair for the built-in sales role's existing create/read paths.
UPDATE `roles` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'project:update')
WHERE `code` = 'sales'
  AND JSON_CONTAINS(`permissions`, JSON_QUOTE('project:read'))
  AND JSON_CONTAINS(`permissions`, JSON_QUOTE('project:create'))
  AND NOT JSON_CONTAINS(`permissions`, JSON_QUOTE('project:update'))
  AND NOT JSON_CONTAINS(`permissions`, JSON_QUOTE('project:*'))
  AND NOT JSON_CONTAINS(`permissions`, JSON_QUOTE('*'));
UPDATE `roles` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'order:update')
WHERE `code` = 'sales'
  AND JSON_CONTAINS(`permissions`, JSON_QUOTE('order:read'))
  AND JSON_CONTAINS(`permissions`, JSON_QUOTE('order:create'))
  AND NOT JSON_CONTAINS(`permissions`, JSON_QUOTE('order:update'))
  AND NOT JSON_CONTAINS(`permissions`, JSON_QUOTE('order:*'))
  AND NOT JSON_CONTAINS(`permissions`, JSON_QUOTE('*'));
