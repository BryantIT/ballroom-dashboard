# Phase 3 — Students, CRM & Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can manage a real student roster with notes, see every
instructor's day on one shared calendar, book a lesson for any
instructor without double-booking anyone or anything, and get a required
explanation whenever a student is booked outside their normal assigned
instructor.

**Architecture:** Appointments are materialized as individual rows from
the moment they're created — a recurring series generates one real
`appointments` row per occurrence up front, so "edit/cancel one
occurrence without touching the rest" is free (it's just a normal
single-row update) rather than needing RRULE/override machinery.
Conflict checking (instructor double-booking, room double-booking,
room-location mismatch, day-off/holiday hard-block) is one small,
focused service used by every booking path. The calendar reads this
same data; nothing is computed differently for display than for
conflict checking.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, Zod, Vitest +
Testcontainers Postgres, `@testing-library/react` — all already
established by Phases 0–2. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-11-phase-3-students-crm-scheduling-design.md`
(read this too — it records the brainstorming decisions this plan
implements, including several corrections to gaps the base spec left
open).

**Sequencing:** per the design doc, this plan's execution branches from
`main` only after Phase 2 (dashboard shell, branded login) has actually
landed there — the student roster and calendar pages nest inside Phase
2's `app/dashboard/layout.tsx` shell and reuse its nav/`ThemeRoot`.

## Global Constraints

- Any instructor can be booked for any student — assignment is a
  default/suggestion, never a restriction on who can be booked (design
  doc, confirmed with the product owner).
- A day-off/holiday/personal-time-off block is a **hard conflict**,
  enforced the same way as an instructor double-booking — rejected
  transactionally, never a warning staff can click through.
- A personal-time-off block's label is visible only to the instructor it
  belongs to, plus anyone holding `appointments.manage_all` — everyone
  else sees only that the slot is blocked, no label.
- Booking an already-assigned student with a different instructor
  requires a reason before the booking saves: one of `buddy_lesson`,
  `instructor_unavailable`, `considering_switch`, or `other` (with a
  free-text note for any of them). The saved reason is visible to staff
  and to both the assigned and the booked instructor — never private.
- Appointments are modeled with a collection of attendees
  (`appointment_attendees`) from this phase onward, not a single
  `student_id` column — even though per-attendee billing logic is a
  later phase's concern. A single-student lesson is simply an
  appointment with one attendee.
- Recurring series are weekly only this phase. A series materializes one
  `appointments` row per occurrence at creation time, bounded to
  `seriesEndDate` if given, else 12 weeks out from `seriesStartDate` —
  there is no background job that keeps extending an open-ended series
  further; that's a known, documented limitation, not a bug.
- Note read access: `hasPermission(notes.read_staff)` (Owner/Admin) sees
  every note. Otherwise, an instructor sees a note only if they wrote it
  themselves, or they are currently assigned to the student **and** the
  note isn't marked `restricted`. This corrects a Phase 1 permission-
  catalog gap where an instructor could write a note and never read it
  back (ledgered in Phase 2's final review as carried forward).
- Note write access: `hasPermission(notes.write_assigned)` AND (the
  caller is currently assigned to the student **or** holds
  `students.update_all`) — the spec's permission table has no
  `notes.write_all` code, so Owner/Admin's existing full-edit authority
  over student profiles (`students.update_all`) is extended to notes too,
  rather than leaving them unable to note a student they aren't
  personally assigned to.
- The substitute-instructor time-limited note-access rule from the base
  spec is explicitly **deferred** — not built this phase (design doc,
  confirmed with the product owner).
- All weekly-recurrence math (a `regular_day_off`'s `dayOfWeek`
  expansion in Task 6, and a series' weekly occurrence dates in Task 9)
  resolves `dayOfWeek` and the occurrence's calendar date **in the
  appointment's own location's timezone** (`locations.timezone`, Phase
  1) — never the server's local timezone and never UTC. Phase 1 built
  `locations.timezone` specifically so "all later recurrence/display
  calculations" would use it (roadmap, Phase 0 section); computing
  `dayOfWeek` in UTC would silently shift which real-world day a weekly
  block or series lands on for any studio not in UTC. Use a timezone-
  aware date library already available via Node's built-in
  `Intl.DateTimeFormat`/`Temporal`-adjacent APIs or a small helper — the
  exact approach is left to the builder, but the test in Task 6 (Step 1)
  must use a location with a non-UTC timezone and assert the expansion
  lands on the correct real-world date, not just "some date."
- A new conflict check beyond what the design doc named: a room cannot
  be double-booked (two overlapping appointments in the same room).
  Not named in the base spec's acceptance tests, but a reasonable person
  would expect it — the conflict-checking service added it alongside the
  spec's own instructor-double-booking and room-location-mismatch checks.
- Rooms have no creation API yet (Phase 1 left this for "whichever future
  phase adds room creation" — see `lib/db/schema.ts`'s comment on
  `rooms`). This phase adds it, deriving `studioId` server-side from the
  given `locationId` and never accepting it from the caller.

## Review Focus

- Booking a lesson into an instructor's own day-off/holiday window must
  be rejected outright, not just flagged — a studio relying on this to
  actually prevent double-booking would be badly served by a check that
  only warns. Covered in Task 8/9.
- A brand-new, unassigned student's free first lesson should let staff
  see which instructor currently has the fewest students, not just a
  bare instructor list — otherwise the "balance load when unsure"
  workflow this phase exists to support silently doesn't work. Covered
  in Task 11/14.
- Canceling or rescheduling one occurrence of a recurring series must
  never alter any sibling occurrence — a person relying on "this week
  only" calendar behavior would be surprised if the whole series moved.
  Covered in Task 10.
- A note marked `restricted` must stay invisible to an instructor who
  neither wrote it nor is currently assigned — including an instructor
  who *used to be* assigned and no longer is. Covered in Task 3.
- A room booked for one location's appointment must never be bookable
  for an appointment at a different location, even when the caller
  supplies a room ID directly (not just through the UI). Covered in
  Task 8/16.

---

### Task 1: Student CRM profile fields + student creation

**Files:**
- Modify: `lib/db/schema.ts` (add `email`, `phone` to `students`)
- Modify: `lib/validation/studios.ts` (add `createStudentSchema`, extend `updateStudentSchema`)
- Create: `app/api/v1/studios/[studioId]/students/route.ts` (add `POST` — `GET` already exists)
- Modify: `app/api/v1/studios/[studioId]/students/[studentId]/route.ts` (PATCH sets whichever of displayName/email/phone were provided, not just displayName)
- Test: `lib/db/schema.studentsProfile.test.ts`
- Test: extend `app/api/v1/studios/[studioId]/students/route.test.ts` (create if it doesn't exist) and the `[studentId]` route's existing test file

**Interfaces:**
- Consumes: `requirePermission`, `PermissionDeniedError` (existing); `students` table (existing, extended here).
- Produces: `createStudentSchema = z.object({ displayName: z.string().min(1).max(200), email: z.email().optional(), phone: z.string().max(40).optional() })`; `updateStudentSchema` gains the same two fields, both `.optional().nullable()`.

- [ ] **Step 1: Write the failing schema test, add the columns, migrate**

```ts
test("students has nullable email and phone columns", () => {
  expect(Object.keys(students)).toEqual(expect.arrayContaining(["email", "phone"]));
});
```

Add `email: text("email")`, `phone: text("phone")` to the `students` table
in `lib/db/schema.ts` (both nullable — no format constraint at the DB
layer, Zod validates on write). Run `npm run db:generate`; no RLS change
needed (the table already has `tenant_isolation`).

- [ ] **Step 2: Add `POST /api/v1/studios/[studioId]/students`**

Mirror the existing `GET`'s auth/validation shape exactly
(`verifyApiSession` → 401, `z.uuid()` on `studioId` → 400,
`requirePermission(userId, studioId, "students.create")` → 403,
`createStudentSchema.safeParse(await request.json())` → 400). Insert
inside `withTenantContext({ userId, tenantId: studioId }, ...)` and
return the created row with status 201.

Test: 401/400/403 cases (reuse the `memberships` route's test
structure); a successful create as an Owner returns 201 with the
submitted fields; the inserted row's `studioId` is the path's
`studioId`, not anything from the body (there is no `studioId` field on
`createStudentSchema` to begin with — confirm the schema has no such
field, closing off that injection path by construction).

- [ ] **Step 3: Extend the PATCH route and schema to cover email/phone**

Update `updateStudentSchema` to accept optional `email`/`phone`
alongside the existing `displayName`. Update the `[studentId]` route's
`.set({...})` call to only include fields actually present in
`body.data` (so a partial update doesn't null out fields the caller
didn't send) — e.g. `Object.fromEntries(Object.entries(body.data).filter(([, v]) => v !== undefined))`.

Test: PATCH with only `{ email: "a@b.com" }` leaves `displayName`
unchanged.

- [ ] **Step 4: Run tests, typecheck, lint; commit**

---

### Task 2: Student relationships (linked couples)

**Files:**
- Modify: `lib/db/schema.ts` (add `studentRelationships`)
- Create migration (RLS: `tenant_isolation` on `studio_id`, same pattern as every other tenant table)
- Create: `lib/students/relationships.ts`
- Create: `app/api/v1/studios/[studioId]/students/[studentId]/relationships/route.ts` (GET list, POST link)
- Test: `lib/students/relationships.test.ts`
- Test: the route's own test file

**Interfaces:**
- Produces: `studentRelationships` table (`id`, `studioId`, `studentAId`, `studentBId`, `createdAt`); `linkStudents(userId, studioId, studentAId, studentBId, database?): Promise<{id: string}>`; `listRelatedStudents(studioId, studentId, database?): Promise<string[]>` (the *other* student id in each pair this student appears in).
- Consumes: `requirePermission` (gated on `students.update_all` — linking is an Owner/Admin action; the base spec's permission table has no dedicated code for this, and this phase doesn't add one, matching the "builder's call" allowance in the design doc).

- [ ] **Step 1: Write the failing tests**

```ts
test("links two students and lists the relationship from either side", async () => { /* linkStudents(A,B) then listRelatedStudents(A) includes B and listRelatedStudents(B) includes A */ });
test("rejects linking a student to themselves", async () => { /* linkStudents(A,A) rejects with a typed SelfRelationshipError */ });
test("rejects linking the same pair twice, in either order", async () => { /* linkStudents(A,B) then linkStudents(B,A) rejects with DuplicateRelationshipError */ });
test("a non-Owner/Admin cannot link students", async () => { /* Instructor caller -> PermissionDeniedError */ });
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `lib/students/relationships.ts`**

`linkStudents`: `requirePermission(userId, studioId, "students.update_all")`
first; throw `SelfRelationshipError` if `studentAId === studentBId`;
check for an existing row with either ordering (`(studentAId,studentBId)`
or `(studentBId,studentAId)`) and throw `DuplicateRelationshipError` if
found (same check-then-insert pattern already accepted elsewhere in
this codebase for low-concurrency admin actions — a TOCTOU race here is
the same low-risk category already parked for studio-slug generation,
not a new concern to solve here); insert and return.

`listRelatedStudents`: a plain `withTenantContext` select where either
column matches `studentId`, mapping each row to whichever id isn't the
input.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Add the route**

`GET` (any member with `students.read`) returns the related student ids
(and basic display info via a join) for `[studentId]`. `POST` (body:
`{ studentBId: string }`) calls `linkStudents`, mapping
`SelfRelationshipError`/`DuplicateRelationshipError` to 400/409 and
`PermissionDeniedError` to 403.

- [ ] **Step 6: Run tests, typecheck, lint; commit**

---

### Task 3: Notes (corrected read/write authorization)

**Files:**
- Modify: `lib/db/schema.ts` (add `notes`)
- Create migration (RLS: `tenant_isolation` on `studio_id`)
- Create: `lib/students/notes.ts`
- Create: `app/api/v1/studios/[studioId]/students/[studentId]/notes/route.ts` (GET list — filtered per-viewer, POST create)
- Test: `lib/students/notes.test.ts`
- Test: the route's own test file

**Interfaces:**
- Consumes: `hasPermission`, `isAssignedInstructor` (existing, `lib/students/authorization.ts`).
- Produces: `notes` table (`id`, `studioId`, `studentId`, `authorUserId`,
  `body`, `restricted` boolean default `false`, `createdAt`);
  `canReadNote(context: {userId, studioId}, note: {authorUserId: string; restricted: boolean}, studentId: string, database?): Promise<boolean>`;
  `canWriteNote(context: {userId, studioId}, studentId: string, database?): Promise<boolean>`;
  `createNote(userId, studioId, studentId, body: string, restricted: boolean, database?): Promise<Note>`;
  `listVisibleNotes(context: {userId, studioId}, studentId: string, database?): Promise<Note[]>` (filters server-side using `canReadNote` per row — never returns a note the viewer can't see, so there's no "note exists but is redacted" leak).

- [ ] **Step 1: Write the failing authorization tests**

```ts
test("the author can always read their own note, restricted or not", async () => { /* instructor B writes a restricted note; instructor B reads it back via canReadNote -> true */ });
test("an assigned instructor can read a non-restricted note they didn't write", async () => { /* assigned instructor reads another author's non-restricted note -> true */ });
test("an assigned instructor cannot read a restricted note they didn't write", async () => { /* -> false */ });
test("an unassigned instructor cannot read any note they didn't write, restricted or not", async () => { /* -> false in both cases */ });
test("a former instructor (assignment ended) cannot read a restricted note", async () => { /* assignment's endedAt is in the past -> false, same as never-assigned */ });
test("Owner/Admin (notes.read_staff) can read every note regardless of restricted/assignment", async () => { /* -> true */ });
test("an assigned instructor can write a note", async () => { /* canWriteNote -> true */ });
test("an Owner can write a note for a student they aren't personally assigned to", async () => { /* students.update_all bypasses the assignment check -> true */ });
test("an unassigned, non-Owner/Admin staff member cannot write a note", async () => { /* -> false */ });
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `lib/students/notes.ts`**

`canReadNote`: `if (await hasPermission(..., "notes.read_staff")) return true;`
`if (note.authorUserId === context.userId) return true;`
`if (!note.restricted && await isAssignedInstructor(context.userId, studentId, context.studioId, database)) return true;`
`return false;`

`canWriteNote`: `if (!(await hasPermission(..., "notes.write_assigned"))) return false;`
`return (await isAssignedInstructor(...)) || (await hasPermission(..., "students.update_all"));`

`createNote`: `if (!(await canWriteNote(...))) throw new PermissionDeniedError(...)` (reuse the existing `PermissionDeniedError` class from `lib/auth/authorization.ts` rather than inventing a parallel one); insert, return.

`listVisibleNotes`: select all notes for the student inside
`withTenantContext`, then filter with `canReadNote` per row (an
`Array.filter` with `async` needs a `Promise.all` over a mapped boolean
array, not a bare `.filter(async ...)` — that silently keeps everything).

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Add the route**

`GET` returns `listVisibleNotes` for the caller. `POST` (body:
`{ body: string; restricted?: boolean }`) calls `createNote`, mapping
`PermissionDeniedError` to 403.

- [ ] **Step 6: Run tests, typecheck, lint; commit**

---

### Task 4: Instructor–location assignments

**Files:**
- Modify: `lib/db/schema.ts` (add `instructorLocations`)
- Create migration (RLS: `tenant_isolation` on `studio_id`)
- Create: `lib/scheduling/instructor-locations.ts`
- Create: `app/api/v1/studios/[studioId]/instructor-locations/route.ts` (GET list, POST assign)
- Test: `lib/scheduling/instructor-locations.test.ts`
- Test: the route's own test file

**Interfaces:**
- Produces: `instructorLocations` table (`id`, `studioId`, `instructorUserId`, `locationId`, `createdAt`, unique on `(studioId, instructorUserId, locationId)`); `assignInstructorToLocation(userId, studioId, instructorUserId, locationId, database?): Promise<void>` (permission: `locations.manage`); `listInstructorLocations(studioId, instructorUserId, database?): Promise<string[]>` (location ids); `listLocationInstructors(studioId, locationId, database?): Promise<string[]>` (instructor user ids — consumed by Task 14's calendar location filter).

- [ ] **Step 1: Write the failing tests**

```ts
test("assigns an instructor to a location and lists it both directions", async () => { /* ... */ });
test("assigning the same pair twice is a no-op, not an error", async () => { /* second call doesn't throw — ON CONFLICT DO NOTHING semantics at the service layer */ });
test("a non-Owner cannot assign instructor-location pairs", async () => { /* Instructor caller -> PermissionDeniedError */ });
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `lib/scheduling/instructor-locations.ts`**

`assignInstructorToLocation`: `requirePermission(..., "locations.manage")`;
insert with `.onConflictDoNothing()` (Drizzle's equivalent) on the unique
index.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Add the route; run tests, typecheck, lint; commit**

---

### Task 5: Rooms and a locations list endpoint

**Files:**
- Modify: `app/api/v1/studios/[studioId]/locations/route.ts` (add `GET`)
- Create: `lib/locations/rooms.ts`
- Create: `app/api/v1/studios/[studioId]/locations/[locationId]/rooms/route.ts` (GET list, POST create)
- Modify: `scripts/db-setup-roles.sql` if the existing `rooms` grant needs no change (it already exists from Phase 1 — confirm, don't duplicate)
- Test: `lib/locations/rooms.test.ts`
- Test: the routes' own test files

**Interfaces:**
- Consumes: `rooms`, `locations` (existing tables, Phase 1).
- Produces: `createRoom(userId, studioId, locationId, name, database?): Promise<Room>` (permission `locations.manage`; derives and validates `locationId` belongs to `studioId` server-side — **never** accepts a `studioId` from the caller for this); `listRoomsForLocation(studioId, locationId, database?): Promise<Room[]>`.

- [ ] **Step 1: Write the failing tests**

```ts
test("creates a room under a location, deriving studioId from the location", async () => { /* result.studioId === the location's actual studioId */ });
test("rejects a locationId that belongs to a different studio", async () => { /* even though the caller is an Owner of studio A, passing studio B's locationId throws LocationNotFoundError, never silently creates a cross-tenant room */ });
test("a non-Owner cannot create a room", async () => { /* PermissionDeniedError */ });
test("GET lists rooms for a location, GET on locations lists all locations for the studio", async () => { /* ... */ });
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `lib/locations/rooms.ts`**

`createRoom`: `requirePermission(..., "locations.manage")`; look up the
location by `locationId` **inside the same `studioId`'s tenant context**
(so RLS itself already excludes a foreign-studio location — a row that
doesn't resolve means either it doesn't exist or belongs to another
studio, and both cases throw the same `LocationNotFoundError`, which is
the correct behavior either way: never reveal which); insert with
`studioId` taken from the resolved location row, never from the caller.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Add both routes (locations GET needs only an active membership — no extra permission, it's not sensitive; rooms POST needs `locations.manage`, rooms GET needs only an active membership); run tests, typecheck, lint; commit**

---

### Task 6: Instructor availability blocks (day off, personal time off, studio holiday)

**Files:**
- Modify: `lib/db/schema.ts` (add `instructorBlocks`)
- Create migration (RLS: `tenant_isolation` on `studio_id`)
- Create: `lib/scheduling/blocks.ts`
- Create: `lib/validation/scheduling.ts` (block input schema)
- Create: `app/api/v1/studios/[studioId]/instructor-blocks/route.ts` (GET list for a range, POST create)
- Test: `lib/scheduling/blocks.test.ts`
- Test: the route's own test file

**Interfaces:**
- Produces: `instructorBlocks` table (`id`, `studioId`,
  `instructorUserId` nullable, `kind` text (`"regular_day_off" |
  "personal_time_off" | "studio_holiday"`), `dayOfWeek` integer nullable
  (0–6, only for `regular_day_off`), `startTime`/`endTime` text nullable
  (`"HH:MM"`, only for `regular_day_off`), `startAt`/`endAt` timestamp
  nullable (only for `personal_time_off`/`studio_holiday`), `label` text
  nullable, `createdAt`).
- Produces: `createBlockSchema` (Zod, `lib/validation/scheduling.ts`) —
  a discriminated union on `kind` so each variant requires exactly its
  own fields (e.g. `regular_day_off` requires `dayOfWeek`/`startTime`/
  `endTime` and forbids `startAt`/`endAt`).
- Produces: `createBlock(userId, studioId, input, database?): Promise<Block>`;
  `getBlockLabel(viewerUserId, block: {instructorUserId: string | null; label: string | null}, viewerCanSeeAllLabels: boolean): string | null` (pure function — returns `label` only if `viewerUserId === instructorUserId` or `viewerCanSeeAllLabels`, else `null`); `listBlocksInRange(studioId, startAt, endAt, database?): Promise<ResolvedBlock[]>` (expands `regular_day_off` rows into one concrete occurrence per matching date inside `[startAt, endAt)`, alongside the one-off `personal_time_off`/`studio_holiday` rows as-is).

- [ ] **Step 1: Write the failing tests**

```ts
test("an instructor can create their own personal_time_off block", async () => { /* ... */ });
test("an instructor cannot create a personal_time_off block for a different instructor without appointments.manage_all", async () => { /* PermissionDeniedError */ });
test("creating a studio_holiday requires appointments.manage_all even for the block's own instructor field being null", async () => { /* Instructor without manage_all -> PermissionDeniedError */ });
test("regular_day_off rejects a payload that also includes startAt/endAt", async () => { /* schema-level rejection */ });
test("getBlockLabel reveals the label to the block's own instructor", () => { /* ... */ });
test("getBlockLabel hides the label from someone else without viewerCanSeeAllLabels", () => { /* returns null */ });
test("getBlockLabel reveals the label to a viewer with viewerCanSeeAllLabels=true", () => { /* ... */ });
test("listBlocksInRange expands a Monday regular_day_off into every Monday in the given range", async () => { /* e.g. a 3-week range with weekly Monday day-off yields 3 resolved occurrences */ });
test("listBlocksInRange resolves dayOfWeek in the appointment's location timezone, not UTC", async () => { /* a location in America/Los_Angeles with a Monday day-off, queried against a UTC range boundary that falls on Tuesday 06:00 UTC (Monday 22:00 PST the day before) — the occurrence must land on the correct LA-local Monday date, not whatever UTC's calendar date happens to be at that instant */ });
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement the schema, validation, and service**

Permission rule in `createBlock`: if `input.kind === "studio_holiday"`
(instructorUserId is always null for this kind), require
`appointments.manage_all`. Otherwise, if
`input.instructorUserId === userId`, allow it (self-service); else
require `appointments.manage_all`.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Add the route (`appointments.read_all` for GET, the
  service's own internal checks govern POST); run tests, typecheck,
  lint; commit**

---

### Task 7: Appointments, attendees, and series — schema

**Files:**
- Modify: `lib/db/schema.ts` (add `appointmentSeries`, `appointments`, `appointmentAttendees`)
- Create migration (RLS: `tenant_isolation` on `studio_id` for all three — `appointmentAttendees` gets its own denormalized `studioId` column so its policy doesn't need a join, same rationale as `rooms.studioId`/`rolePermissions.studioId` in Phase 1)
- Test: `lib/db/schema.appointments.test.ts`

**Interfaces:**
- Produces: `appointmentSeries` (`id`, `studioId`, `instructorUserId`,
  `locationId`, `roomId`, `dayOfWeek`, `startTime`, `endTime`,
  `seriesStartDate` timestamp, `seriesEndDate` timestamp nullable,
  `createdAt`).
- Produces: `appointments` (`id`, `studioId`, `seriesId` nullable
  references `appointmentSeries.id`, `instructorUserId`, `locationId`,
  `roomId`, `startAt`, `endAt`, `status` text default `"scheduled"`,
  `crossInstructorReasonCode` text nullable, `crossInstructorReasonNote`
  text nullable, `createdAt`).
- Produces: `appointmentAttendees` (`id`, `studioId`, `appointmentId`,
  `studentId`, unique on `(appointmentId, studentId)`).

This task is schema-only — no service logic yet (Tasks 8–10 build on
it). Write one test per table confirming the column set, then generate
and commit the migration.

- [ ] **Step 1–4: Write the column-set tests, add the tables, migrate, run tests/typecheck/lint, commit**

---

### Task 8: Conflict checking

**Files:**
- Create: `lib/scheduling/conflicts.ts`
- Test: `lib/scheduling/conflicts.test.ts`

**Interfaces:**
- Consumes: `appointments`, `instructorBlocks`, `rooms` (Tasks 6–7).
- Produces: `class InstructorConflictError extends Error`;
  `class RoomConflictError extends Error`;
  `class RoomLocationMismatchError extends Error`;
  `class InstructorUnavailableError extends Error`;
  `checkInstructorConflict(tx, studioId, instructorUserId, startAt, endAt, excludeAppointmentId?: string): Promise<void>` (throws `InstructorConflictError` on overlap with any non-canceled/non-late_canceled/non-no_show appointment for that instructor, **regardless of location** — an instructor can't be in two places);
  `checkRoomConflict(tx, studioId, roomId, startAt, endAt, excludeAppointmentId?): Promise<void>`;
  `checkRoomLocationMatch(tx, roomId, locationId): Promise<void>` (throws `RoomLocationMismatchError` if the room's own `locationId` doesn't match);
  `checkAvailabilityBlock(tx, studioId, instructorUserId, startAt, endAt): Promise<void>` (throws `InstructorUnavailableError` on overlap with any `instructorBlocks` row for that instructor, or any studio-wide `studio_holiday`, using `listBlocksInRange`'s expansion logic from Task 6 for `regular_day_off`).

All four take an already-open transaction (`tx`) — they're called
together, inside one transaction, from Task 9's booking service, so a
conflict discovered by any one of them aborts the whole booking
atomically.

- [ ] **Step 1: Write the failing tests**

```ts
test("checkInstructorConflict throws when the same instructor already has an overlapping appointment at a DIFFERENT location", async () => { /* acceptance test #4 */ });
test("checkInstructorConflict does not throw for a non-overlapping time", async () => { /* ... */ });
test("checkInstructorConflict ignores canceled appointments when checking for overlap", async () => { /* a canceled appointment in the same slot doesn't block a new booking */ });
test("checkRoomConflict throws when the same room already has an overlapping appointment", async () => { /* ... */ });
test("checkRoomLocationMatch throws when the room belongs to a different location than the appointment's", async () => { /* acceptance test #5 */ });
test("checkAvailabilityBlock throws for a time inside the instructor's regular_day_off window", async () => { /* ... */ });
test("checkAvailabilityBlock throws for a time inside a studio-wide holiday, for any instructor", async () => { /* ... */ });
test("checkAvailabilityBlock throws for a time inside another instructor's personal_time_off only if it's THEIR OWN block (not someone else's)", async () => { /* a different instructor's personal time off doesn't block this instructor */ });
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `lib/scheduling/conflicts.ts`**

Overlap predicate for all time-range checks: `startAt < other.endAt AND
endAt > other.startAt` (half-open interval, so back-to-back
appointments — one ending exactly when another starts — don't
conflict).

- [ ] **Step 4: Run tests to verify they pass; typecheck, lint; commit**

---

### Task 9: Appointment booking (single + recurring series)

**Files:**
- Create: `lib/scheduling/appointments.ts`
- Create: `lib/validation/scheduling.ts` (extend — `createAppointmentSchema`, `createAppointmentSeriesSchema`)
- Test: `lib/scheduling/appointments.test.ts`

**Interfaces:**
- Consumes: `checkInstructorConflict`, `checkRoomConflict`,
  `checkRoomLocationMatch`, `checkAvailabilityBlock` (Task 8);
  `studentAssignments` (existing) for resolving a student's current
  primary instructor.
- Produces: `class CrossInstructorReasonRequiredError extends Error`;
  `createAppointment(userId, studioId, input: { instructorUserId: string; locationId: string; roomId: string; startAt: Date; endAt: Date; attendeeStudentIds: string[]; crossInstructorReason?: { code: "buddy_lesson" | "instructor_unavailable" | "considering_switch" | "other"; note?: string } }, database?): Promise<Appointment>`;
  `createAppointmentSeries(userId, studioId, input: {...same fields except startAt/endAt, plus dayOfWeek, startTime, endTime, seriesStartDate, seriesEndDate?}, database?): Promise<{ seriesId: string; created: Appointment[]; skipped: { date: Date; reason: string }[] }>` (per-occurrence conflicts are skipped and reported, not a hard failure of the whole series — a real staff workflow wants the other weeks booked even if one week collides).

- [ ] **Step 1: Write the failing tests**

```ts
test("books a single-attendee appointment with no conflicts", async () => { /* ... */ });
test("books a multi-attendee appointment (e.g. a couple) as one appointment with two attendee rows", async () => { /* appointment_attendees has 2 rows for 1 appointment */ });
test("requires a cross-instructor reason when the attendee's current primary instructor differs from the booked instructor", async () => { /* no reason given -> CrossInstructorReasonRequiredError */ });
test("does not require a reason when booking the attendee's own assigned instructor", async () => { /* ... */ });
test("does not require a reason for a brand-new student with no assignment yet", async () => { /* no current primary -> nothing to differ from */ });
test("stores the cross-instructor reason on the appointment when given", async () => { /* ... */ });
test("a staff member without appointments.manage_all cannot book for an instructor other than themselves", async () => { /* PermissionDeniedError */ });
test("an instructor with only appointments.manage_self can book their own slot", async () => { /* ... */ });
test("rejects a booking that fails any of the four conflict checks (one test per check, reusing Task 8's fixtures)", async () => { /* ... */ });

test("createAppointmentSeries materializes one appointment per week within the window", async () => { /* 4-week series with no end date (bounded by the 12-week default) -> N weekly rows, each independently editable */ });
test("createAppointmentSeries skips a conflicting week and still creates the rest, reporting the skip", async () => { /* result.skipped has one entry, result.created has the others */ });
test("createAppointmentSeries resolves weekly occurrence dates in the location's own timezone", async () => { /* same non-UTC-timezone setup as Task 6's equivalent test — the generated occurrences' startAt/endAt fall on the correct local calendar dates for a dayOfWeek near a UTC day boundary */ });
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `lib/scheduling/appointments.ts`**

`createAppointment`: permission check first
(`appointments.manage_all`, or `appointments.manage_self` with
`input.instructorUserId === userId`); then, inside one transaction, run
all four Task 8 checks; then for each `attendeeStudentIds` entry, look
up their current primary `studentAssignments` row (not ended) — if one
exists and its `instructorUserId !== input.instructorUserId`, require
`input.crossInstructorReason` (throw `CrossInstructorReasonRequiredError`
if absent); insert the `appointments` row (with the reason fields if
given) and one `appointmentAttendees` row per attendee, all in that same
transaction.

`createAppointmentSeries`: generate the list of weekly occurrence dates
from `seriesStartDate` to `min(seriesEndDate, seriesStartDate + 12
weeks)`; insert the `appointmentSeries` row; for each occurrence, call
`createAppointment`'s core logic in its own sub-transaction — catch a
conflict-class error (any of the four from Task 8) for that occurrence
only, record it in `skipped`, and continue to the next occurrence rather
than aborting the whole series.

- [ ] **Step 4: Run tests to verify they pass; typecheck, lint; commit**

---

### Task 10: Appointment status transitions

**Files:**
- Create: `lib/scheduling/appointment-status.ts`
- Test: `lib/scheduling/appointment-status.test.ts`

**Interfaces:**
- Produces: `class IllegalStatusTransitionError extends Error`;
  `transitionAppointmentStatus(userId, studioId, appointmentId, newStatus: "checked_in" | "completed" | "canceled" | "late_canceled" | "no_show", database?): Promise<Appointment>`.

- [ ] **Step 1: Write the failing tests**

```ts
test("scheduled -> checked_in is legal", async () => { /* ... */ });
test("scheduled -> completed is legal (check-in is optional per BR-04)", async () => { /* ... */ });
test("checked_in -> completed is legal", async () => { /* ... */ });
test("completed -> scheduled is illegal", async () => { /* IllegalStatusTransitionError */ });
test("canceling one occurrence of a series does not change any sibling occurrence's status", async () => { /* create a 3-week series, cancel week 2, assert weeks 1 and 3 are still "scheduled" — this is the Review Focus item for materialized occurrences */ });
test("a staff member without appointments.manage_all cannot transition an appointment that isn't their own", async () => { /* PermissionDeniedError, same manage_all/manage_self split as createAppointment */ });
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement the legal-transition map and the function; run tests, typecheck, lint; commit**

---

### Task 11: Instructor load

**Files:**
- Create: `lib/scheduling/instructor-load.ts`
- Test: `lib/scheduling/instructor-load.test.ts`

**Interfaces:**
- Produces: `getInstructorLoad(studioId, database?): Promise<{ instructorUserId: string; name: string | null; activeStudentCount: number }[]>` — one row per studio member holding `appointments.manage_self` or `appointments.manage_all` (i.e., every staff member who can be booked as an instructor), counting their current (not-ended) `studentAssignments` rows.

- [ ] **Step 1: Write the failing test**

```ts
test("returns each instructor's current active student count, not counting ended assignments", async () => { /* instructor A has 2 active + 1 ended assignment -> activeStudentCount 2 */ });
```

- [ ] **Step 2–4: Implement, run tests, typecheck, lint; commit**

---

### Task 12: Appointment API routes

**Files:**
- Create: `app/api/v1/studios/[studioId]/appointments/route.ts` (POST create single, GET calendar query)
- Create: `app/api/v1/studios/[studioId]/appointments/series/route.ts` (POST create series)
- Create: `app/api/v1/studios/[studioId]/appointments/[appointmentId]/status/route.ts` (PATCH transition)
- Test: each route's own test file

**Interfaces:**
- Consumes: `createAppointment`, `createAppointmentSeries` (Task 9), `transitionAppointmentStatus` (Task 10), `listBlocksInRange` (Task 6), `getBlockLabel` (Task 6).
- `GET .../appointments?from=<ISO>&to=<ISO>&locationId=<uuid?>`: returns
  `{ appointments: Appointment[]; blocks: ResolvedBlock[] }` for the
  given window, each block's `label` already resolved through
  `getBlockLabel` for the calling viewer (never send an unresolved label
  to the client and filter client-side — the server must never transmit
  a label the viewer isn't entitled to).

- [ ] **Step 1: Write the failing tests per route**

Error mapping to verify: `PermissionDeniedError` → 403;
`InstructorConflictError`/`RoomConflictError`/`RoomLocationMismatchError`/`InstructorUnavailableError`
→ 409; `CrossInstructorReasonRequiredError` → 422;
`IllegalStatusTransitionError` → 409; Zod validation failure → 400;
unauthenticated → 401; invalid `studioId`/`appointmentId` UUID → 400.

- [ ] **Step 2–4: Implement each route mirroring the established
  convention (`memberships`/`branding` routes), run tests, typecheck,
  lint; commit**

---

### Task 13: Student roster UI

**Files:**
- Create: `app/dashboard/students/page.tsx` (list + search + "Add student")
- Create: `app/dashboard/students/[studentId]/page.tsx` (profile, notes, relationships, assignment history)
- Create: `components/student-list.tsx`, `components/student-form.tsx`, `components/notes-list.tsx`
- Create: corresponding `.test.tsx` files

**Interfaces:**
- Consumes: the Task 1–3 API routes (via `fetch`, same pattern as
  `BrandingSettingsForm`); `canEditStudent` (existing); `canReadNote`/
  `canWriteNote` (Task 3) resolved server-side before rendering edit
  controls, not hidden-via-CSS on the client.

- [ ] **Step 1: Write failing component tests** for: the list page
  renders fetched students and a search input that filters client-side
  by display name; the "Add student" form submits to the Task 1 `POST`
  route; the detail page shows notes the current viewer is allowed to
  see and a disabled/absent "add note" control when `canWriteNote` is
  false for the viewer.

- [ ] **Step 2–4: Implement, following the exact `BrandingSettingsForm`/
  `app/dashboard/settings/branding/page.tsx` pattern (Server Component
  resolves studio/permission, Client Component handles the form); run
  tests, typecheck, lint; commit**

---

### Task 14: Calendar UI

**Files:**
- Create: `app/dashboard/schedule/page.tsx` (day view)
- Create: `components/schedule/day-view.tsx`, `components/schedule/booking-form.tsx`, `components/schedule/instructor-load-picker.tsx`
- Create: corresponding `.test.tsx` files

**Interfaces:**
- Consumes: the Task 12 `GET .../appointments` route, `listLocationInstructors`
  (Task 4, for the location filter), `getInstructorLoad` (Task 11, for
  the booking form's instructor picker when the student is new/unassigned).

- [ ] **Step 1: Write failing component tests** for: the day view
  renders one column per instructor returned for the selected location,
  with lesson blocks (accent-colored, student + room per the brainstorm
  mockup), striped regular-day-off blocks, a studio-holiday banner
  spanning all columns, and a muted "unavailable" block for personal
  time off showing its label only when the test renders as that block's
  own instructor; the booking form shows the cross-instructor-reason
  prompt (preset reasons + note field) only when the selected
  student/instructor combination differs from the student's current
  assignment, and blocks submission until a reason is chosen.

- [ ] **Step 2–4: Implement, reusing `ThemeRoot`'s existing token classes
  for the accent coloring rather than hardcoding colors; run tests,
  typecheck, lint; commit**

---

### Task 15: Settings UI — instructor-location assignment and availability blocks

**Files:**
- Create: `app/dashboard/settings/scheduling/page.tsx`
- Create: `components/instructor-location-settings.tsx`, `components/availability-block-form.tsx`
- Create: corresponding `.test.tsx` files

**Interfaces:**
- Consumes: the Task 4 and Task 6 routes.

- [ ] **Step 1: Write failing component tests** for: an Owner/Admin can
  assign an instructor to a location and see it reflected; an instructor
  viewing this page (without `locations.manage`) sees only their own
  personal-time-off management, not the studio-wide holiday or
  instructor-location assignment controls.

- [ ] **Step 2–4: Implement, gated the same way `BrandingSettingsForm`
  gates on `branding.manage` (resolve the relevant permissions
  server-side, pass booleans down as props); run tests, typecheck,
  lint; commit**

---

### Task 16: Cross-cutting acceptance tests (final task)

**Files:**
- Create: `app/api/v1/studios/scheduling-acceptance.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–12 — no new production code.

- [ ] **Step 1: Write the acceptance tests**

```ts
test("acceptance #2: an instructor sees all of a studio's students but can only edit assigned ones and cannot read a restricted note on an unassigned student", async () => { /* ... */ });
test("acceptance #4: an instructor already booked at Location A cannot be double-booked at Location B for an overlapping time", async () => { /* exercises the real API routes end to end, not just the service function */ });
test("acceptance #5: a room belonging to Location A is rejected for an appointment at Location B, even when the caller supplies the room id directly", async () => { /* ... */ });
```

- [ ] **Step 2: Run the test — if it fails, that's a real defect in a
  prior task to fix there, not to work around here.**

- [ ] **Step 3: Run the full suite, `npm run lint`, `npm run typecheck`,
  `npm run build`; commit**
