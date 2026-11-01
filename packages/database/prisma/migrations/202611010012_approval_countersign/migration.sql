-- Existing sequential definitions and in-flight nodes remain unchanged.
ALTER TABLE `approval_flow_nodes` MODIFY `approver_type` ENUM('role', 'user', 'dept_leader', 'applicant_leader', 'users_all') NOT NULL;
