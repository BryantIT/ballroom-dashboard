-- Seeds the global permission catalog. Must mirror PERMISSION_DESCRIPTIONS
-- in lib/auth/permissions.ts (enforced by lib/auth/permissions.test.ts).
-- No GRANT here: app_runtime does not exist yet when migrations run; the
-- table grant lives in scripts/db-setup-roles.sql.
INSERT INTO "app"."permissions" (code, description) VALUES
  ('students.read', 'View student records in this studio'),
  ('students.create', 'Create new student records'),
  ('students.update_all', 'Edit any student''s profile, regardless of assignment'),
  ('students.update_assigned', 'Edit profiles of students the staff member is assigned to'),
  ('students.assign', 'Assign or reassign instructors to students'),
  ('notes.read_staff', 'Read staff-visible student notes'),
  ('notes.write_assigned', 'Write notes for assigned students'),
  ('appointments.read_all', 'View all appointments in this studio'),
  ('appointments.manage_all', 'Create, edit, or cancel any appointment'),
  ('appointments.manage_self', 'Create, edit, or cancel the staff member''s own appointments'),
  ('curriculum.manage_shared', 'Edit the studio''s shared curriculum'),
  ('curriculum.manage_own', 'Edit the staff member''s own curriculum'),
  ('progress.record_assigned', 'Record progress for assigned students'),
  ('billing.read_detail', 'View billing and invoice details'),
  ('billing.process', 'Process payments and invoices'),
  ('entitlements.read_relevant', 'View entitlement balances relevant to the staff member''s work'),
  ('compensation.configure', 'Configure compensation plans and rules'),
  ('compensation.view_own', 'View the staff member''s own compensation/earnings'),
  ('reports.financial', 'View financial reports'),
  ('events.manage', 'Manage studio events'),
  ('competitions.manage_entries', 'Manage external competition entries'),
  ('communications.send', 'Send communications to students'),
  ('users.manage', 'Manage staff memberships and invitations'),
  ('integrations.configure', 'Configure third-party integrations'),
  ('locations.manage', 'Create and manage studio locations');
