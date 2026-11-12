# Phase 3 — Students, CRM & Scheduling: Design

**Roadmap section:** `docs/development-plan.md`, Phase 3.
**Spec sections:** `references/ballroom_dash_spec_v0_3.md` — domain
boundaries 3–4; BR-01 (rooms/locations), BR-02 (students/assignments),
BR-04 (appointment states only — completion side-effects are Phase 5/6);
implementation order item 2; acceptance tests #2, #4, #5.

**Depends on:** Phase 1 (studios, locations, rooms, memberships, and the
existing `students`/`student_assignments` stub this phase extends — see
`lib/db/schema.ts`, which explicitly says Phase 3 extends rather than
replaces it).

**Sequencing (decided, overrides the roadmap's "can run in parallel"
note):** A builder check found that no authenticated dashboard UI
exists anywhere yet — Phase 1 was API-only, and Phase 2 is what builds
the first dashboard shell and login page. Phase 3's calendar is a real,
interactive UI with nowhere to render until that shell exists.
**Decided with the product owner: Phase 2 is implemented and shipped in
full before Phase 3 implementation starts.** The two design docs remain
independent (this one doesn't change Phase 2's), but execution is
sequential, not parallel.

## Intent and why

Confirmed directly with the product owner: studios currently run
scheduling on paper — each instructor keeps their own physical book.
When a staffer books a lesson for an instructor who isn't there to
consult, that instructor has no way to know until they're back,
flipping through their book. The fix isn't just "put the calendar
online" — it's making every instructor's day visible to everyone who
needs to book into it, at the moment of booking, with enough visual
distinction between lesson/day-off/holiday/personal-time that a staffer
can read the whole studio's day at a glance and never double-book
someone by accident.

## Goals

- One shared calendar view, visible to all staff, showing every
  instructor's bookings side by side for a given day/location.
- Visually distinct event types: lesson (shows student + room), regular
  day off, studio-wide holiday (spans all instructors), and personal
  time off — where only the owning instructor sees what the personal
  time off is actually for; everyone else sees only that the slot is
  blocked.
- Any instructor can be booked for any student — assignment is a
  default/suggestion, not a restriction.
- A view (at minimum, part of the booking flow for a new/unassigned
  student) surfacing each instructor's current student count, so a
  staffer unsure of personality fit can balance load.
- Booking an already-assigned student with a different instructor
  requires a reason (a preset reason or a custom note) before the
  booking saves; that reason is visible afterward to staff and to both
  the assigned and the booked instructor.
- Recurring weekly lesson series, with per-occurrence edit/cancel that
  doesn't disturb the rest of the series.
- Conflict checking: an instructor cannot be double-booked, including
  across the locations they work at (BR-01); a room can only be booked
  for an appointment at its own location.
- Student CRM extends Phase 1's stub: real profile fields, scoped notes
  per the spec's existing `notes.read_staff`/`notes.write_assigned`
  permission split, and `student_relationships` for linked couples
  (BR-02 — linking never merges notes, progress, or billing).

## Non-goals

- Appointment **completion** side-effects: entitlement consumption,
  earnings accrual, and the finalized-completion record. Per the
  roadmap, Phase 3 implements the state machine only
  (`scheduled → checked_in → completed`, plus `canceled` /
  `late_canceled` / `no_show`); the completion transaction itself is
  Phase 5/6.
- Any SMS/email reminder or notification sending. Confirmed with the
  product owner: in-app calendar visibility (an instructor's booked
  lesson shows up on their own calendar the moment it's booked) is
  sufficient for this phase. Real reminder delivery is Phase 7
  (communications), which brings the provider/consent infrastructure
  this would otherwise need to build early.
- Late-cancellation fee/policy enforcement — BR-04 says this is tenant
  policy, not hard-coded; defining and enforcing that policy is out of
  scope here (the state exists; what triggers it or what it costs does
  not).
- Curriculum/syllabus concerns (Phase 4) and any billing/entitlement
  concerns (Phase 5) — a booked lesson in this phase does not check or
  consume anything financial.

## Anti-goals

- A staffer double-booking an instructor or a room because the UI
  didn't make an existing booking visible.
- Anyone other than the owning instructor (and staff with the
  appropriate permission, per the spec's existing table) seeing what a
  "personal time off" block is actually for.
- A cross-instructor booking saving without a reason attached, once
  required.
- Editing one occurrence of a recurring series silently affecting
  others.

## Decided design

### Shared calendar

- Day view, instructor columns side by side, filterable by location
  (an instructor's columns only show for locations they work at, per
  BR-01's "instructors may work at many locations").
- Event rendering distinguishes four types visually (exact colors/
  patterns are a UI-polish detail for the plan, not re-litigated here —
  the brainstorm's mockup used accent-colored lesson blocks, a striped
  pattern for regular days off, a solid banner spanning all columns for
  studio holidays, and a muted block for personal time off):
  - **Lesson** — student name + room, visible to everyone with calendar
    read access.
  - **Regular day off** — a recurring weekly non-availability, visible
    to everyone as blocked, no further detail needed (it's not private,
    just routine).
  - **Studio holiday** — studio-wide, spans every instructor column for
    the day(s) it covers.
  - **Personal time off** — visible to everyone as "unavailable"; the
    actual label/reason is visible only to the instructor who owns it
    (and to staff holding whatever permission the builder maps this to
    — see "left to the builder").

### Instructor load surfacing

- Wherever staff pick an instructor for a new or currently-unassigned
  student (the free-first-lesson flow is the motivating case), show
  each instructor's current active-student count alongside their name,
  so a staffer unsure on personality fit can pick based on load instead.

### Cross-instructor booking reason

- Triggered when staff book a student who already has a primary
  assignment with an instructor other than the one being booked.
- A required prompt before the booking saves, offering preset reasons
  (at minimum: "Buddy Lesson", "Regular instructor unavailable this
  week", "Student considering switching instructors") plus a free-text
  note field.
- The saved reason/note is visible to: staff with scheduling
  permission, the student's assigned instructor, and the instructor
  being booked. Not a private note — all three parties see it.

### Recurring series

- A series defines a recurrence (weekly, per the brainstorm's framing —
  the builder can decide whether other cadences are needed this phase
  or deferred).
- Each generated occurrence can be individually edited or canceled
  without regenerating or disturbing the rest of the series — the same
  "this event only" pattern common calendar tools use.

### Conflict checking

- An instructor cannot hold two overlapping appointments, including
  across different locations they work at (BR-01).
- A room's appointment must belong to that room's own location; a
  cross-location room booking is rejected (acceptance test #5).
- **Decided with the product owner:** a regular day off, a studio
  holiday, or a personal time-off block is a hard conflict, enforced
  the same way as an instructor double-booking — rejected
  transactionally, not a warning staff can click through. If an
  instructor actually agrees to come in on a marked day off, staff
  clear/edit that block first, then book normally.
- Both checks run transactionally at write time (BR-01: "validate
  transactionally; add trigger if direct SQL writes are supported").

### Instructor–location mapping (builder decision, resolving a gap the
builder check found: Phase 1 never modeled which locations an
instructor works at — `memberships` only ties a user to a studio+role,
not to specific locations)

- A new explicit table associates an instructor (membership) with the
  locations they work at, rather than inferring it implicitly from
  appointment history. This is the data the calendar's per-location
  column filter and the cross-location double-booking check both need,
  and inferring it from history would make a brand-new instructor's
  first location assignment undefined.
- Exact table shape/name is a plan-level detail; the requirement fixed
  here is that it's explicit, assignable data — not derived.

### Appointment attendees (builder decision, resolving a schema-shape
gap: the base spec names "appointments, attendees" as distinct concepts,
and Phase 5/6's shared-couple-lesson billing needs one credit consumed
per appointment, not per attendee)

- Appointments are modeled with a collection of attendees from this
  phase onward, not a single `student_id` foreign key — even though
  billing/entitlement consumption itself is Phase 5/6's concern. Adding
  multi-attendee support later would force a breaking migration on live
  appointment data, which this codebase's own stated philosophy
  (building the Phase 6 outbox table early rather than bolting it on
  later) argues against repeating here.
- A single-student lesson is simply an appointment with one attendee —
  no special-casing needed for the common case.

### Student CRM

- Extends Phase 1's `students` table (currently just `id`, `studioId`,
  `displayName`) with real profile fields — contact info, etc. (left to
  the builder; nothing in this brainstorm fixed an exact field list
  beyond what BR-02 and the notes permission split already imply).
- Extends `student_assignments` (already has `isPrimary`,
  `effectiveAt`, `endedAt`) — this phase's assignment-reason/note
  feature above attaches to the *booking*, not to the assignment record
  itself; assignment changes (actually changing who the primary
  instructor is) are a separate, simpler action than the one-off
  cross-instructor booking reason.
- `student_relationships` for linked couples, per BR-02: linking is
  display/booking convenience only — never merges notes, progress, or
  billing between the linked students.
- Notes: scoped per the spec's existing permission table
  (`notes.read_staff`, `notes.write_assigned`) — this is inherited from
  the base spec, not a new decision made in this brainstorm. Instructors
  write notes only for their currently-assigned students; restricted
  notes are hidden from instructors per the spec's Owner/Admin/
  Instructor matrix.
- **Builder-check correction:** Phase 1's permission catalog grants
  `instructor` → `notes.write_assigned` but not `notes.read_staff`,
  which as named would let an instructor write a note on their own
  assigned student and never read it back — almost certainly an
  oversight, not an intended restriction. Decided here: note *read*
  access for an instructor is gated on "wrote it myself" OR "currently
  assigned to this student AND the note isn't marked restricted" — the
  same shape as the existing `canEditStudent` assignment-scoped pattern
  from Phase 1, applied to notes instead of profile edits.
- **Deferred (product decision):** the spec's substitute-instructor
  rule — time-limited read access to lesson-prep context for an
  instructor booked outside their normal assignment — is explicitly
  **not** built in this phase. A substitute (booked) instructor gets no
  extra note access beyond what they'd already have; the cross-
  instructor booking reason/note (above) is the only context they get.
  Revisit this once Phase 3 ships if it turns out to matter in
  practice.

## Constraints

- Builds on Phase 1's `students`/`student_assignments` tables — extend,
  don't replace (an explicit instruction left in `lib/db/schema.ts`'s
  own comment).
- Authorization follows Phase 1's established service-layer-check
  pattern (RLS plus an explicit permission check in code), not RLS
  alone — same discipline the spec calls out for assigned-student edits
  and note visibility.
- Conflict checks (instructor double-booking, room-location match) must
  be transactional, not just UI-level validation.
- No SMS/email sending infrastructure gets built in this phase (see
  Non-goals) — don't reach for Phase 7's communications primitives
  early.

## What's left to the builder

- Exact student CRM field list beyond what BR-02/notes imply (contact
  info shape, any additional profile fields).
- Exact calendar event colors/patterns/visual treatment (the brainstorm
  validated the *concept* — four visually distinct event types, one
  private-label exception — not literal hex values).
- Which locations' instructor columns show by default when a studio has
  several, and how the location filter is presented.
- Whether recurrence cadences beyond weekly are needed this phase, or
  deferred to a later addition.
- The exact permission code (new or existing — candidates include
  extending `appointments.manage_all`/`appointments.read_all` or adding
  a new one) that governs who besides the owning instructor can see a
  personal-time-off block's real label, and who counts as "staff with
  scheduling permission" for the cross-instructor booking reason's
  visibility.
- The exact shape of the new instructor–location mapping table and the
  attendees-as-collection table (both decided in principle above; table
  names/columns are a plan-level detail).
- Exact preset reason list beyond the three examples given (Buddy
  Lesson, regular instructor unavailable, student considering
  switching) — the builder may add more if an obvious gap shows up
  while implementing, but shouldn't remove the three named ones.
- The acceptance tests for #4 (cross-location double-booking) and #5
  (room/location mismatch) — exact test shape is a plan task, not
  decided here.
