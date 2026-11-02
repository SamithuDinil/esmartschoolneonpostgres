# E-SmartSchool.lk — Smart School Management System

E-SmartSchool.lk uses Firebase Authentication for identity and session verification, Neon PostgreSQL for application records, and Firebase Storage for files. Trusted server-side routes verify Firebase sessions and enforce school membership and permission checks. Application records retain the existing tenant-scoped document paths in a PostgreSQL JSONB table while the API migration remains incremental.

## Firebase and Neon setup

Use a Firebase project you administer. Enable **Authentication → Sign-in method → Email/Password** and **Google**, and configure the Firebase Storage bucket for file uploads. Add the Preview/deployment host to Authentication authorized domains. Set password policy and email enumeration protection in Firebase Console. Firebase Realtime Database is no longer used for application records.

Create a Neon PostgreSQL database and run [`db/schema.sql`](db/schema.sql) against it before starting the application. Use the Neon pooled connection URL for hosted runtimes and keep it private. Application data is written by server routes only; do not expose `DATABASE_URL` to client code. The current compatibility layer stores each record as JSONB addressed by the app’s established tenant-scoped paths, minimizing API churn while using Postgres as the authoritative data store.

The project requires these runtime values. Use the managed project secret input for values; never commit a real `.env` or service-account file:

```text
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON
DATABASE_URL
PG_POOL_MAX
```

`NEXT_PUBLIC_*` entries are Firebase web application configuration. `FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON` is highly privileged and must remain server-only. `DATABASE_URL` is the Neon PostgreSQL connection string. `PG_POOL_MAX` optionally controls the server pool size. Confirm the Firebase service-account project ID matches the configured Firebase project. Firebase Admin is used for Authentication and Storage; Neon is the sole app-record data store.

For local development, copy `.env.example` to `.env.local`, fill values securely, and apply `db/schema.sql` to the target Neon database. Configure Firebase Auth domains before inviting real users. Do not use real student records in emulator tests or the demo seed.

## First school administrator

Users can sign in with Google (verified Google emails only) or register an email/password Firebase Auth account, which sends a verification email. After verifying and signing in, the new user can create a school workspace through the full onboarding form and becomes its School Owner / Main Administrator. The onboarding transaction provisions the school record, unique school code, settings, academic year, default role definitions and owner membership. Active users can belong to multiple schools, switch the active tenant, and authorized owners can manage school memberships. For a fictional demonstration school, provide `DEMO_ADMIN_UID` to `pnpm seed:demo` in a controlled environment with `DATABASE_URL` set. The script merges fictional Silverleaf demo records and an admin membership, and does not run during app startup. It does not delete existing records. Do not use this demo seed against a school containing production records without reviewing the changes first.

The demo seed is intended for a dedicated test Firebase/Neon environment. It is not run automatically here. Its names are fictional and every seeded record is marked `isDemo`.

## Development and rules

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:rules
pnpm build
```

The PostgreSQL database is accessed only by trusted server routes. Every route must check the Firebase session, membership status, tenant, and permission itself; database connectivity does not replace application authorization. Do not expose Neon credentials or treat hiding a button as access control.

The session exchange requires a recently authenticated, email-verified Firebase ID token and a double-submit CSRF token. It issues an HttpOnly `webdev_app_session` cookie that is `SameSite=Lax` by default (`Secure` in production). Set `COOKIE_SAMESITE=none` only for an embedded HTTPS preview; browser third-party cookie restrictions may still apply. The current login screens use Firebase's client Authentication SDK; the Admin service account is used only on the server.

## Current workflow boundaries

Student registration currently captures name, preferred name, date of birth, gender, grade, class, admission date and guardian contact. The trusted service allocates a unique school/year admission number in a PostgreSQL transaction, creates the student and guardian records, writes initial enrollment history, and appends an audit event. CSV bulk import validates up to 1,000 rows and returns row-level errors. Assigned-class teacher scoping, verified guardian links and parent multi-child portal access are implemented; advanced profile editing remains incremental follow-up work.

Verified-user self-service school creation and first-owner membership are implemented at `/setup`. School memberships now support filtered user management, audited suspension/removal, expiring one-time invitations at `/invite`, owner-configurable vice-principal grants, and authenticated invitation acceptance. Email delivery uses the school notification outbox and requires a configured provider; passwords are never emailed or stored. The site has not been published. Third-party messaging, online payment, hardware tracking and live GPS are not enabled.
## Privacy and operations

Use fictitious data in development. Client Storage reads and writes are currently denied; keep them disabled until a trusted, record-bound upload flow stores ownership metadata in PostgreSQL. Do not make student files public or log signed URLs. The Firebase Admin SDK and service-account credentials are privileged and should be rotated/revoked through Firebase/Google Cloud controls if exposed. This project documentation does not replace legal advice or an institution's privacy impact assessment and obligations under Sri Lankan data protection law.

See `plan.md` for the full architecture and roadmap, and `TODO.md` for scope and progress. The rest of the requested system is intentionally marked pending until implemented and verified.

## Multi-school access

The authenticated school context is tenant-scoped and membership-driven. Users may now hold active memberships in multiple schools, view the schools available to their account from the shared shell, and switch the server-side `activeSchoolId` only after the target membership and school status are verified. School administrators with `memberships.manage` can add or suspend school-local members through `/memberships`; role permissions are copied from the centralized role matrix and every membership change is audited. Existing school records remain rooted under `schools/{schoolId}` in the Neon-backed document store and privileged server routes continue to verify membership independently.

## Authentication and dashboard hardening

E-SmartSchool.lk uses Firebase Authentication for email/password login, email verification, Google sign-in where enabled, password reset, and account recovery. Server sessions are verified with Firebase Admin, use HTTP-only cookies with SameSite=Lax by default, expire after the configured session window, and require CSRF validation for state-changing requests. Verified sign-ins and important administrative changes are audited. Session creation, username resolution, and invitation endpoints have bounded IP-based rate limits; deploy a shared Redis or platform rate limiter when running multiple instances.

The school dashboard now reads tenant-scoped counts and records for students, teachers, staff, classes, attendance, assignments, examinations, fees, enrollment trends, published performance data, quick actions, and recent audit activity. Teacher, student, and parent dashboards expose only their existing server-authorized records. Firebase MFA enrollment remains provider-configuration dependent and should be enabled with an institution-approved second-factor enrollment flow before requiring it for privileged accounts.

Attendance managers can assign an active class or subject teacher as temporary cover for a specific class and date. The substitute receives an in-app notification with a direct attendance link; authorization applies only to that date, the regular teacher’s class assignment remains unchanged, and the cover change is audited.

## Academic delivery modules

Examination workflows support scheduled sessions, school-specific grading schemes, marks entry for assigned teachers, draft/submitted/approved/published transitions, normalized subject and class averages, result trends, printable report cards, CSV exports, and deterministic in-app notifications after publication. Students and guardians cannot read unpublished results.

Assignments support scheduled publication, class recipients, secure private attachments, configurable file policies, draft and late submissions, multiple attempts, feedback and awarded marks, submission analytics, in-app notifications, and an authenticated assignment cron endpoint for scheduled publication and deadline reminders.

Timetables support academic-year schedules, configurable periods and breaks, manual and generated schedules, teacher/classroom/class conflicts, published schedule locking, teacher visibility, and a responsive weekly calendar. Announcements support school, role, grade, and class audiences with backend filtering, scheduling, editing, archiving, in-app notifications, and audit-compatible publication controls.

## Moving existing records from RTDB

1. Back up the Firebase Realtime Database and create/inspect the Neon target.
2. Apply `db/schema.sql` to Neon and set `DATABASE_URL` plus the Firebase service-account in a protected environment (set `FIREBASE_DATABASE_URL` only if the legacy RTDB URL differs from the default).
3. Run `CONFIRM_RTDB_TO_NEON_MIGRATION=yes pnpm migrate:rtdb-to-neon`. This copies the project’s prior `__edusphere_documents` records into `app_documents`, overwriting matching document paths in Neon. It never deletes or changes source RTDB records. Test against a separate Neon database first; review the imported row count and application behavior before routing production traffic.

The current Postgres document adapter keeps the existing Firestore-style paths and JSON document payloads so the 60+ route handlers can continue to share their established permission checks. This is a Postgres-backed transitional schema, not a fully relational normalization of each school domain. Query predicates are evaluated in the server adapter after fetching the matching collection; for large datasets, plan a later domain-by-domain SQL/index migration and verify pagination/transaction behavior at production scale.
