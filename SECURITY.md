# Security notes

## Current controls

Firebase Admin service-account JSON is supplied through a protected server environment value and imported only from `src/lib/firebase/admin.ts` (`server-only`). Neon PostgreSQL is the authoritative application data store and is accessed only through trusted server routes. Routes perform their own Firebase session, active-school membership and granular permission checks. Firebase Realtime Database rules are retained only for the optional one-time legacy importer; they are not the current application data authorization boundary. Storage Rules currently deny every client read/write until record-bound upload authorization, document ownership metadata and audit behavior are implemented. Student mutations require a short-lived double-submit CSRF token and a verified Firebase session. Session cookies are HttpOnly, Secure in production, and SameSite=Lax by default (SameSite=None only when `COOKIE_SAMESITE=none` is set for an embedded HTTPS preview), and logout clears the cookie and revokes refresh tokens where Firebase accepts the revocation.

The initial student create operation uses an RTDB-backed atomic document transaction for admission-counter allocation, document creation, enrollment history and audit entry. It accepts only a Zod-validated request body. The tenant is taken from trusted membership resolution rather than user input. Medical/welfare data is not included in student list/detail fields in this initial slice.

## Required Firebase owner actions

Before using this app with real accounts, the Firebase project owner must enable Email/Password and Google Authentication providers, configure authorized domains and verified-email policy, create Realtime Database and Storage, deploy `database.rules.json` and `storage.rules`, configure `FIREBASE_DATABASE_URL`, and ensure service-account IAM is least-privilege. Client Auth settings and Firebase project IDs must match the intended environment. Do not execute the demo seed against a production school without a deliberate data review.

## Known gaps before production

- Self-service school creation for a verified account and first-admin membership are implemented transactionally. Verified invitations, membership administration, school switching, account suspension, and super-admin workflows are not yet implemented.
- Rate limiting is distributed (Upstash Redis if configured, otherwise RTDB counters). Abuse monitoring/alerting is still an operator task.
- Parent-to-child identity linking is not implemented; student records are not exposed through a parent portal.
- Student assigned-class teacher filtering, broad search, sensitive-data access-review workflow, document upload service, physical delete workflow and retention/consent controls are incomplete. Direct client Storage access remains disabled; do not enable uploads until document ownership, intra-school authorization and audit semantics are implemented and tested.
- RTDB uniqueness and references are enforced in trusted services. The compatibility adapter scans documents within a requested collection for queries; large deployments need purpose-designed RTDB denormalized indexes and pagination. Integrity/retention jobs and backup export/recovery procedures remain to be designed and tested.
- Legacy Firebase Realtime Database and Storage Security Rules tests (if run) do not validate Neon access or the application’s PostgreSQL authorization logic.
- Application check, MFA policy, audit log retention and external provider integrations require Firebase owner decisions and further implementation.
- Response headers (CSP, HSTS, X-Frame-Options SAMEORIGIN, Referrer-Policy, Permissions-Policy, COOP) are set in `next.config.ts`. The CSP still allows `'unsafe-inline'` scripts (Next.js inline bootstrap); move to nonce-based CSP via middleware later. `frame-ancestors 'self'` blocks embedding in third-party preview frames.

This document is an engineering implementation note, not legal advice. Review applicable Sri Lankan Personal Data Protection Act obligations and school-specific privacy requirements before storing real child or health information.


## Email and SMS gateway configuration
School administrators may select Resend and set the verified sender address, or select Twilio and set the sender number, in System settings. Provider secrets are deployment-only environment variables and must never be entered into browser settings or stored in PostgreSQL. Configure `EMAIL_PROVIDER_API_KEY` for Resend. For Twilio configure `SMS_TWILIO_ACCOUNT_SID` and `SMS_PROVIDER_API_KEY` (the Twilio auth token). Use a verified sender/number and review provider costs and recipient consent before enabling a channel.

External delivery is currently implemented for leave-decision notifications only. In-app notifications remain available regardless of gateway state. Email/SMS sends are best-effort; outcomes are recorded in the school-scoped `notificationDeliveryLogs` collection. Other notification events do not yet dispatch to external providers.
