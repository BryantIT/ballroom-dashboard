// lib/auth/permissions.ts
export const PERMISSION_CODES = [
  "students.read",
  "students.create",
  "students.update_all",
  "students.update_assigned",
  "students.assign",
  "notes.read_staff",
  "notes.write_assigned",
  "appointments.read_all",
  "appointments.manage_all",
  "appointments.manage_self",
  "curriculum.manage_shared",
  "curriculum.manage_own",
  "progress.record_assigned",
  "billing.read_detail",
  "billing.process",
  "entitlements.read_relevant",
  "compensation.configure",
  "compensation.view_own",
  "reports.financial",
  "events.manage",
  "competitions.manage_entries",
  "communications.send",
  "users.manage",
  "integrations.configure",
  // Not in the spec's permission table — added for studio location
  // management, which the spec never assigned a code to. See
  // docs/superpowers/plans/2026-11-06-phase-1-platform-studio-auth.md's
  // "Decisions this plan locks in" section.
  "locations.manage",
  // Phase 2: studio theme/logo/subdomain-slug management. Owner-only,
  // like locations.manage; enforced by requirePermission() in
  // lib/branding/branding.ts (studio_branding has no RLS).
  "branding.manage",
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export const PERMISSION_DESCRIPTIONS: Record<PermissionCode, string> = {
  "students.read": "View student records in this studio",
  "students.create": "Create new student records",
  "students.update_all": "Edit any student's profile, regardless of assignment",
  "students.update_assigned": "Edit profiles of students the staff member is assigned to",
  "students.assign": "Assign or reassign instructors to students",
  "notes.read_staff": "Read staff-visible student notes",
  "notes.write_assigned": "Write notes for assigned students",
  "appointments.read_all": "View all appointments in this studio",
  "appointments.manage_all": "Create, edit, or cancel any appointment",
  "appointments.manage_self": "Create, edit, or cancel the staff member's own appointments",
  "curriculum.manage_shared": "Edit the studio's shared curriculum",
  "curriculum.manage_own": "Edit the staff member's own curriculum",
  "progress.record_assigned": "Record progress for assigned students",
  "billing.read_detail": "View billing and invoice details",
  "billing.process": "Process payments and invoices",
  "entitlements.read_relevant": "View entitlement balances relevant to the staff member's work",
  "compensation.configure": "Configure compensation plans and rules",
  "compensation.view_own": "View the staff member's own compensation/earnings",
  "reports.financial": "View financial reports",
  "events.manage": "Manage studio events",
  "competitions.manage_entries": "Manage external competition entries",
  "communications.send": "Send communications to students",
  "users.manage": "Manage staff memberships and invitations",
  "integrations.configure": "Configure third-party integrations",
  "locations.manage": "Create and manage studio locations",
  "branding.manage": "Manage studio theme, logo, and subdomain slug",
};

export const BUILTIN_ROLES = ["owner", "admin", "instructor"] as const;
export type BuiltinRoleCode = (typeof BUILTIN_ROLES)[number];

// Every "optional"/"restricted"/"limited" marker in the spec's permission
// table resolves to NOT granted here — see "Decisions this plan locks
// in" in the plan doc. Owner always gets every code.
export const BUILTIN_ROLE_PERMISSIONS: Record<BuiltinRoleCode, PermissionCode[]> = {
  owner: [...PERMISSION_CODES],
  admin: [
    "students.read",
    "students.create",
    "students.update_all",
    "students.update_assigned",
    "students.assign",
    "notes.read_staff",
    "notes.write_assigned",
    "appointments.read_all",
    "appointments.manage_all",
    "billing.read_detail",
    "billing.process",
    "entitlements.read_relevant",
    "events.manage",
    "competitions.manage_entries",
    "communications.send",
  ],
  instructor: [
    "students.read",
    "students.create",
    "students.update_assigned",
    "notes.write_assigned",
    "appointments.read_all",
    "appointments.manage_self",
    "curriculum.manage_own",
    "progress.record_assigned",
    "entitlements.read_relevant",
    "compensation.view_own",
  ],
};
