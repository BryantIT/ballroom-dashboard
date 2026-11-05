# Ballroom Dash — Implementation Specification v0.3

Date: 2026-11-05. Status: proposed implementation baseline, pending review and integration tests.

## Product scope and non-goals

Multi-tenant SaaS for independent ballroom studio businesses, each with one or more physical locations. One global user identity can have memberships in several studios. Students are CRM records and cannot log in. Instructors see all studio students but may change assigned students only; each student may have several instructors. Dance catalogs are fully studio-defined. Syllabi may belong to a studio or individual instructor, with assigned versioned curricula and independent progression per student. Purchases include individual lessons, packages, memberships, events, and external competition entries. Authorized staff create appointments; no student self-booking. Compensation supports versioned configurable rules. External competitions are managed as entries and charges; judging/heat scheduling is **not** a product responsibility.

Non-goals for initial release: tax withholding and payroll remittance, public booking, event judging/scoring, arbitrary scripting in compensation conditions, accounting general ledger, social-platform support prior to connector/API feasibility review.

## Domain boundaries

1. **Platform** — global identities, tenant provisioning, SaaS subscriptions, tenant state.
2. **Studio and authorization** — locations, rooms, employee memberships, local roles, permission assignments.
3. **Students and CRM** — individual students, instructor assignments, partnerships, scoped notes.
4. **Scheduling** — appointments, attendees, instructors, conflicts, recurring schedule series, completion.
5. **Curriculum** — dances, levels, figures, versioned syllabi, assigned versions, student progress.
6. **Commercial** — products/prices, billing accounts, invoices, payments, refunds, entitlements, memberships.
7. **Compensation** — plan versions, matching rules, accruals, reversals, pay runs.
8. **Events and competitions** — studio events and registration; external competition entries and charges.
9. **Communications and audit** — conversations, consent state, webhooks, audit events.

## Data conventions

- PostgreSQL 15+; UUID primary keys and `timestamptz` timestamps in UTC; studio/location-specific IANA timezones used for display and recurrence calculations.
- IDs for tenant-owned records include `studio_id`; composite tenant-aware foreign keys for critical relationships. Tenant scoping is enforced at the API authorization boundary and additionally through PostgreSQL RLS policies.
- For monetary amounts store `bigint` integer **minor currency units** plus ISO-4217 currency codes. Use explicit exact rounding rules when calculating percentages. Fractional lesson units are `numeric(12,3)`.
- Soft-deactivate employees and students; do not cascade-delete financial or historical business records.
- Published syllabus versions and activated compensation plan versions are write-locked in application logic; create new versions for changes. Snapshot prices and compensation calculations.
- Sensitive contact info and notes require retention, encryption/access-control, and consent policies to be finalized.

## Permissions and records

Suggested permission codes (seed in `app.permissions` and assign to tenant-local roles):

| Capability code | Owner | Admin | Instructor |
|---|:---:|:---:|:---:|
| `students.read` | yes | yes | yes |
| `students.create` | yes | yes | yes |
| `students.update_all` | yes | yes | no |
| `students.update_assigned` | yes | yes | yes |
| `students.assign` | yes | yes | no |
| `notes.read_staff` | yes | yes | restricted |
| `notes.write_assigned` | yes | yes | yes |
| `appointments.read_all` | yes | yes | yes |
| `appointments.manage_all` | yes | yes | no |
| `appointments.manage_self` | yes | optional | yes |
| `curriculum.manage_shared` | yes | optional | no |
| `curriculum.manage_own` | yes | no | yes |
| `progress.record_assigned` | yes | no | yes |
| `billing.read_detail` | yes | yes | no |
| `billing.process` | yes | yes | no |
| `entitlements.read_relevant` | yes | yes | yes |
| `compensation.configure` | yes | no | no |
| `compensation.view_own` | yes | no | yes |
| `reports.financial` | yes | optional | no |
| `events.manage` | yes | yes | limited |
| `competitions.manage_entries` | yes | yes | optional |
| `communications.send` | yes | yes | optional |
| `users.manage` | yes | no | no |
| `integrations.configure` | yes | no | no |

Platform administrators use a separate support-only control plane; access to tenant PII requires an explicit audited support session, not an implicit global bypass.

**Row and field authorization rules:** Studio membership must be active; tenant must be active; instructor assignment must be effective at operation time for student edits; instructors' notes are separately visibility-scoped. Instructors may update progress records for their assigned students, but do not get automatic access to billing details. A substitute can access lesson-specific educational context by a separate time-limited capability, without permanent student edit access. Group attendance editing applies only to instructor's assigned appointments.

## Core business rules

**BR-01 Studio/location.** Studio is tenant; location belongs to one studio. Instructors may work at many locations. Rooms belong to one location. A room booked for an appointment must belong to that appointment's location (validate transactionally; add trigger if direct SQL writes are supported).

**BR-02 Students.** Students are separate individuals. Link couples via `student_relationships`. Linking does not merge progress, notes, billing, or personal information. The same studio may have multiple concurrent instructor assignments; at most one current primary assignment is enforced in v0.3. Overlapping historical primary intervals need a further exclusion/trigger rule.

**BR-03 Entitlements.** Purchase grants units to a billing account; `entitlement_beneficiaries` identifies eligible students. A shared couple lesson consumes units **once per appointment/package consumption event**, not once per attendee, unless a product's explicit configured unit rule provides otherwise. Select earliest-expiring eligible grant first by default. Balance = grant units plus signed ledger changes (define whether initial grant transaction is also recorded to avoid double counting). Freeze or disallow a completion transaction that would overdraw a grant. Use row locking or SERIALIZABLE transactions for concurrent consumption.

**BR-04 Appointment states.** `scheduled -> checked_in -> completed` (check-in optional); alternative terminal outcomes `canceled`, `late_canceled`, `no_show`. Completion is idempotent and generates a finalized completion record, eligible entitlement consumption, and earnings accrual. Reversal is a new compensating entitlement/earning transaction, not deletion. Late cancellation charges are tenant policy, not hard-coded.

**BR-05 Financials.** Draft invoices can be changed; issued invoices are immutable except via credit notes/void/reissue. Invoice totals and allocation sums are verified in service transactions. Payment provider webhooks are authenticated and processed idempotently. A payment may allocate across invoices. Refunds do not automatically imply reclaiming previously consumed lessons; define an explicit adjustment workflow. Card details are never stored locally.

**BR-06 Memberships.** A plan defines billing cadence and benefits; a subscription records account-specific state. Periodic benefits generate separately traceable entitlement grants. Renewal or cancellation must be idempotent; rollover, grace periods, and failed-payment handling are configurable by the studio within supported policy types.

**BR-07 Compensation.** Activate plan versions with effective dates; match deterministic rule conditions, priority, and stacking behavior; use explicit source amounts (e.g., collected revenue, billed revenue, completed lesson, duration) and exact rounding. Earnings snapshot matched rules, inputs, currency, and amounts. Two instructors on a lesson can receive different independently computed earnings. Reverse/adjust historical earnings rather than retroactively updating them. Pay runs export approved earnings, not calculate statutory payroll.

**BR-08 Curriculum.** Instructor syllabi and shared syllabi are separately owned. Assign a specific published version to a student; progress references items from the same assigned version. Editing a published syllabus creates another version. Student progress changes are append-audited. Permissions to alter a shared curriculum are separate from permissions to track progress.

**BR-09 Competition scope.** An external competition is an outside event with its own organizer and dates. A competition entry can have multiple student and professional participants and a dance, level, division and heat descriptor. Studio bills students for entry fees, heats, travel or coaching through invoice lines. No competition operation, scoring, or heat generation is promised.

**BR-10 Messaging.** The student's channel/purpose consent and opt-out state controls marketing sending; transactional traffic must also comply with applicable communication requirements. Provider webhooks are verified, deduplicated and retained for troubleshooting without retaining unnecessary sensitive payloads.

## Transaction workflow: finalize a private lesson

1. Authenticate actor, verify studio and student/appointment permissions; start transaction and set trusted tenant context.
2. Acquire lock on target appointment and applicable entitlement grant/ledger aggregate.
3. Verify appointment not already finalized, participants and instructor memberships belong to tenant, and resource/time rules are satisfied.
4. Transition appointment to completed and insert one `lesson_completions` record.
5. Apply chosen consumption policy once to appropriate entitled grant(s) using unique idempotency keys; prevent overdraw.
6. Evaluate active compensation assignments and rules at lesson service time, produce immutable `instructor_earnings` with calculation snapshots and unique idempotency keys.
7. Append audit record; commit. Send receipts/notifications asynchronously after commit through an outbox (outbox is a next migration).
8. For correction, create compensating entitlement and earnings entries, update completion status to reversed, and append audit log.

## Compensation rule contract (proposed; not arbitrary code)

A rule's conditions and calculations are JSONB but must be validated by a **versioned JSON Schema** and interpreted by a deterministic, restricted evaluator. Example:

```json
{
  "priority": 10,
  "condition": { "all": [ { "field": "lesson.kind", "operator": "eq", "value": "private" }, { "field": "location.id", "operator": "eq", "value": "<studio-location-uuid>" } ] },
  "calculation": { "type": "flat", "amount_minor": 3500, "currency_code": "USD", "unit": "completed_lesson" },
  "stacking": "additive"
}
```

Future permitted `calculation.type` values: `percentage`, `hourly`, `tiered`, `bonus`, `deduction`; define source fields and cutoffs precisely. Reject malformed or unsupported operations at plan publication. Evaluate with deterministic order and no executable expressions from users. This is configurable but deliberately not a general-purpose scripting engine.

## Suggested API boundaries

- `POST /v1/studios`, `GET /v1/studios/{studioId}`, `POST /v1/studios/{studioId}/locations`
- `POST /v1/studios/{studioId}/invitations`, `GET /v1/studios/{studioId}/memberships`
- `GET/POST /v1/studios/{studioId}/students`, `PATCH /v1/studios/{studioId}/students/{studentId}`
- `POST /v1/studios/{studioId}/students/{studentId}/instructor-assignments`
- `GET/POST /v1/studios/{studioId}/appointments`, `POST /v1/studios/{studioId}/appointments/{id}/complete`
- `POST /v1/studios/{studioId}/appointments/{id}/reverse-completion`
- `GET/POST /v1/studios/{studioId}/syllabi`, `POST /v1/studios/{studioId}/syllabi/{id}/publish`
- `POST /v1/studios/{studioId}/invoices`, `POST /v1/studios/{studioId}/payments`
- `GET /v1/studios/{studioId}/billing-accounts/{id}/entitlements`
- `POST /v1/studios/{studioId}/compensation-plans/{id}/versions/{versionId}/activate`
- `POST /v1/studios/{studioId}/external-competitions/{id}/entries`
- `GET /v1/studios/{studioId}/reports/financial?from=&to=&locationId=`

Every mutation must use a scoped request actor, server-side authorization, input validation, and audit logging for sensitive operations. Use pagination and filtering on list endpoints. `Idempotency-Key` is required for charging, completion, refunds and external integrations.

## Acceptance tests to prioritize

1. User belongs to Studio A and Studio B, but permissions and roles do not leak between them.
2. Instructor at Studio A can view all A students but cannot edit an unassigned student's profile or view restricted notes.
3. Instructor at Studio A cannot access another studio's students by changing UUID or tenant header.
4. Studio A schedules instructors at two locations; double-booking checks span locations.
5. A room from Location A cannot be used by a lesson at Location B.
6. Two linked students share one package; one private couple lesson consumes only one lesson credit under default policy.
7. Two simultaneous completion requests never double-consume credits or double-generate earnings.
8. Plan price and compensation plan changes do not alter prior invoices or earning snapshots.
9. Curriculum version N remains attached to an existing student's progress after publishing version N+1.
10. An external competition entry can have both student and professional partner, multiple charges, and no need for judging data.
11. Membership renewal webhook retry creates no duplicate invoice or benefits.
12. Refunding a payment does not silently erase an attended lesson or compensation history.
13. All report queries filter by tenant, dates, and optionally location, without exposing other studios.
14. Disabling an instructor preserves their prior lesson notes and earnings history.
15. Missing tenant context produces no tenant-owned rows under RLS.

## Security and implementation cautions

The initial SQL migration is a **schema baseline**, not a production-certified complete system. It has tenant RLS policies, many composite FKs, and important unique/idempotency constraints, but still needs:

- Permission-aware query/service methods; RLS alone does not enforce assigned-student edits or note visibility.
- Runtime database role grants and secure tenant-context setup (trusted API transactions; no user-controlled SQL). Migration owner and runtime roles must be distinct. A connection pool must reset tenant context; use `SET LOCAL`/`set_config(..., true)` inside every transaction.
- Database trigger(s)/additional constraints for room-location consistency, progress-item/version consistency, nonoverlapping compensation assignments and completed financial arithmetic.
- Completed compensation engine, webhook validation, accounting reconciliation, and outbox worker.
- Regular backup/restore drills, retention policies, security reviews and integration tests.
- A migration framework and automated PostgreSQL integration test environment.
- Explicit encryption and authorized handling for personal notes, payment processor tokens, and external-provider secrets (prefer a secrets manager).
- Taxes, coupons, consent/legal policy, PCI merchant setup, provider fees and per-studio settlement settings before launch.

## Follow-up decisions requiring product input

- Can multiple *studio businesses* be consolidated into one enterprise/franchise group (not required for the baseline)?
- Should the owner control whether instructors can edit other instructors' progress entries for mutually assigned students?
- Should instructor compensation calculations be driven by **collection**, **revenue**, **lesson delivery**, or combinations, and should negative adjustments be automatic on refunds?
- Can packages span multiple locations by default? Proposed yes unless restricted by product.
- Should package credits expire, roll over, or be transferrable? Make per-product settings with allowed patterns.
- What is the first payment provider/card-reader ecosystem and SMS provider? Adapter design can precede provider selection; hardware/flow implementation cannot.
- Is platform SaaS subscription metered by instructors, active students, location, or flat fee?

## Implementation order

1. Platform/studios/memberships/locations/RLS and permission tests.
2. Students/assignments/notes and calendar scheduling.
3. Syllabus catalog and student progress.
4. Billing accounts/products/invoices/payment integration/entitlements.
5. Lesson completion as idempotent transaction; then compensation engine and reporting.
6. Membership renewals, events, external competition entries, communications, and social media connectors.

Keep all migration scripts forward-only and additive when production data exists. Run a full fresh database integration test against the baseline SQL before treating it as executable production DDL.
