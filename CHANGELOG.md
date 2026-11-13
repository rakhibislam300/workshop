# Jibon AI — Project Change Log

This is the single running record of meaningful application changes, security decisions, verification, and known setup gaps.

## Current operating mode

- **Run target:** localhost only.
- **Deployment status:** intentionally deferred; no Vercel deployment should be attempted until local Supabase acceptance tests pass.
- **Current start command:** `npm run dev` after creating `.env.local` from `.env.example` and applying the Supabase migration.

## 2026-11-13 — Phase 0 audit and Phase 1 family collaboration

### Audit result

- Confirmed the active stack is Next.js 16 App Router, TypeScript, Tailwind, `@supabase/ssr`, Supabase Auth/PostgreSQL/RLS, Zod, and server-only OpenAI calls; no voice capability was added.
- Confirmed the original five tables had owner-only RLS and that all existing rows were still user-scoped. The app had no family, invitation, role, or activity model before this phase.
- Confirmed the existing auth callback/session-refresh path and core CRUD foundation work. The audit also found Supabase Auth leaked-password protection disabled in project settings; this is an account configuration action, not an application-code change.

### Phase 1 delivered

- Added data-preserving `families`, `family_memberships`, `family_invitations`, and `family_activity` tables.
- Backfilled one owner family and membership for every legacy account represented by existing records, then added non-null `family_id` to local profiles, tasks, bills, and appointments without deleting data.
- Replaced owner-only task, bill, appointment, and local-profile RLS with family-membership RLS. Assignment foreign keys now enforce that a local profile belongs to the same family workspace.
- Added `owner`, `admin`, and `member` roles. Owners/admins can create invitations; authenticated invite acceptance is email-bound, token-hashed, expires after seven days, and is recorded in activity history.
- Added family switching, new-family creation, collaboration invite-link creation, invitation acceptance, active-family query filtering, and a role/activity view in the existing dashboard.
- Added database activity triggers for future shared-record create/update/delete operations; legacy events are intentionally not fabricated.
- Added an explicit follow-up migration after the RLS verification caught missing appointment policies and direct `anon` execution on the two privileged RPCs. Appointment policies are now present and `anon` execution is denied.

### Verification

- `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check` pass after the Phase 1 changes.
- Live database verification confirms all nine application tables have RLS enabled, all legacy core rows have a `family_id`, appointment CRUD has four family-scoped policies, and `anon` cannot execute the privileged family RPCs.
- Supabase security advisor continues to flag the two authenticated-only `SECURITY DEFINER` RPCs. This is expected: they are the narrow authority boundary needed to create an owner membership and atomically accept an email-bound invitation. Both have fixed search paths, explicit authentication/permission checks, and no `anon` execute permission.

## 2026-11-13 — Phase 1 collaboration management follow-up

- Added a Family members panel in the Profile tab with family-visible display names and role badges.
- Owners can now promote/demote other collaborators and remove them; the database rejects self-removal, self-role changes, and any operation that would leave a family without an owner.
- Owners and admins can now create secure invitation links from the panel, view pending invitations, and cancel them before use.
- Added owner-authorized role/remove RPCs with fixed search paths, internal permission checks, activity entries, explicit authenticated-only execution grants, and explicit `anon` revocation.
- Verified locally in the browser that the owner panel loads the current collaborator and invite form. Re-ran `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`; all pass.

## 2026-11-13 — Phase 2 contextual text AI

- Added a separate **Context-aware assistant** panel without replacing the working Smart Add flow or manual CRUD forms.
- Added protected `POST /api/family-assistant`: it verifies Auth claims and current family membership, invokes the database-backed per-person rate limiter, and reads only the active family's RLS-authorized local profiles, tasks, bills, and appointments (bounded to 40 of each).
- Added server-side schedule-conflict detection for appointments less than one hour apart, and supplied this plus authorized live records as bounded context to the model. The model has no database credentials or direct mutation tool.
- Used an OpenAI Responses API function tool with a strict JSON schema for a single create/update proposal. Zod validates the returned tool arguments and validates the entity-specific payload again; unclear requests stay conversational instead of producing a proposal.
- Added protected `POST /api/family-assistant/execute`. It requires explicit browser confirmation, rechecks current family membership, repeats schema validation, and scopes every insert/update to the confirmed `family_id`. Existing database activity triggers audit the actual saved change.
- Hardened confirmation reporting so insert/update calls must return the saved row ID before the UI is told a change succeeded; stale or deleted update targets return an actionable error instead.
- Added `family_ai_requests` and `check_and_log_family_ai_request` in migration `20261113170000_add_family_ai_audit.sql`. It stores metadata only (family, actor, prompt length, timestamp), never prompts or family context; RLS allows only family owners/admins to inspect their family metadata. The narrowly scoped authenticated RPC enforces 12 requests per person per rolling five minutes; `anon` cannot invoke it.
- Verified live Supabase RLS on the new table and verified RPC grants (`anon=false`, `authenticated=true`). The security advisor will deliberately list this fifth authenticated `SECURITY DEFINER` RPC alongside the four Phase 1 RPCs; it has a fixed search path, validates authentication/membership/length, and writes only a caller-attributed audit row.
- Verified the signed-in localhost UI renders the assistant and, with no `OPENAI_API_KEY`, shows the expected clear unavailable state while leaving manual tools intact. Verified the unauthenticated route guard returns HTTP 401.
- Re-ran `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`; all passed.

## 2026-11-13 — Usability and dashboard completion pass

- Refined the teal-first visual system with consistent cards, accessible focus treatment, clearer fields, responsive controls, and a sticky session-aware dashboard header.
- Added a first-use **Getting started** checklist that links directly to the relevant working tasks, bills, appointments, and household-profile flows.
- Improved task management with text search, actionable empty states, visible result counts, and stronger overdue treatment.
- Improved bills with a live outstanding/unpaid summary, a clear paid-toggle affordance, and more prominent overdue presentation.
- Refined appointments so upcoming items appear first in chronological order; past appointments remain available in a collapsed history instead of obscuring current plans.
- Added edit support for local household profiles alongside the existing add/remove controls.
- Re-ran `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`; all passed.

## 2026-11-13 — Supabase MCP integration

- Added the global Codex Supabase MCP server scoped to project `oxlbjfyzpwvrnfzwzxic` with documentation, account, database, debugging, development, functions, branching, feedback, and notebooks features enabled.
- Completed the Supabase OAuth authorization flow successfully.
- Verified the MCP configuration is enabled with `codex mcp list` and `codex mcp get supabase`.
- No Supabase database change has been made through MCP yet.
- The local app's `.env.local` remains incomplete until its `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are set to values from this project. The publishable key was not written or exposed by this setup step.

## 2026-11-13 — Live Supabase schema initialization

- Confirmed the configured Supabase project URL is `https://oxlbjfyzpwvrnfzwzxic.supabase.co` and corrected `.env.local` to use the base project URL rather than its `/rest/v1/` endpoint path.
- Applied the initial Jibon AI migration to the connected Supabase project.
- Verified the five application tables exist with zero seeded rows: `profiles`, `family_members`, `tasks`, `bills`, and `appointments`.
- Verified RLS is active on every application table, with four owner-scoped policies on each table (select, insert, update, delete).
- Supabase's security advisor reports no security findings.
- Supabase's performance advisor identified two missing composite foreign-key indexes for local household assignments; the follow-up migration adds them.
- Applied the assignment-index follow-up migration and verified that the foreign-key index findings are resolved. The only remaining performance notes are expected "unused index" informational notices because the new application has no query traffic yet.
- Verified localhost configuration with read-only network checks: Supabase Auth returns HTTP 200 and the RLS-protected profiles endpoint returns HTTP 401 without a signed-in session, as expected.
- Restarted the local Next.js development server after correcting the environment URL. It is running at `http://localhost:3000` with `.env.local` loaded.
- Verified `GET /auth/register` returns HTTP 200 and an unauthenticated `POST /api/smart-add` returns HTTP 401, confirming the local route and API authentication guard are active.

## 2026-11-13 — Dashboard refinement pass

- Added Supabase's current Next.js proxy/session-refresh pattern so cookie-based authentication is refreshed and JWT claims are verified on relevant requests.
- Changed server-side dashboard authorization to use verified Auth claims rather than an unverified session.
- Made profile loading resilient for accounts that predate the profile trigger; profile updates now use an RLS-protected upsert.
- Added an Account/Profile tab where the household display name can be viewed and updated.
- Added the planned overdue-responsibilities metric, visible overdue treatment, and dedicated quick actions for tasks, bills, and appointments.
- Added removal controls for local household profiles. Removing a local profile clears its task/appointment assignments through the existing foreign-key rule; it does not delete the underlying task or appointment.
- Added protected dashboard loading and recovery UI states.
- Re-ran `npm run lint`, `npm run typecheck`, and `npm run build`; all passed.

## 2026-11-13 — Initial hackathon MVP

### Project foundation

- Bootstrapped a Next.js 16 App Router project with TypeScript, Tailwind CSS, ESLint, and production build tooling.
- Added `@supabase/ssr`, `@supabase/supabase-js`, Zod, and Lucide React.
- Added `.env.example` with only public Supabase configuration and server-only OpenAI configuration placeholders.
- Changed the production build script to webpack because Turbopack worker port binding is blocked in this execution environment.

### Supabase schema and security

- Added `profiles`, `family_members`, `tasks`, `bills`, and `appointments` in `supabase/migrations/20261113130000_jibon_ai.sql`.
- Used UUID IDs, timestamps, foreign keys, constraints, useful indexes, `DATE` task/bill due dates, `TIMESTAMPTZ` appointment times, and `NUMERIC(12,2)` bill amounts.
- Added a signup trigger that creates the matching `profiles` row after a Supabase Auth user is created.
- Enabled RLS on every exposed application table.
- Revoked broad client access and granted authenticated CRUD only.
- Added separate ownership policies for select, insert, update, and delete operations on each table.
- Enforced same-account household-member references through composite foreign keys on tasks and appointments.
- Scoped foreign-key deletion so removing a local family profile clears only the assignment, never the owning `user_id`.
- Kept the security-definer trigger function in a private schema and revoked public execution.

### Authentication and profile flow

- Added registration, login, logout, confirmation-email redirect handling, and protected dashboard routing.
- Registration stores a display name in user metadata for the profile creation trigger.
- Added a Supabase SSR callback route that exchanges an Auth confirmation code for the session cookies.
- Dashboard uses a server-side user check and redirects signed-out visitors to login.

### Household dashboard and CRUD

- Built a responsive, teal-first dashboard with live Supabase-backed metrics for pending/completed tasks, outstanding bills, unpaid bill count, upcoming appointments, and overdue tasks.
- Built task CRUD, completion toggles, priority, due date, description, optional local-member assignment, and pending/completed/overdue filters.
- Built bill CRUD, INR formatting, category, paid/unpaid status, outstanding totals, and overdue highlighting.
- Built appointment CRUD, optional location/local-member assignment, chronological ordering, and local date/time entry.
- Added local household profile creation for assignments; these profiles deliberately do not create separate authentication accounts.
- Added empty states, errors, confirmation before destructive deletes, and responsive navigation/forms.

### In-app reminders

- Added derived dashboard alerts for overdue/due-today tasks, overdue/due-today bills, and appointments occurring within 72 hours.
- No push, SMS, email, or background-notification claims are made.

### AI Smart Add

- Added protected `POST /api/smart-add`; it requires an authenticated Supabase user.
- The server route calls the OpenAI API only when `OPENAI_API_KEY` exists; keys are never sent to the browser.
- Added Zod validation for task, bill, appointment, and AI-proposal data.
- The AI route can ask clarifying questions for ambiguous or missing fields.
- AI returns a proposal only. The client shows a preview and saves only after the user presses **Confirm & save**.
- If AI configuration or service access is unavailable, manual CRUD continues to work and a clear error is shown.

### Verification completed

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run build` — passed with Next.js webpack production build.
- `git diff --check` — passed.

### Not yet executed (requires external credentials)

- Applying the migration to a live Supabase project.
- Email confirmation, live login/session persistence, and live database CRUD.
- Two-account RLS isolation test against a deployed database.
- Live OpenAI Smart Add extraction and clarification checks.
- Vercel deployment and production callback URL validation.

### Follow-up procedure

After any future change, add a dated entry with:

1. What changed and why.
2. Schema, RLS, or environment-variable impact.
3. Verification performed.
4. Any remaining limitations or required manual checks.
