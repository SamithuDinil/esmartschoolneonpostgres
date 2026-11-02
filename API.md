# E-SmartSchool.lk API (implemented surface)

All application routes are implemented as Next.js App Router route handlers. JSON APIs return `Cache-Control: private, no-store` for user data. The Firebase Admin SDK is server-only; each protected data route must verify the app session and resolve an active school membership before touching tenant data.

| Method and path | Access | Current behavior |
|---|---|---|
| `GET /api/health` | Public | Liveness only; returns a generic status without Firebase identifiers. |
| `GET /api/auth/csrf` | Public | Issues a short-lived HttpOnly double-submit CSRF cookie and returns its nonce in same-origin JSON for the initiating browser. |
| `POST /api/auth/session` | Public + CSRF | Accepts `{ "idToken": "..." }`; verifies Firebase signature/revocation, verified email and recent authentication, then sets `webdev_app_session`. |
| `POST /api/auth/logout` | App session + CSRF | Revokes refresh tokens for the current UID when possible, then clears the session and CSRF cookies. |
| `POST /api/schools` | Verified app session + CSRF | Accepts `{ name, shortName?, country?, timeZone?, currency? }`; atomically creates a school, first `school_admin` membership, active academic year, settings and audit entry. A user may create one school; later invitations/multi-school switching remain unimplemented. |
| `GET /api/students?limit=50&after=<documentId>` | Active school; `students.read` | Server-paginated student listing scoped to the member's active school. Limit is 1–100. The current client displays at most 50 and filters the loaded page locally. |
| `POST /api/students` | Active school; `students.create`; CSRF | Accepts validated student name, date of birth, gender, grade/class, admission date and guardian name/email/phone. Creates a student, guardian contact record, initial enrollment and audit event in a Firestore transaction. Returns generated admission number. |

Invalid payloads return 400, missing/unauthorized school membership returns 403, and unexpected server failures use safe generic messages. Do not include Firebase credentials, private records, stack traces or signed URLs in errors.

## Tenant data contract

The current trusted service locates `users/{uid}.activeSchoolId`, then validates `schools/{schoolId}/memberships/{uid}.status == "active"` and reads its explicit string-array `permissions`. School setup creates the first membership through a Firestore transaction and refuses a second self-service school when the account already has an active school ID. Student records, guardians, enrollments and audit entries are written under that school's subcollections. The caller cannot set the school ID. The initial service creates independent student and guardian records but does not yet link a guardian's Firebase Auth UID; that relationship requires an administrator workflow before a parent portal can read the child.

This is a partial API contract for implemented functionality, not a specification of routes that do not exist yet. Additional modules must add their own validation, tenant boundaries, permission checks, audit behavior and docs before being exposed in the interface.

## Student CSV import

- `GET /api/students/import?sample=1` downloads `students-import-sample.csv` with every supported column and three SAMPLE rows.
- `POST /api/students/import` accepts multipart `file` (CSV, max 5 MB, max 1,000 rows). Header names are matched case-insensitively with common aliases (for example `DOB`, `Parent Email`). Dates accept `YYYY-MM-DD` or `DD/MM/YYYY`; `6` is stored as `Grade 6`.
- Response: `{ imported, total, skipped, errors: [{ row, message }] }`. Row numbers match the spreadsheet. Valid rows are imported even when other rows fail.
- Bulk operations (`/api/bulk`) use the same validation for `students_import`; `marks_import` writes to `exams/{examId}/marks/{studentId}` so imported marks appear in Examinations and Results.
