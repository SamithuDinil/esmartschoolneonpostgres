# E-SmartSchool.lk — Isolated Schools + Modern UI

## Changes

### 1. Owner / platform dashboard removed
- `/system-owner/dashboard` → redirects to `/dashboard`
- `/platform` → redirects to `/dashboard`
- `/system-owner/schools/*` → redirects to `/setup` or `/dashboard`
- Owner support banner removed from AppShell
- School dashboard no longer redirects system owners to a control center
- School setup (`/setup`) is available to authenticated users creating their own school

### 2. Schools are isolated (created one by one)
- Each school is an independent workspace
- Self-service school registration uses `/api/schools` only
- Platform multi-school registration path is no longer used from the UI
- Tenant isolation in Firestore remains unchanged

### 3. Modern professional UI redesign
- Refined design tokens (slate ink, clearer blues, softer surfaces)
- Updated CSS variables for radius, shadow, and color hierarchy
- Polished sidebar, topbar (frosted), panels, cards, and navigation
- Improved focus states, buttons, and scrollbars
- Cleaner typography and spacing for an enterprise-ready look

## How to apply
Merge the files in this archive into your project root (overwriting matching paths under `src/`).

Key files changed:
- src/app/globals.css
- src/app/layout.tsx
- src/app/setup/page.tsx
- src/app/platform/page.tsx
- src/app/system-owner/** 
- src/components/AppShell.tsx
- src/features/dashboard/SchoolDashboard.tsx
- src/features/schools/SchoolSetupForm.tsx
- src/server/system-owner.ts
