# Jibon AI — Project Change Log

This is the single running record of meaningful application changes, security decisions, verification, and known setup gaps.

## Current operating mode

- **Run target:** localhost only.
- **Deployment status:** intentionally deferred; no Vercel deployment should be attempted until local Supabase acceptance tests pass.
- **Current start command:** `npm run dev` after creating `.env.local` from `.env.example` and applying the Supabase migration.

## 2026-11-13 — Phase 4 private Document Vault

- Added `documents` metadata with UUIDs, family and uploader foreign keys, categories, private/family visibility, controlled MIME types, size checks, storage paths, timestamps, indexes, RLS, and activity-history triggers.
- Added the private `family-documents` Storage bucket. It accepts only PDF, JPG, PNG, and plain-text objects up to 10 MB; it is not public and has no bucket-wide listing policy.
- Added aligned RLS policies across document metadata and `storage.objects`: owners can read/delete private files; all current family members can read only family-shared files; uploads must match an existing uploader-owned document record at the exact generated family/document path. This prevents cross-family reads, unsigned access, and untracked bucket uploads.
- Added authenticated Route Handlers for permission-aware document listing/search, validated multipart upload, five-minute signed preview/download URL creation, and storage-first deletion. The browser never receives a Storage service-role credential.
- Added the responsive **Private document vault** dashboard panel with category/search filters, private/family sharing choice, accessible file upload, short-lived previews, secure opening, owner-only deletion, empty/loading/error states, and source/preview cleanup paths reserved for Phase 5 derived content.
- Applied `20261113192000_add_document_vault.sql` and the policy-hardening follow-up `20261113193000_harden_document_storage_insert.sql` to the connected Supabase project. Verified the bucket is private, its 10 MB allowlist is present, document RLS is enabled, and all three metadata plus three object policies exist.
- Verified unauthenticated document access returns HTTP 401, then ran `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check` successfully. A real upload/preview/delete and a two-user sharing/isolation pass remain manual acceptance tests because the current automated browser session has no signed-in account.

## 2026-11-13 — Phase 5 Document Intelligence

- Added the RLS-protected `document_intelligence` table, linked one-to-one to its source document with `ON DELETE CASCADE`. Deleting the source metadata now atomically deletes every extracted-text, summary, metadata, expiry, and processing record; the Vault deletion route already removes the corresponding source/preview objects first.
- Added durable bounded processing state (`queued`, `processing`, `ready`, `failed`), attempt counts, retry times, server model attribution, error state, and indexed queue/expiry lookups. Only the source uploader may create an empty queued job; browser roles cannot alter extracted content, status, or retry state.
- Uploads now enqueue a job after the source file is successfully written. Added a secret-protected, server-only worker endpoint that claims at most two due jobs per run, detects stale work, caps retries at three, limits AI analysis inputs to 5 MB and outputs to 60,000 extracted characters, and fetches private source files only with a server-side service-role client.
- Implemented plaintext extraction and model-backed PDF/image extraction/OCR, factual summary generation, issuer/type/date metadata, and expiry-date detection. The worker treats document content as untrusted data and parses a bounded Zod schema before persisting results.
- Added permission-aware document Q&A. It rechecks both the source document and derived row under RLS, bounds context to 18,000 characters, and answers only from that authorized extracted content. The model has no database credentials and no write path.
- Updated the Document Vault UI with asynchronous queue/configuration status, per-file analysis state, summaries, expiry alerts, error feedback, and a ready-document Q&A form.
- Applied `20261113194000_add_document_intelligence.sql` to the connected Supabase project. Verified RLS is enabled; authenticated users have only select/insert permissions, no update permission; `anon` has no select permission; and the table has its three required foreign keys.
- Verified unauthenticated document Q&A returns HTTP 401 and the unconfigured processor returns HTTP 503 without processing or exposing a file. Ran lint, typecheck, production build, and diff check. Live extraction/OCR, worker retry behavior, expiry detection, and Q&A require server-only `SUPABASE_SERVICE_ROLE_KEY`, `DOCUMENT_INTELLIGENCE_WORKER_SECRET`, and `OPENAI_API_KEY`, which are intentionally absent locally.

## 2026-11-13 — Phase 6 Financial Intelligence

- Added exact INR financial categories, income/expense transactions, monthly category budgets, recurring bills, and subscriptions. Every monetary amount uses `NUMERIC(12,2)` in PostgreSQL; the browser converts decimal strings to paise with `BigInt` for exact totals and budget comparisons rather than accumulating floating-point values.
- Added category/family composite foreign keys so a transaction, budget, recurring bill, or subscription cannot reference a category from another household. Added creator/workspace immutability triggers, family activity history, data constraints, cascade-safe family references, and query indexes for monthly records, budgets, due dates, renewal dates, and foreign keys.
- Applied `20261113195000_add_financial_intelligence.sql` to the connected Supabase project. All five finance tables have RLS enabled with family-scoped select/insert/update/delete policies; verified no anonymous access and no new security-advisor warning.
- Added the responsive **Financial intelligence** dashboard center: month-scoped income/expense entry and deletion, category management, exact monthly totals, category budget tracking, recurring-bill/subscription add/pause/resume/delete flows, and CSV export.
- Added authenticated `GET /api/finance/export` for a bounded month CSV and protected `POST /api/finance/summary`. The summary route verifies current family membership, reads only that family/month’s RLS-authorized rows, has no write path, and clearly reports unavailable until `OPENAI_API_KEY` is configured.
- Verified unauthenticated finance export and summary requests return HTTP 401; ran `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`. Authenticated CRUD, cross-family isolation, CSV content, and model-backed summary remain manual acceptance tests because no signed-in test account is available to this automation session.

## 2026-11-13 — Phase 7 Shopping and Inventory

- Added shared `shopping_lists` and `shopping_items` with family-scoped composite foreign keys, exact decimal quantities, units, purchase status, low-stock flags, notes, archival, indexes, immutable creator/workspace triggers, activity history, and cascade cleanup when a list is deleted.
- Applied `20261113196000_add_shopping_inventory.sql` to the connected Supabase project. Verified RLS is enabled with four family-scoped policies on both tables; anonymous access remains revoked.
- Added the responsive **Shared shopping & inventory** dashboard center with list create/archive/restore/delete, item add/delete, exact quantity/unit entry, purchase toggle, low-stock marking, pending/purchased groupings, and helpful empty/loading/error states.
- Added protected `POST /api/shopping/suggestions`. It verifies Auth and active-family membership, reads only up to 100 RLS-authorized household shopping records, requires a strict Zod array response, and never writes a row. Each suggestion appears as a preview and is saved only after the user presses **Add**.
- Verified lint, typecheck, production build, diff check, and live table/policy state. Authenticated shopping flows, two-family isolation, and live model suggestions remain manual acceptance tests because this automation session lacks a signed-in account and `OPENAI_API_KEY` is not configured.

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

## 2026-11-13 — Phase 3 persistent in-app reminders

- Added `notification_preferences`, `reminder_schedules`, and `in_app_notifications`, all with RLS. Each schedule and notification is personal to its authenticated recipient while still requiring current family membership.
- Added per-schedule IANA time zones, one-time/daily/weekly/monthly recurrence, durable next/last run timestamps, delivery-attempt/error fields, and indexes for due-work and recipient notification reads.
- Enabled Supabase `pg_cron` and installed the private `jibon-ai-materialize-reminders` worker on a one-minute cadence. The worker uses row locks and a unique `(schedule_id, occurrence_at)` key to make delivery idempotent. Failed transactions keep a schedule due so the following run retries it; recurring next occurrences are computed in their local time zone.
- Added authenticated Next.js route handlers for loading reminders, creating schedules only against a record the caller can access in the active family, updating personal preferences, pausing/resuming/deleting personal schedules, and marking only the recipient's notification read or unread.
- Added the responsive **Persistent reminders** dashboard center with notification count/read state, create/pause/resume/delete flows, recurrence, and a clear note that email delivery is not configured.
- Applied `20261113180000_add_persistent_reminders.sql` to the connected Supabase project. Verified all three new tables have RLS, their four expected policies exist, and the `pg_cron` job is active.
- Executed the private worker successfully with no due records, and verified both `anon` and `authenticated` lack execute permission on it. The Supabase security advisor introduced no new reminder-worker finding.
- Verified `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`. A fresh localhost browser session reached the protected login gate; end-to-end schedule creation remains an authenticated manual test because that fresh session has no account password.

## 2026-11-13 — Phase 3 optional email completion

- Added `reminder_email_deliveries`, a private browser-inaccessible delivery queue keyed one-to-one to the in-app notification. It records attempts, next retry, provider ID, delivery time, and the last non-sensitive error.
- Updated the private cron materializer to enqueue an email only when the recipient has opted in. It reads the Auth email inside the private database function; no Auth email or queue row is exposed through the browser API.
- Added the protected server-only `POST /api/reminders/deliver-email` worker. It requires a separate worker secret, processes at most 20 due deliveries, uses Resend's `Idempotency-Key`, and retries failed provider requests with exponential backoff up to five attempts.
- Added server-only placeholder variables to `.env.example`: `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `REMINDER_FROM_EMAIL`, and `REMINDER_WORKER_SECRET`. The current `.env.local` has none of these, so email preferences remain disabled in the UI and the worker returns HTTP 503 without sending any message.
- Applied migrations `20261113190000_add_optional_email_reminders.sql` and `20261113191000_fix_email_delivery_queue_policy.sql`. Verified the queue has RLS, no `anon` or authenticated browser select grant, an explicit deny policy, and no new Supabase security-advisor warning.
- Verified lint, typecheck, production build, diff check, and the missing-email-config worker guard. Live provider delivery and a scheduler callback remain intentionally untested until the required provider credentials and a deployed scheduler exist.

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
