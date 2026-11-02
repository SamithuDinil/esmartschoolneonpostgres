# Authentication and platform administration additions

## Delivered in this change

- Email/password and username/password sign-in (username lookup uses `users.usernameNormalized`); verified email is still required.
- Password visibility control, remember-me (30-day session versus default five-day session), password reset email flow, and Firebase password policy controls.
- Current-device logout and a separate `/api/auth/logout-all` endpoint that revokes Firebase refresh sessions.
- Login event records under `users/{uid}/loginActivity`, including user agent, IP, provider and a simple IP-change suspicious flag.
- Extended school-role defaults, school/account suspension checks, server-verified platform-admin school management, school search/status filtering, plan assignment, creation and activation/suspension.
- Platform administrative actions recorded in `platformAuditLogs`.

## Required configuration

Only grant platform access by setting `users/{uid}.platformRole` to `super_admin` through a trusted operator process. Do not expose that field through client-writable user profile endpoints. Username sign-in requires each account to have `usernameNormalized` and `email` fields in its `users/{uid}` record; usernames must be unique and normalized to lowercase. Existing role permissions are stored on school membership documents; role defaults do not silently overwrite those grants.

The configured Firebase project must have email/password authentication enabled, Firebase Admin credentials configured, and password-policy / email templates configured in Firebase Console. Firebase Authentication provides its own abuse detection and throttling; add a production edge/WAF rate limiter for IP/device throttling before public launch.

## Remaining production work

This is not a complete implementation of every requested enterprise feature. Two-factor enrollment/challenge, a UI and API for administrators to edit individual permission grants, a UI for login-history/session management, expiring password-reset tokens beyond Firebase's built-in verified email flow, configurable plan definitions and feature flags, subscription expiry jobs, storage/error/performance telemetry dashboards, and complete platform-wide audit browsing are not included yet. Firebase ID-token/session verification and membership/school scoping remain mandatory; never rely on hidden links or client role state for authorization. Review Firebase rules and test all new data paths against the production project before deployment.
