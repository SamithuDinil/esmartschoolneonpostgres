# E-SmartSchool.lk — Architecture and Implementation Plan

## Approved direction and platform constraints

E-SmartSchool.lk is a multi-school school-management platform for Sri Lanka first, with future international expansion. Use Firebase Authentication for user identity and recovery, Cloud Firestore as the operational database, Firebase Cloud Storage for files, and Next.js with strict TypeScript for the application. Use Firebase Admin SDK only in trusted server code. Firebase client SDK is limited to authentication and client operations that are explicitly covered by restrictive Security Rules. The initialized Manus managed MySQL database and Manus storage remain unused; they are not a source of application data. The deployed application requires the Firebase project services to be enabled and configured. The application's Admin service-account value is a protected runtime secret and must never enter source control, browser bundles, examples, terminal output, or logs.

Firebase's Admin SDK bypasses Firestore Security Rules. Therefore every privileged server operation must repeat authentication, active-school membership, role/permission, and record-ownership checks in a shared authorization layer. Rules deny access by default and permit only justified client reads/writes. The Admin SDK must not be treated as authorization. Tenant isolation is enforced at collection/document path design, claims/membership checks, server domain services, Firestore rules and tests. A platform super-admin operation is separate, narrowly scoped, and audited. The selected Firebase project, Firestore database, Authentication providers, and Storage bucket must be provisioned and enabled by the project owner; environment values alone do not verify that setup.

The database is document-oriented rather than relational. Model related data with stable IDs, tenant-rooted paths, references and small denormalized display snapshots where query needs justify them. Avoid large unbounded arrays and cross-tenant collection-group queries. Use transactions or batched writes for invariants, server timestamps, explicit soft-archive/history records, and indexes committed as files. Use fixed-point integer minor units for LKR money, not floating-point values. Preserve event/history data for class moves, attendance corrections, marks and finance. Sensitive welfare/medical data is stored separately with narrower access and audited reads/changes. Validate user input with Zod on trusted boundaries; use Firebase rules validation for direct client access; validate file path, size and content type before authorizing uploads.

## System architecture

- **Web UI:** Next.js App Router, TypeScript strict mode, Tailwind CSS, accessible reusable components, React Hook Form and Zod. Use Lucide iconography, Recharts for appropriate analytics and restrained Framer Motion transitions. Responsive navigation and role-aware views do not substitute for authorization.
- **Identity:** Firebase Authentication email/password flow with verified-email and password-recovery flows. Client obtains Firebase ID tokens. A CSRF-protected server endpoint exchanges a recently authenticated ID token for a Firebase Admin-created HttpOnly application session cookie; verify cookies server-side and revoke/clear them at logout. Cookie name is `webdev_app_session`; set `HttpOnly; Path=/; SameSite=None; Secure` for public HTTPS Preview (do not decide based on internal HTTP or NODE_ENV). A verified user may create one school and its first administrator membership. Later invitations and school switching are planned, not yet implemented. Do not invent demo identities or development authentication bypasses.
- **Trusted server:** Next.js route handlers/server actions call shared session, tenant-context, permission, input-validation and audit helpers before Firebase Admin operations. Membership grants are explicit string-array permissions; role labels alone never authorize. Server-side pagination/filtering and tenant scoping are mandatory for list/search/report queries. Never accept a client-provided `schoolId` as proof of access.
- **Firestore:** All school records are rooted beneath `/schools/{schoolId}/...` except global user identity and carefully restricted platform data. Memberships connect Auth UIDs to schools and roles. User records hold only safe profile metadata. Use explicit tenant path builders. Use transactions for attendance uniqueness, receipt numbering, invoice allocation, enrollment changes and other invariants. Commit `firestore.rules`, `firestore.indexes.json`, and Firebase Emulator rules tests. Keep unmatched paths denied.
- **Cloud Storage:** Planned file keys are tenant-scoped, random and linked to a Firestore owner/document record; only a trusted upload flow may issue writes, and private documents must never be public. In the current foundation, `storage.rules` deny every client read/write until the record-bound authorization, ownership index, size/type checks and audit path exist. Store metadata and soft-delete state in Firestore; explain physical deletion requires a privileged Storage operation.
- **Operational integrations:** Email/SMS/WhatsApp, payment gateways, QR/RFID/biometric, GPS, and AI are not claimed operational absent corresponding configuration. Online payment states require verified provider confirmation. Hardware tracking stays disabled until configured. Core functionality must not need paid AI.
- **Localization:** English, Sinhala and Tamil with locale-aware strings, dates and number formats; Sri Lankan phone/address handling and LKR default. Build localization in reusable message catalogs rather than scattering translated strings.

## Data model and relationships

Primary tenant root: `schools/{schoolId}`. Tenant subcollections include `settings`, `academicYears`, `terms`, `grades`, `classes`, `subjects`, `students`, `guardians`, `studentGuardianLinks`, `enrollments`, `teachers`, `staff`, `teacherAssignments`, `studentAttendance`, `teacherAttendance`, `examinations`, `examinationSubjects`, `marks`, `gradingSchemes`, `timetables`, `timetablePeriods`, `assignments`, `assignmentSubmissions`, `feeStructures`, `invoices`, `payments`, `paymentAllocations`, `expenses`, `libraryBooks`, `bookCopies`, `bookLoans`, `vehicles`, `transportRoutes`, `transportAssignments`, `inventoryItems`, `inventoryMovements`, `suppliers`, `announcements`, `messages`, `notifications`, `events`, `documents`, `welfareRecords`, `auditLogs`, and `counters`.

Global `users/{uid}` stores minimal display metadata. Tenant `schools/{schoolId}/memberships/{uid}` stores membership status and school-local grants. Parent access is through verified `studentGuardianLinks`, never a client-supplied student ID alone. Student documents keep personal/contact/admission/profile status and references; highly sensitive medical/welfare details are separate. Enrollment records preserve student class/grade/year history. Teacher/staff profiles connect to membership and assignment IDs. Attendance records are unique by student/class/date (stable deterministic IDs or transactional duplicate checks) and correction events append audit history. Exams contain assessment configuration and results; marks have draft/submitted/approved/published states and amendment history. Timetables map periods to class/teacher/subject/room and retain schedule versions. Fee structures create invoices and line items; payments and allocations preserve immutable transaction records and unique receipt numbers. Library books separate catalog titles from individual copies and loans. Transport documents contain routes/vehicles/assignments; live GPS stays absent until integrated. Inventory movements are append-only. Notifications contain channel/status and delivery evidence; no provider means in-app only. Audit events record actor, tenant, action, record type/ID, timestamp, reason/context while avoiding unnecessary sensitive payloads.

Use composite document IDs or transaction-enforced uniqueness for admission numbers, employee IDs, subject codes, attendance, receipt numbers and other tenant-scoped uniqueness. Where Firestore cannot enforce relational foreign keys or unique constraints, validate references in trusted service transactions and run integrity checks; describe this explicitly rather than claiming SQL constraints.

## Permission matrix

Legend: **G** = platform action, explicit permission and audit; **M** = manage own school; **R** = review/approve/report in school; **A** = only assigned classes/modules; **S** = own published/allowed records; **C** = linked children only; **F** = specific grant only; **—** = no access. A visible interface control never grants permission. All reads/writes are checked in server service and, where client SDK paths are enabled, Firestore Rules.

| Domain | Super admin | School admin | Principal | Teacher | Student | Parent/guardian | Accountant | Librarian | Other staff |
|---|---|---|---|---|---|---|---|---|---|
| School accounts/settings | G | M | R | — | — | — | — | — | F |
| Memberships/role grants | G | M | R | — | — | — | — | — | F |
| Student/profile/academic | G* | M | R | A | S | C | fee fields only | circulation fields only | F |
| Medical/welfare/discipline | G* | narrow grant | narrow grant | explicit grant only | — | explicit lawful scope only | — | — | explicit grant only |
| Attendance | G* | M | R | A | S | C | — | — | F |
| Exams/marks/results | G* | M | R | A | published S | published C | — | — | F |
| Finance | G* | M | R/approve | — | own summary | linked-child summary | M | — | F |
| Library | G* | M | R | class scope | own loans | linked-child loans | — | M | F |
| Transport | G* | M | R | — | own route | linked-child route | fee fields only | — | F |
| Inventory | G* | M | R | — | — | — | F | — | F |
| Communication/events | G* | M | R | assigned classes | targeted notices | linked-child notices | fee notices | relevant notices | F |
| Reports/audit | G* | M | R | assigned scope | S | C | finance scope | library scope | F |

`G*` means support access must be specifically authorized and logged, not unrestricted browsing. School principals, administrators and teachers do not automatically gain access to sensitive welfare/medical information. Super-admin school operations are isolated from tenant operations and audited.

## UI and design system

Follow the supplied brief's premium enterprise SaaS direction: clean white and soft-gray surfaces with blue, indigo and violet accents, subtle gradients, soft shadows, rounded cards, professional typography, clear hierarchy, and low clutter. Use a persistent collapsible desktop sidebar and responsive mobile navigation. Provide global search, school-year selector, notifications, language/theme switching, profile and quick actions in the top bar. Dashboards must load actual authorized Firestore records; no fabricated live metrics. Tables include server pagination, sort/filter, explicit empty/loading/error states and safe bulk actions. Use keyboard-accessible dialogs/forms and reduced-motion preferences. Dark/light mode and command palette are shared shell capabilities. Keep transitions brief and functional.

## Project structure

The initialized source tree reflects the implemented foundation; new modules should be added by outcome rather than creating placeholder routes or unused feature folders:

```text
src/app/
  layout.tsx page.tsx setup/ dashboard/ students/         # sign-in, one-school setup, initial pages
  api/auth/{csrf,session,logout}/ api/health/              # session and liveness handlers
  api/schools/ api/students/                              # trusted tenant APIs
src/components/AppShell.tsx                               # authenticated responsive shell
src/features/{schools,students}/                          # focused onboarding and registry UI
src/server/{context,csrf,permissions}.ts                  # session, tenant and authorization
src/server/schemas/ src/server/services/                  # validated trusted domain operations
src/lib/firebase/{client,admin,session-client}.ts         # browser/Admin SDK boundaries
scripts/seed-demo.ts                                      # fictional, merge-only demonstration data
tests/{unit,security}/                                    # request and rule tests
firestore.rules firestore.indexes.json storage.rules      # Firebase policy/config
public/manus-routes.json                                  # page route manifest
app.config.ts (logo URL) README.md API.md SECURITY.md
plan.md TODO.md docs/firebase-platform-notes.md
```

Planned feature routes, locales and domain directories are added as their server authorization, data model, interaction and documentation are implemented; they are not presented as existing pages.

## Implementation roadmap

1. **Foundation:** establish Next.js/TypeScript/toolchain, route manifest, diagnostics, Firebase client/Admin initialization, environment template, session auth/recovery, tenant and permission helpers, Firestore/Storage rules and indexes, demo seed, shell/shared components, documentation and deploy-health endpoint. No real-world data in seed.
2. **Core school management:** school onboarding/settings; student/guardian records and enrollment history; teacher/staff records and assignments; academic years/terms, Grades 1–13, A/L streams, classes/subjects; class assignment/promotions; daily student/teacher attendance with duplicate prevention, corrections/audit, class roster and reports.
3. **Academic operations:** configurable examinations/grading, draft-to-published marks, calculations/results, PDF report cards; timetable editor/conflict detection/manual review and printable output; assignments/submissions/resources; academic reports.
4. **Administration:** fees/invoices/payments/refunds/audit and reconciliation data model; library catalog/copies/loans/fines; transport routes/vehicles/assignments; inventory/assets/movements/maintenance/suppliers; announcements/messages/events; school settings.
5. **Portals and advanced features:** role-specific dashboards, parent linked-child switcher, student portal, reports/PDF/XLSX/CSV exports, search, analytics, activity timeline, smart alerts, notification preferences and optional integrations.
6. **Production hardening and handoff:** unit/integration/end-to-end coverage, tenant/role isolation and Security Rules emulator tests, integrity checks, responsive/accessibility/security checks, performance with large datasets, production build, deployment instructions, admin setup, backups/recovery limitations, API documentation and operator security guidance. Publish only on explicit request; auto-publish is off.

Do not silently claim completeness across this large scope. After each meaningful module, record delivered behavior, relevant files, real Firebase/database integration, enforced authorization, key workflow evidence and limitations. Every unimplemented module and external integration remains clearly marked as pending.


## Modules 21–24 continuation plan

### Scope and implementation approach

Extend the existing Next.js App Router and Firebase Admin architecture rather than introducing a second data layer. Each module receives a server-gated route, a focused client panel, a tenant-scoped API route, and a small set of Firestore collection names under `schools/{schoolId}`. Server routes resolve the authenticated school context first; APIs repeat the role/permission checks and never accept a client-supplied school ID as authorization. Writes use validated JSON payloads, server timestamps, append-only movement/history records, and audit entries. Attachments remain private and are represented as protected metadata until a record-bound upload flow is configured.

Inventory uses `inventoryItems`, `inventoryMovements`, `suppliers`, `inventoryMaintenance`, and `inventoryTransfers`. Communication uses `announcements`, `notifications`, `messages`, and `communicationDeliveries`; scheduled publication and SMS/email/WhatsApp delivery are recorded as pending/queued until their authorized providers are configured. Parent and student portal routes read only linked-child or self records through the existing `studentGuardianLinks`, `accountUid`/`userUid`, published-results, assignment and report-card constraints. Portals deliberately expose no write controls for official academic records.

The first deliverable is an operational interface with persistent Firestore-backed reads/writes where Firebase is configured, explicit empty/error states where it is not, role-aware navigation, and accessible forms. External delivery providers, background scheduling, generated inventory exports and server-generated PDFs remain clearly pending unless configured by the school.

### Project structure additions

```text
src/app/inventory/page.tsx, communication/page.tsx, parent-portal/page.tsx, student-portal/page.tsx
src/app/api/inventory/route.ts, communication/route.ts, portals/route.ts
src/features/inventory/InventoryPanel.tsx
src/features/communication/CommunicationPanel.tsx
src/features/portals/ParentPortal.tsx, StudentPortal.tsx
src/server/schemas/inventory.ts, communication.ts
public/manus-routes.json
```

### Design direction

- **Alternative styles sampled:** Alpine civic utility (0.07); editorial campus ledger (0.06); luminous enterprise atlas (0.04).
- **Chosen movement:** luminous enterprise atlas — a continuation of E-SmartSchool.lk’s premium enterprise SaaS language with calm white surfaces, indigo/blue navigation, violet accent data points, and compact operational tables.
- **Core principles:** every state is legible; access boundaries are visible; dense records are softened by generous whitespace; actions stay close to the context they change.
- **Color philosophy:** blue and indigo signal trusted school operations, mint signals healthy stock or delivered work, amber signals attention such as low stock or pending publication, and rose is reserved for restricted or overdue states.
- **Layout paradigm:** persistent left navigation with a wide working canvas; pages open with a narrow operational summary rail and then a table-plus-action split rather than a centered dashboard grid.
- **Signature elements:** rounded status pills, thin indigo section rules, and small icon-led metric cards with an “access is role-scoped” treatment.
- **Interaction philosophy:** tabs switch between operational views without losing context; forms are short and progressive; destructive or restricted states explain why an action is unavailable.
- **Animation:** brief fade/slide transitions only for panels and notices; respect reduced motion and avoid decorative looping motion.
- **Typography system:** retain the existing system sans hierarchy; uppercase micro-labels, tight display headings, and readable 11–13px table text.
- **Brand essence:** a calm command center for schools that turns scattered operations into accountable, role-aware routines; composed, trustworthy, practical.
- **Brand voice:** headings are direct and operational; microcopy names the access boundary. Examples: “Keep every asset accountable.” and “Only authorized recipients will see this message.”
- **Wordmark & logo:** retain the existing graduation-mark + E-SmartSchool.lk wordmark supplied by Module 20.
- **Signature brand color:** E-SmartSchool.lk indigo `#315EE8`, used sparingly for active controls and trust cues.

## Modules 25–28 extension — Welfare, Events, Search and Analytics

### Implementation approach
- Add a restricted, tenant-rooted `/api/welfare` surface backed by incident, follow-up and access-log collections. Welfare access uses dedicated permissions, every read writes an access log, every mutation writes modification history, and no portal query includes welfare collections.
- Add `/api/events` for school-scoped event CRUD, publication/cancellation, participant targeting and reminder metadata. The events workspace provides month, week and day views and emits report-ready tabular data.
- Add `/api/search` with permission-aware collection selection. The global search command center returns only collections the current role can read, supports category/filter parameters and paginated results, and never queries confidential welfare data.
- Add `/api/analytics` to calculate academic, attendance, finance and administrative summaries from current school records with date/grade/class filters. The analytics page provides CSV, Excel-compatible and print/PDF workflows from the same filtered result set.
- Keep all new route pages behind the existing active-school session gate and add explicit role grants in `src/server/permissions.ts`. Extend `public/manus-routes.json`, the responsive shell and unit coverage.

### Design extension
- **Design movement:** Quiet operations console — probability 0.06. **Alternative:** Civic calendar ledger — probability 0.04. **Alternative:** Secure records atelier — probability 0.08. **Chosen:** Quiet operations console.
- **Core principles:** minimize disclosure, make time and state legible, preserve an audit trail, and let filters explain every number.
- **Color philosophy:** retain E-SmartSchool.lk blue/violet for ordinary operations; use a restrained amber/red signal only for welfare status and overdue events, never as decoration.
- **Layout paradigm:** a command rail, filter strip and evidence-first panels; calendar and analytics use wide work surfaces, while welfare uses compact restricted-record cards.
- **Signature elements:** privacy badges, thin evidence rules and a single active filter ribbon.
- **Interaction philosophy:** every sensitive action states who can see it, every export inherits visible filters, and empty states explain what authorization or publication is required.
- **Animation:** short fade/slide for search suggestions and modal state only; no motion on sensitive record content; respect reduced-motion settings.
- **Typography system:** existing Inter/system sans hierarchy; 10px uppercase labels for permissions and 12–14px readable record copy.
- **Brand essence:** a calm school operations desk that turns sensitive records into accountable action; precise, protective, composed.
- **Brand voice:** headlines say what is actionable; CTAs say what will be recorded. Examples: “Keep the welfare trail restricted.” / “Publish event to selected participants.”
- **Wordmark & logo:** preserve the existing E-SmartSchool.lk graduation-mark wordmark and durable project logo.
- **Signature brand color:** E-SmartSchool.lk blue `#315ee8`.

### Project structure
- `src/app/welfare`, `src/app/events`, `src/app/reports/analytics`: authenticated route shells.
- `src/features/welfare`, `src/features/events`, `src/features/analytics`, `src/features/search`: client workspaces and interactions.
- `src/app/api/welfare`, `src/app/api/events`, `src/app/api/search`, `src/app/api/analytics`: server-side authorization, tenant scoping, persistence and calculations.
- `src/server/schemas`: strict request contracts for sensitive incidents and events.
- `tests/unit`: module request and permission boundaries; existing Firebase rules remain unchanged because new data is Admin-SDK mediated.

## Modules 29–32 extension — Bulk Operations, Documents, Notifications and Promotion

### Implementation approach
- Add a role-scoped `/bulk-operations` workspace with preview-first import validation for students, marks and payments. The server validates file shape and required columns, normalizes records, detects duplicates/invalid values, returns preview errors, and only writes after an explicit confirmation action. Batch writes use Firestore transactions/batches and return an import summary.
- Add `/documents` backed by private Firebase Storage paths under the current school, document metadata in Firestore, signed-download URLs, replacement/archive actions and upload history. Every operation validates the storage path against the school and record scope.
- Add `/notifications` backed by school notification records scoped to the recipient UID. The shell shows unread counts; the center supports category filters, mark-read/all-read, archive/delete and preference updates. Deep links are stored and validated as relative in-app paths.
- Add `/promotion` with an eligibility preview for a selected year/grade/class, destination capacity validation, individual or bulk promotion, repeat/transfer/graduation/completion outcomes, and transactionally preserved enrollment history. No academic, attendance or result records are mutated.
- Extend the role matrix, route manifest, responsive shell and unit tests. Keep bulk writes, document downloads, notifications and promotion server-authorized and tenant-scoped.

### Design extension
- **Design movement:** Ledger room — probability 0.07. **Alternative:** Quiet archive — probability 0.05. **Alternative:** School operations runway — probability 0.08. **Chosen:** Ledger room.
- **Core principles:** preview before commit, show the provenance of every file, preserve history, and make notification state visible without noise.
- **Color philosophy:** blue for approved operations, violet for workflow transitions, amber for validation review, and rose only for destructive/archive or capacity errors.
- **Layout paradigm:** a three-step command surface — choose, preview, commit — with evidence tables below; documents and notifications use compact record rails.
- **Signature elements:** import stepper, private-storage badge, and a persistent “history retained” footer.
- **Interaction philosophy:** no bulk mutation happens on upload alone; users must see validation errors and confirm the exact operation. Downloads use signed URLs, not public paths.
- **Animation:** short progress transitions for import steps and notification state changes; no looping decoration; honor reduced motion.
- **Typography system:** retain E-SmartSchool.lk system sans, using uppercase stage labels and 11px evidence tables.
- **Brand essence:** a careful school records room where high-volume changes remain reviewable; deliberate, transparent, safe.
- **Brand voice:** “Preview the change set.” / “Commit only the valid records.”
- **Wordmark & logo:** preserve the existing E-SmartSchool.lk graduation-mark wordmark.
- **Signature brand color:** E-SmartSchool.lk indigo `#315EE8`.

### Project structure
- `src/app/bulk-operations`, `src/app/documents`, `src/app/notifications`, `src/app/promotion`: authenticated route shells.
- `src/features/bulk`, `src/features/documents`, `src/features/notifications`, `src/features/promotion`: client workspaces.
- `src/app/api/bulk`, `src/app/api/documents`, `src/app/api/notifications`, `src/app/api/promotion`: server validation, private storage, notification state and transactional enrollment updates.
- `src/server/schemas/bulk.ts`, `promotion.ts`: strict request contracts and operation types.

## Modules 33–37 extension — Certificates, audit, recovery, language and mobile

### Implementation approach
- Add tenant-scoped `/api/certificates` for approved certificate issuance. Load verified student records server-side, generate sequential certificate numbers, retain immutable certificate history, and expose a print/PDF-ready certificate view with school branding and signature areas. Certificate generation is permission-gated and requires explicit approval before issuance.
- Add `/api/audit` and an administrator-facing audit workspace. Reuse the existing school-scoped `auditLogs` collection and extend audit capture for authentication, student, attendance, examination, finance, permission and settings changes. Audit records are append-only from application code and ordinary users receive no mutation surface.
- Add `/api/backups` plus a `/backups` control panel for encrypted, access-controlled backup status, retention settings, failure alerts, recovery documentation and restoration-test records. Add the scheduled callback contract at `/api/scheduled/backups`; it validates the platform schedule identity when available and is idempotent. The control panel distinguishes configured/pending scheduled execution from completed runs.
- Add a client-side language provider with English, Sinhala and Tamil dictionaries for navigation, common labels, forms, validation, notifications and report headings. Persist preference per signed-in user and local storage; keep legally significant certificate/legal copy in reviewed translations only.
- Audit the existing AppShell, tables, forms, report cards and module controls for mobile behavior. Preserve the current collapsible navigation, add touch-safe controls and responsive overflow/stacks for all new surfaces, with print-friendly certificate and report layouts.

### Design extension
Use the existing E-SmartSchool.lk quiet operations-console language: white surfaces, ink-blue text, cobalt actions, violet secondary accents, rounded 16px panels and compact uppercase eyebrow labels. Certificates use an A4 document treatment with a centered seal, restrained border, school identity block and three signature lines. Audit and backup pages use status-led rows and explicit verified / pending / failed states rather than decorative metrics. Sinhala and Tamil use Unicode-capable system fonts with generous line-height and never fall back to machine-generated legal wording.

### Project structure
- `src/app/api/certificates`, `src/app/api/audit`, `src/app/api/backups`, and `src/app/api/scheduled/backups`: authenticated tenant APIs and scheduled backup callback.
- `src/app/certificates`, `src/app/audit`, `src/app/backups`: role-gated pages.
- `src/features/certificates`, `src/features/audit`, `src/features/backups`: client workspaces and print-ready certificate view.
- `src/lib/i18n`: dictionaries, language provider and preference helpers.
- Shared shell, permissions, route manifest, CSS and audit helpers are extended without replacing existing modules.

## Modules 38–40 extension — Optional AI, persistent settings and integration

### Implementation approach
- Add a role-scoped `/api/ai` assistant that first computes deterministic, tenant-scoped aggregates for absence, low attendance, examination performance, overdue invoices and this-week events. AI remains disabled by default through a school `settings/ai` document; when enabled, only redacted aggregate context may be sent to the built-in platform LLM, with a deterministic answer retained as the safe fallback. No student names, admission numbers, contact details or confidential welfare records enter the prompt.
- Add `/ai-assistant` with question chips, clear disabled/provider-pending states, source summaries and a visible “authorized school data only” guardrail. The core application remains functional when AI is disabled.
- Add `/api/settings` and `/settings` for persistent general, academic, security and notification configuration. Reuse existing school profile/configuration collections, write `settings/system`, keep provider credentials out of the browser, preserve audit history and apply date/currency/language/time-zone preferences to the settings surface and downstream summaries.
- Add `/api/integration` and `/integration` as a real-data workflow health center. It inspects the shared school database for student enrollment, guardians, academic enrollments, fee structures, attendance, exams/results, receipts, absence queue, analytics and notification queue linkage. It also provides an append-only integration event ledger for future workflow orchestration without fabricating records.
- Extend permissions, shell navigation, route declarations and unit tests. Keep all reads tenant-scoped, all mutations CSRF-protected, and all external AI/provider calls optional and server-only.

### Design extension
- **Design movement:** Evidence desk — probability 0.07. **Alternative:** Civic control room — probability 0.05. **Alternative:** Quiet data atelier — probability 0.08. **Chosen:** Evidence desk.
- **Core principles:** explain every answer’s source, default to safe disabled states, make configuration reviewable, and surface broken links between modules before they become silent data loss.
- **Color philosophy:** retain E-SmartSchool.lk indigo for trusted actions; use mint for verified links, amber for pending configuration, and rose only for blocked or unsafe states.
- **Layout paradigm:** a question rail and evidence ledger for AI; a four-tab configuration desk for settings; a workflow map and status table for integration health.
- **Signature elements:** source chips on AI answers, persistent “AI disabled / enabled” status, and connection-state dots for cross-module records.
- **Interaction philosophy:** AI never mutates records; settings show exactly where a value is stored and what it affects; integration checks are read-only unless the user explicitly records an internal event.
- **Animation:** short status transitions only; respect reduced motion and never animate private data.
- **Typography system:** existing E-SmartSchool.lk system sans with compact uppercase labels for source provenance and config scope; comfortable Unicode fallbacks for multilingual values.
- **Brand essence:** a school operations system that can explain itself without overreaching; transparent, careful, useful.
- **Brand voice:** “Ask from the records you are allowed to see.” / “Review the connection before you rely on the number.”
- **Wordmark & logo:** preserve the existing E-SmartSchool.lk graduation-mark wordmark.
- **Signature brand color:** E-SmartSchool.lk indigo `#315EE8`.

### Project structure
- `src/app/api/ai`, `src/app/api/settings`, `src/app/api/integration`: tenant-scoped server APIs with redaction, persistence and audit boundaries.
- `src/app/ai-assistant`, `src/app/settings`, `src/app/integration`: authenticated route shells.
- `src/features/ai`, `src/features/settings`, `src/features/integration`: client workspaces.
- `src/server/services/ai.ts`, `src/server/services/integration.ts`: deterministic aggregate builders and cross-module health checks.
- Extend permissions, AppShell, route manifest, global styles, tests and TODO without replacing earlier module behavior.
