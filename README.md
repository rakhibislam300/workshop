# Jibon AI

**One Family. One Dashboard. A Smarter Everyday Life.**

Jibon AI is a mobile-first household dashboard for tasks, bills, appointments, in-app reminders, confirmation-based AI Smart Add, and a contextual family assistant. A signed-in account can own or join family workspaces; local household profiles remain available for assigning responsibilities without requiring separate login accounts.

The complete implementation and verification record lives in [CHANGELOG.md](CHANGELOG.md).

## Stack

- Next.js App Router + TypeScript + Tailwind CSS
- Supabase Auth and PostgreSQL with RLS on every application table
- Zod validation in the client UI and protected Smart Add route
- Server-only OpenAI integration (optional)

## Local setup

1. Create a Supabase project and run [`supabase/migrations/20261113130000_jibon_ai.sql`](supabase/migrations/20261113130000_jibon_ai.sql) in the SQL Editor, or apply it with the Supabase CLI.
2. In Supabase Auth settings, set the site URL to your local URL (normally `http://localhost:3000`) and add these redirect URLs:

   - `http://localhost:3000/auth/callback`
   - your production URL followed by `/auth/callback`

3. Copy `.env.example` to `.env.local`, then supply your project's URL and **publishable** key. Never put a service-role key in any `NEXT_PUBLIC_` variable.
4. Optionally add `OPENAI_API_KEY` and `OPENAI_MODEL` to enable Smart Add. Without it, the feature explains that it is unavailable and every manual form remains functional.
5. Run:

   ```bash
   npm install
   npm run dev
   ```

The active run target is **localhost**. Do not configure or deploy to Vercel yet; production deployment remains a later step after the local acceptance checklist passes.

## Database security

The migration creates `profiles`, `family_members`, `tasks`, `bills`, and `appointments`, with UUID keys, timestamps, useful indexes, ownership foreign keys, data constraints, and RLS.

- Every public table revokes client grants first, then grants only signed-in CRUD access.
- Every RLS policy checks `auth.uid()` against the row owner for select, insert, update, and delete.
- Composite foreign keys ensure a task or appointment cannot reference a local family profile owned by another account.
- Internal trigger and reminder-worker functions live in the private `app_private` schema and are revoked from `PUBLIC`. The small, authenticated Phase 1/2 public RPCs are documented privileged authority boundaries with explicit permission checks and no anonymous access.

## MVP feature status

| Area | Status | Notes |
| --- | --- | --- |
| Email/password authentication | Implemented | Registration, login, logout, session refresh, protected dashboard, and confirmation callback are present. |
| Tasks | Implemented | Create, edit, complete, delete, priority, due dates, member assignment, pending/completed/overdue filters, and search. |
| Bills | Implemented | INR amounts, paid status, outstanding balance, overdue treatment, and CRUD. |
| Appointments | Implemented | CRUD, optional location/member, upcoming-first chronology, and collapsible past history. |
| Household profiles | Implemented | Local, non-login family profiles can be added, edited, removed, and assigned to work. |
| Dashboard and reminders | Implemented | Live Supabase metrics plus derived due-today/overdue alerts and persistent, scheduled in-app reminders. |
| AI Smart Add | Implemented; configuration-dependent | Protected server route, validation, clarification, preview, and user confirmation are ready; it needs a valid `OPENAI_API_KEY` to make live model calls. |
| Contextual family assistant | Implemented; configuration-dependent | Reads only active-family records under RLS, answers/summarizes/conflict-checks, creates Zod-validated proposals through a bounded model tool, and saves only after a separate permission-checked confirmation. |
| Family collaboration | Implemented | Family workspaces, roles, switching, shared records, secure invitation acceptance, and activity history. |
| Private document vault | Implemented | Private Supabase Storage, validated PDF/JPG/PNG/text upload, categories, private/family sharing, secure temporary previews/downloads, search, and source-file deletion. |
| Document intelligence | Implemented; configuration-dependent | Durable private processing queue, text/PDF/image extraction, OCR, summaries, metadata/expiry detection, and permission-aware Q&A are ready; the worker needs server-only credentials. |
| Financial intelligence | Implemented; AI summary configuration-dependent | Exact INR income/expense records, categories, budgets, recurring bills, subscriptions, analytics, CSV export, and an authorized server-only AI summary route. |
| Shopping and inventory | Implemented; suggestions configuration-dependent | Shared lists/items, quantities, units, low-stock flags, purchase status, and confirmation-only AI shopping suggestions grounded in family records. |
| Unified calendar and multilingual text | Implemented | Day/week/month calendar, task/bill/appointment filters, appointment conflicts, protected ICS export, and saved English/Assamese/Hindi/Bengali calendar UI text. |
| Real-time syncing, deployment | Deliberately post-MVP | Explicitly outside this localhost-only hackathon build. |
| Voice assistance | Excluded | This project deliberately contains no microphone, speech recognition, text-to-speech, or voice UI. |

## Phase 1 collaboration upgrade

The current local build has completed the collaboration foundation: family workspaces, owner/admin/member roles, family switching, email-bound invitation links, shared core records, and activity history. Existing account-owned data was migrated into an owner family without deletion.

The collaboration migration must be applied after the two original migrations:

1. [`20261113150000_add_family_collaboration.sql`](supabase/migrations/20261113150000_add_family_collaboration.sql)
2. [`20261113153000_fix_phase1_rls.sql`](supabase/migrations/20261113153000_fix_phase1_rls.sql)
3. [`20261113160000_add_collaboration_management.sql`](supabase/migrations/20261113160000_add_collaboration_management.sql)
4. [`20261113170000_add_family_ai_audit.sql`](supabase/migrations/20261113170000_add_family_ai_audit.sql)
5. [`20261113180000_add_persistent_reminders.sql`](supabase/migrations/20261113180000_add_persistent_reminders.sql)
6. [`20261113190000_add_optional_email_reminders.sql`](supabase/migrations/20261113190000_add_optional_email_reminders.sql)
7. [`20261113191000_fix_email_delivery_queue_policy.sql`](supabase/migrations/20261113191000_fix_email_delivery_queue_policy.sql)
8. [`20261113192000_add_document_vault.sql`](supabase/migrations/20261113192000_add_document_vault.sql)
9. [`20261113193000_harden_document_storage_insert.sql`](supabase/migrations/20261113193000_harden_document_storage_insert.sql)
10. [`20261113194000_add_document_intelligence.sql`](supabase/migrations/20261113194000_add_document_intelligence.sql)
11. [`20261113195000_add_financial_intelligence.sql`](supabase/migrations/20261113195000_add_financial_intelligence.sql)
12. [`20261113196000_add_shopping_inventory.sql`](supabase/migrations/20261113196000_add_shopping_inventory.sql)
13. [`20261113197000_add_profile_locale.sql`](supabase/migrations/20261113197000_add_profile_locale.sql)
14. [`20261113198000_add_missing_foreign_key_indexes.sql`](supabase/migrations/20261113198000_add_missing_foreign_key_indexes.sql)

An owner or admin creates an invite link in the dashboard, shares it only with the invited email address, and the recipient signs in with that exact address before accepting. Owners can manage collaborator roles and removal; the database protects the final owner. Jibon intentionally does not send email itself yet because no transactional email provider has been configured.

## Phase 2 contextual text AI

The **Context-aware assistant** sends a request only to the protected Next.js route. It first verifies the authenticated person's membership in the selected family, then reads only that family's RLS-authorized tasks, bills, appointments, and local profiles. The model sees a bounded snapshot (40 records per type) and can answer questions, summarize responsibilities, flag appointments less than an hour apart, or produce one typed create/update proposal. It has no database credentials and cannot write a record directly.

Every proposed change is validated again with Zod, previewed in the browser, then sent to a separate confirmation route that rechecks current family membership and applies a family-scoped insert/update. Existing activity triggers record the actual saved change. [`20261113170000_add_family_ai_audit.sql`](supabase/migrations/20261113170000_add_family_ai_audit.sql) adds an RLS-protected metadata-only request audit and a per-person limit of 12 requests per rolling five minutes. Neither prompts nor household context are stored in that audit table.

## Phase 3 persistent reminders

The **Persistent reminders** center schedules a task, bill, or appointment for the signed-in person in the active family. A saved IANA time zone and an explicit `TIMESTAMPTZ` run time avoid browser-clock assumptions. Schedules may run once, daily, weekly, or monthly; recurring next runs are calculated in local wall time so daylight-saving transitions remain meaningful.

Supabase `pg_cron` runs a private database worker every minute. It creates a durable in-app notification with an idempotency key of `(schedule_id, occurrence_at)`. If a transaction fails, the due schedule is left eligible and the next worker run retries it. Preferences, schedules, and notifications have separate family-scoped RLS policies; notifications are personal even when their source record is shared.

Optional email uses a separate RLS-protected queue and a secret-protected, server-only Resend worker. It retries a failed send up to five times with exponential backoff and uses the notification ID as the provider idempotency key. It is intentionally inactive here: `RESEND_API_KEY`, `REMINDER_FROM_EMAIL`, `REMINDER_WORKER_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` are absent. Before enabling this on a future deployed scheduler, set those server-only values and invoke `POST /api/reminders/deliver-email` with the `x-reminder-worker-secret` header. Do not expose any of them to the browser. There are still no push or SMS notifications.

## Phase 4 private Document Vault

The **Private document vault** is now available on the dashboard. It stores document metadata in an RLS-protected `documents` table and objects in the non-public `family-documents` bucket. Uploads go to authenticated server routes and are validated twice: the route accepts only PDF, JPG, PNG, or plain-text files at 10 MB or smaller, while the bucket carries the same size/type allowlist.

Choose **Only me** for an uploader-private record or **Shared with family** for a file every current family member may open. The application creates a five-minute signed URL only after it can select the metadata under RLS, so no cross-family signed URL can be generated. Delete removes source and any future derived preview object before metadata; the private bucket has no general listing policy. The browser uses only the normal authenticated client—no Storage or Supabase service-role secret is shipped to it.

## Phase 5 Document Intelligence

Each successful vault upload also creates a durable, empty `document_intelligence` job. Source metadata owns the derived row through a database cascade: deleting a document deletes extracted text, summaries, metadata, expiry data, and processing state. Browser roles can see derived content only when their existing private/family document visibility permits it, and cannot write or alter processing output.

To activate the asynchronous worker locally or after deployment, set these **server-only** values in `.env.local`:

```bash
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=...
DOCUMENT_INTELLIGENCE_WORKER_SECRET=use-a-long-random-secret
```

Then call the worker from a trusted local terminal or scheduled server process; never from browser code:

```bash
curl -X POST http://localhost:3000/api/document-intelligence/process \
  -H "x-document-intelligence-secret: $DOCUMENT_INTELLIGENCE_WORKER_SECRET"
```

The worker claims at most two jobs per request, retries transient failures up to three times, treats jobs stuck in processing for ten minutes as stale, and accepts at most 5 MB per AI analysis (vault storage remains 10 MB). It performs plain-text extraction and model-backed PDF/image extraction/OCR, creates a bounded summary plus factual type/issuer/date/expiry metadata, and never grants the model database access. **Ask a processed document** uses only the signed-in person's RLS-authorized extraction; it does not search other family documents. No document content is sent to the model until this configured worker is called.

## Phase 6 Financial Intelligence

The dashboard’s **Financial intelligence** center tracks shared family income and expenses by month, with optional local categories, exact INR amounts, monthly category budgets, recurring bills, and subscriptions. PostgreSQL stores money as `NUMERIC(12,2)` and the client converts returned decimal strings into paise before aggregating, avoiding floating-point total drift.

CSV export is protected by the same signed-in family-membership check as the rest of the workspace and returns no more than 1,000 selected-month transactions. The AI summary route similarly verifies membership, loads only the active family’s selected-month transactions and budgets under RLS, has no mutation endpoint, and needs the existing server-only `OPENAI_API_KEY`. Without it, manual financial tracking and CSV export keep working.

## Phase 7 Shopping and Inventory

The **Shared shopping & inventory** center keeps multiple household lists with decimal quantities, units, purchase state, notes, and low-stock flags. Lists are shared only with active family members under RLS. Archive hides a list without deleting its items; delete removes the list and its dependent items through the database foreign key.

The optional suggestions route reads only up to 100 active-family shopping records after authenticating the requester. It can recommend explicitly low-stock or previously recorded household items, but returns a preview only. Nothing is added until the signed-in person selects **Add** beside a suggestion. It needs the existing server-only `OPENAI_API_KEY`; manual list management never depends on it.

## Phase 8 Unified Calendar and multilingual text

The **Unified calendar** combines existing task due dates, bill due dates, and appointments in day, week, and month views. It filters by event type and highlights appointments less than one hour apart as schedule conflicts. Its ICS export contains the active family's appointments only and verifies the signed-in member before generating a file.

Calendar controls can be saved in English, Assamese, Hindi, or Bengali through the account profile. This is text localization only; Jibon continues to exclude every voice, microphone, speech-recognition, and text-to-speech feature.

## Verification performed

```bash
npm run lint
npm run typecheck
npm run build
```

All three pass in this workspace. The default Turbopack build was blocked by the execution sandbox when it attempted to bind a worker port, so the project build script uses Next's webpack compiler instead; this still produces the production build shown above.

## Hardening status

- The live project has 23 application tables with RLS enabled; the Phase 9 database audit found no unindexed foreign keys after the final migration.
- Protected calendar export was verified to return HTTP 401 without a session, and a signed-out dashboard request directs the browser to `/auth/login`.
- Five authenticated-only `SECURITY DEFINER` RPCs intentionally remain as narrow family-management and AI-rate-limit authority boundaries. Anonymous execution is revoked; review them whenever their SQL changes.
- Before a public release, enable Supabase **Leaked Password Protection**, perform the two-account tests below, exercise backup/restore, and configure production logs/monitoring. The current unused-index advisor notes are expected while the database has very little traffic; do not remove the indexes without production usage data.

## Acceptance test checklist (requires Supabase credentials)

1. Register a user, confirm the verification email, and sign in through `/auth/callback`.
2. Confirm an unauthenticated visit to `/dashboard` redirects to login; refresh a signed-in dashboard to confirm persistence.
3. Add, edit, complete, filter, and delete a task. Use a past due date to verify overdue badges and reminders.
4. Add, edit, mark paid/unpaid, and delete a bill. Confirm outstanding INR totals and overdue highlighting.
5. Add, edit, and delete an appointment; confirm chronological display and a reminder within 72 hours.
6. Create a second account. Verify it cannot see or mutate the first account's records or local profiles (RLS).
7. With `OPENAI_API_KEY` configured, ask Smart Add to make a task, bill, and appointment. Confirm a proposal is shown, ambiguous inputs ask for clarification, and no record is saved until **Confirm & save** is pressed.
8. With `OPENAI_API_KEY` configured, ask the Context-aware assistant for an overdue summary and a schedule-conflict check. Ask it to create and update a record; verify no data changes until **Confirm & save**, then verify it cannot update a record in another family.
9. Resize to mobile width and verify the navigation, cards, and forms remain usable.
10. Schedule a one-time reminder one minute in the future, verify it appears in the in-app center, mark it read/unread, and verify only its recipient can query it. Create a daily reminder and check its `next_run_at` advances after delivery.
11. Upload a PDF or image as **Only me**, then verify it appears only for its uploader. Upload another as **Shared with family**, accept a second-account family invitation, and verify that member can preview but cannot delete it. Verify an account outside the family gets no metadata or signed link. Delete an owner document and confirm its file no longer opens.
12. With the Document Intelligence worker configured, upload a small text file, PDF, and image. Invoke the worker, confirm each reaches **Analyzed**, verify a bounded factual summary and any detected expiry date, ask a question answerable only from that document, and verify a second family cannot access either the extraction or Q&A. Delete the source and confirm its derived row is gone.
13. Create two expense categories and transactions with decimal paise amounts, then confirm the month totals and category budget remaining/overage exactly match the entered values. Add a recurring bill and subscription, pause/resume each, export the selected month CSV, and verify a second account outside the family cannot see or export any financial data. With `OPENAI_API_KEY`, request a monthly summary and verify it reports only the selected family/month and makes no database change.
14. Create a shared list, add items with different quantities/units, mark one low stock and one purchased, then confirm all current family members see the same state. Archive and restore the list, verify another family cannot access it, and—with `OPENAI_API_KEY`—request a suggestion and confirm no item exists until **Add** is selected.
15. Add appointments, bill due dates, and task due dates; verify calendar filters and day/week/month views. Create two appointments less than an hour apart to verify conflict treatment, export the ICS as a family member, confirm another family cannot export it, and change the calendar language through all four supported text locales.

## Later: deploy to Vercel

Import the repository into Vercel, add the same environment variables from `.env.local`, and set Supabase Auth's Site URL and callback redirect URL to the Vercel deployment URL. No deployment was attempted because this workspace has no Vercel or Supabase project credentials.
