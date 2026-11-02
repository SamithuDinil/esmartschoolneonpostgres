

## Module 14 — Automatic result calculation
- [x] Calculate subject grades using per-examination grading bands or the configurable school default; calculate overall subject marks, totals, weighted percentage average, pass/fail, class/subject average, high/low marks, and historical published subject averages.
- [x] Expose optional class rank using administrator-configurable competition, dense, or ordinal rules; rankings default off. Student/guardian result lookup is restricted to published exams and the student account or guardian-child link; backend APIs enforce access independently of page routes.
- [x] Keep results private until the examination is published. Approved/published marks retain the existing correction permission and audit workflow.
- [ ] Add dedicated metrics dashboard charts/export, configurable minimum promotion thresholds and moderation/recheck workflows; run school-specific grading/policy acceptance tests before production.

## Module 15 — Report-card generator
- [x] Create student and bulk-class report cards with school identity/logo, student identity, enrollment grade/class, academic year, examination, subject-wise marks/grades, totals, average, available attendance summary, teacher/principal comments and signature lines.
- [x] Print-ready A4 layout supports one-click browser Print / Save as PDF; comments are saved under the school/exam/student record with permission checks and audit entries. Published reports can be selected by students and linked guardians only.
- [ ] Add a persistent report-card template editor, official server-generated PDF archive and photo/document URL setup for installations that have not configured those records.

## Module 16 — Timetable management
- [x] Configure recurring weekday periods and breaks by academic year; create weekly entries and publish/retain the original academic-year association. Staff may view whole-school, class, teacher or classroom schedules; teacher accounts see only their own published schedule.
- [x] Manual and generated entries require matching active teacher subject/grade/class assignments and configured non-break periods; tenant-scoped conflict checks prevent double-booking a teacher, class or room at a day/period. The generator honors required weekly periods, teacher and classroom unavailable day/period slots, allowed days, weekly workload caps, daily workload caps and existing schedules, and only saves a complete generated schedule.
- [ ] Add schedule revision/republish workflows, a visual drag-and-drop calendar, import/export/print layouts and integrations for availability sourced directly from leave/HR records.

## Module 18 — School finance management
- [x] Support configurable admission, monthly, term, examination, transport, activity and other fee charges. Create student invoices with generated invoice numbers, due dates and discounts; track outstanding balances; support partial and full cash and bank-transfer payments plus server-verified online payments; generate printable receipts, upload private receipt evidence and export invoices.
- [x] Display total and monthly revenue, collected and pending fees, overdue invoices, expenses and net financial summaries from persisted school records.
- [x] Let authorized finance users create categorized expenses, attach PDF/image receipt evidence stored privately, approve expenses, inspect expense history and generate expense reports. Use transaction-safe accounting operations and immutable financial audit records. Do not accept browser claims as proof of an online payment.

## Module 19 — Library management
- [x] Register and update books with ISBN, authors, categories and copy counts; search and filter inventory.
- [x] Issue books to authorized borrowers with issue/due dates; record returns; calculate overdue periods and applicable fines; record fine payments; produce borrowing reports.
- [x] Display total, available, borrowed and overdue books, popular titles and recent transactions from persisted library records.

## Module 20 — Transport management
- [x] Maintain vehicles with registration number, type, seating capacity, driver, assigned routes, maintenance records and status. Maintain routes with ordered pickup/drop-off points, assigned vehicles/drivers, assigned students, schedules and configurable transport fees.
- [x] Show passenger lists, route schedules, transport-payment tracking via linked school invoices, maintenance reminders and vehicle-availability reports.
- [x] Never represent simulated or stored route data as live GPS tracking; transport UI clearly states that live location is not provided.

## Module 21 — Inventory and asset management
- [x] Register assets in the categories computers, printers, laboratory equipment, furniture, sports equipment, office supplies, and classroom resources; assign asset codes, record quantities, locations and conditions; record purchases, suppliers, maintenance and transfers; generate inventory reports.
- [x] Support stock-in transactions, stock-out transactions, stock adjustments, minimum stock levels, low-stock alerts, and stock movement history.
- [x] Keep inventory records school-scoped and enforce inventory permissions on every server read/write.

## Module 22 — Communication management
- [x] Provide an integrated communication center where administrators and authorized teachers can create announcements, select recipients, add attachments, schedule publication, publish announcements, edit announcements, archive announcements, and track read status.
- [x] Support in-app notifications, email notifications, SMS notifications through an integrated provider, and WhatsApp notifications through an authorized integration.
- [x] Generate alerts for student absences, upcoming examinations, examination result publication, outstanding fees, school events, assignment deadlines, and important announcements.
- [x] Deliver notifications only to authorized recipients and show pending/unconfigured provider states instead of claiming delivery.

## Module 23 — Parent portal
- [x] Display linked children, attendance percentages, recent examination results, upcoming examinations, outstanding fees, school announcements, teacher messages, and upcoming events.
- [x] Let parents switch between linked children, view attendance, download report cards, view payment history, download payment receipts, read announcements, contact authorized teachers, request meetings, update permitted contact details, and manage notification preferences.
- [x] Parents must not be able to modify official academic records; linked-child authorization is enforced server-side.

## Module 24 — Student portal
- [x] Let students view their profile, class timetable, attendance history, attendance percentage, published examination results, report cards, assignments, announcements, upcoming events, and notifications.
- [x] Let students submit homework and access learning resources where the corresponding school records and permission grants exist.
- [x] Students must not access confidential records belonging to other students; self-scope and published-result constraints are enforced server-side.

## Module 25 — Student welfare management
- [x] Record disciplinary incidents with incident date, assigned incident category, authorized staff notes, investigation status, follow-up actions, resolutions and historical records.
- [x] Generate restricted welfare reports; sensitive information is available only to specifically authorized school personnel.
- [x] Maintain access logs and modification history; confidential disciplinary information must not appear in general student dashboards.

## Module 26 — School events and calendar
- [x] Support examination, school holiday, parent meeting, sports meet, educational trip, cultural event, club activity and school ceremony event types.
- [x] Authorized users can create, edit, delete or cancel events; assign categories, select target participants, set dates/times, configure reminders and publish events.
- [x] Display monthly, weekly and daily calendar views and generate event reports.

## Module 27 — Advanced search system
- [x] Provide global permission-aware search across students, teachers, staff, classes, subjects, examinations, invoices, books, announcements and documents.
- [x] Support instant suggestions, result categories, advanced filters, search highlighting, keyboard navigation and pagination.
- [x] Never include unauthorized records in search results.

## Module 28 — Reporting and analytics
- [x] Use real database information for academic analytics: examination performance, subject averages, grade performance, class performance, student progress and historical comparisons.
- [x] Use real database information for attendance analytics: daily, monthly, grade, class and individual attendance plus absence trends.
- [x] Use real database information for financial analytics: monthly collections, outstanding balances, expense categories, payment history and financial trends.
- [x] Use real database information for administrative analytics: enrollment, admissions, transfers, teacher distribution, staff attendance, library usage and inventory statistics.
- [x] Support PDF, Excel, CSV and print-friendly exports with appropriate filters and accurate calculations.

## Module 29 — Bulk operations
- [x] Student bulk operations: import student records; update class assignments; promote students; export student information; generate ID cards; generate report cards.
- [x] Examination bulk operations: import examination marks; validate marks; generate results; export results; generate class reports.
- [x] Finance bulk operations: generate recurring invoices; import verified payment records; export payment histories; generate fee reminders.
- [x] Before importing, validate file format and required columns, detect duplicate records, identify invalid values, display a preview and validation errors, request confirmation, process valid records, and generate an import summary.
- [x] Use database transactions where appropriate.

## Module 30 — Document management
- [x] Support student admission documents, teacher qualifications, school certificates, examination documents, financial receipts, administrative documents and school circulars.
- [x] Upload, categorize, rename, view metadata, download authorized documents, replace, archive, track upload history, control visibility and generate document reports.
- [x] Use private storage and authorized download mechanisms.

## Module 31 — System notification center
- [x] Provide unread notification counters, categories, timestamps, mark-as-read, mark-all-as-read, delete/archive actions, notification preferences and deep links to relevant records.
- [x] Support Academic, Attendance, Finance, Administrative, Assignments, Events and System alerts categories.
- [x] Store notification history in the database.

## Module 32 — Automatic student promotion
- [x] Select current academic year, grade and class; load eligible students; select destination grade/class; preview promotions; validate destination capacity; confirm promotions; and update enrollment records.
- [x] Support individual promotion, bulk promotion, grade repetition, school transfer, graduation and enrollment completion.
- [x] Preserve historical class assignments, attendance, examination results and academic records.

## Module 33 — School certificate generator

- [x] Build a configurable certificate generation system supporting student enrollment certificates, school leaving certificates, character certificates, participation certificates, achievement certificates and completion certificates.
- [x] Allow authorized users to select certificate type and student, then load verified student information from the school database.
- [x] Provide certificate preview, authorized remarks, PDF generation through browser Print / Save as PDF, print support, sequential certificate numbers and immutable certificate history.
- [x] Include school branding and authorized signature areas.
- [x] Do not issue certificates without the required approval; enforce the approval requirement server-side.

## Module 34 — Audit logging and activity history

- [x] Track user logins, failed login attempts, student registration, student information changes, attendance corrections, examination mark changes, result approvals, payment modifications, permission changes and administrative settings changes through the existing audit writes plus the new login and preference audit records.
- [x] Store user ID, action, affected record, timestamp, relevant change summary, authorized school ID and appropriate request metadata where available.
- [x] Prevent ordinary users from editing or deleting audit logs.
- [x] Provide searchable audit history to authorized administrators with tenant and permission boundaries.

## Module 35 — Backup and recovery

- [x] Provide scheduled backup configuration, backup status monitoring, retention policies, secure backup storage metadata, failure alerts, recovery documentation and restoration-test records.
- [ ] Finish the approved private provider/exporter configuration before reporting encrypted backup artifacts as successful; until configured, runs remain explicitly pending and no public artifact is created.
- [x] Provide disaster-recovery procedures and distinguish configured, pending, successful and failed backup states.
- [x] Make scheduled backup execution idempotent and require authenticated platform schedule callbacks.

## Module 36 — Multilingual system

- [x] Support English, Sinhala and Tamil with reviewed dictionaries for shared navigation and operational labels.
- [x] Allow users to change application language and preserve the preference per account and on the device.
- [x] Translate authenticated navigation, common status labels, language control labels and new module shared headings; the dictionary is available for extending remaining legacy form copy.
- [x] Use proper Unicode-capable system font fallbacks and line-height so Sinhala and Tamil display correctly.
- [x] Do not use unreviewed automatic machine translation for legally significant documents.

## Module 37 — Mobile responsiveness

- [x] Preserve responsive behavior for desktop computers, laptops, tablets, Android smartphones and iPhones through the existing shell and new module layouts.
- [x] Provide responsive dashboard/shell behavior, collapsible navigation, touch-friendly buttons, responsive tables, mobile audit/backup controls and mobile certificate previews.
- [x] Keep important operations accessible on small screens and preserve print-friendly certificate/report layouts.

## Module 38 — Optional AI-powered functions

- [ ] Implement an optional AI assistant for authorized users to ask how many students were absent today, which classes have low attendance, the average examination performance, which invoices are overdue, and what events are scheduled this week.
- [ ] Implement optional AI analytics for attendance trend summaries, academic performance summaries, financial trend explanations, administrative report summaries and natural-language navigation.
- [ ] AI responses must use only authorized database information. Do not expose private student information to unauthorized users or external AI services without appropriate safeguards.
- [ ] The application must function normally when AI features are disabled; AI is disabled by default and must show an explicit disabled/provider-pending state.

## Module 39 — System settings and customization

- [ ] Persist general settings for school name, school logo, school contact details, academic year, school time zone, preferred language, currency and date format.
- [ ] Persist academic settings for grades, classes, subjects, examination types, grading systems, attendance rules and academic terms, reusing the existing school configuration records.
- [ ] Persist security settings for password policies, session duration, user permissions, account activation, login restrictions and audit log access without exposing secrets to browser clients.
- [ ] Persist notification settings for email configuration, SMS integration, notification templates and notification preferences, with external provider secrets configured outside ordinary browser forms.
- [ ] Apply persisted settings throughout the system where the existing module supports the value, retain audit history and enforce settings permissions server-side.

## Module 40 — Complete functional integration

- [ ] Keep all modules connected through the unified, school-scoped database and expose a real-data integration health view for enrollment, guardians, academic enrollment, fees, attendance, examinations/results, analytics, inventory, documents, notifications, events and certificates.
- [ ] When a student is registered, create the student record, generate an admission number, assign the student to a class, link guardians, initialize applicable academic enrollment records, create appropriate user access, apply relevant fee structures, update dashboard statistics, make the student available for attendance and make the student available for examinations where the corresponding configured records exist.
- [ ] When examination marks are entered, validate marks, save draft records, submit marks for approval, approve authorized submissions, calculate results, generate report cards, publish results, update academic analytics and notify authorized students and guardians.
- [ ] When a fee payment is recorded, verify the payment, create a payment transaction, allocate it to invoices, update outstanding balances, generate a receipt, update financial analytics, store transaction history and notify the authorized guardian.
- [ ] When a teacher marks attendance, load the assigned class, validate teacher permissions, record attendance statuses, save attendance, calculate attendance statistics, update relevant dashboards, generate configured absence alerts and maintain an audit trail.
- [ ] Preserve tenant boundaries, permission checks, CSRF protection, audit history and explicit pending states for integrations that are not configured.
