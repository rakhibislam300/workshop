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
| Real-time syncing, storage, deployment | Deliberately post-MVP | Explicitly outside this localhost-only hackathon build. |
| Voice assistance | Excluded | This project deliberately contains no microphone, speech recognition, text-to-speech, or voice UI. |

## Phase 1 collaboration upgrade

The current local build has completed the collaboration foundation: family workspaces, owner/admin/member roles, family switching, email-bound invitation links, shared core records, and activity history. Existing account-owned data was migrated into an owner family without deletion.

The collaboration migration must be applied after the two original migrations:

1. [`20261113150000_add_family_collaboration.sql`](supabase/migrations/20261113150000_add_family_collaboration.sql)
2. [`20261113153000_fix_phase1_rls.sql`](supabase/migrations/20261113153000_fix_phase1_rls.sql)
3. [`20261113160000_add_collaboration_management.sql`](supabase/migrations/20261113160000_add_collaboration_management.sql)
4. [`20261113170000_add_family_ai_audit.sql`](supabase/migrations/20261113170000_add_family_ai_audit.sql)
5. [`20261113180000_add_persistent_reminders.sql`](supabase/migrations/20261113180000_add_persistent_reminders.sql)

An owner or admin creates an invite link in the dashboard, shares it only with the invited email address, and the recipient signs in with that exact address before accepting. Owners can manage collaborator roles and removal; the database protects the final owner. Jibon intentionally does not send email itself yet because no transactional email provider has been configured.

## Phase 2 contextual text AI

The **Context-aware assistant** sends a request only to the protected Next.js route. It first verifies the authenticated person's membership in the selected family, then reads only that family's RLS-authorized tasks, bills, appointments, and local profiles. The model sees a bounded snapshot (40 records per type) and can answer questions, summarize responsibilities, flag appointments less than an hour apart, or produce one typed create/update proposal. It has no database credentials and cannot write a record directly.

Every proposed change is validated again with Zod, previewed in the browser, then sent to a separate confirmation route that rechecks current family membership and applies a family-scoped insert/update. Existing activity triggers record the actual saved change. [`20261113170000_add_family_ai_audit.sql`](supabase/migrations/20261113170000_add_family_ai_audit.sql) adds an RLS-protected metadata-only request audit and a per-person limit of 12 requests per rolling five minutes. Neither prompts nor household context are stored in that audit table.

## Phase 3 persistent reminders

The **Persistent reminders** center schedules a task, bill, or appointment for the signed-in person in the active family. A saved IANA time zone and an explicit `TIMESTAMPTZ` run time avoid browser-clock assumptions. Schedules may run once, daily, weekly, or monthly; recurring next runs are calculated in local wall time so daylight-saving transitions remain meaningful.

Supabase `pg_cron` runs a private database worker every minute. It creates a durable in-app notification with an idempotency key of `(schedule_id, occurrence_at)`. If a transaction fails, the due schedule is left eligible and the next worker run retries it. Preferences, schedules, and notifications have separate family-scoped RLS policies; notifications are personal even when their source record is shared.

Optional email uses a separate RLS-protected queue and a secret-protected, server-only Resend worker. It retries a failed send up to five times with exponential backoff and uses the notification ID as the provider idempotency key. It is intentionally inactive here: `RESEND_API_KEY`, `REMINDER_FROM_EMAIL`, `REMINDER_WORKER_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` are absent. Before enabling this on a future deployed scheduler, set those server-only values and invoke `POST /api/reminders/deliver-email` with the `x-reminder-worker-secret` header. Do not expose any of them to the browser. There are still no push or SMS notifications.

## Verification performed

```bash
npm run lint
npm run typecheck
npm run build
```

All three pass in this workspace. The default Turbopack build was blocked by the execution sandbox when it attempted to bind a worker port, so the project build script uses Next's webpack compiler instead; this still produces the production build shown above.

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

## Later: deploy to Vercel

Import the repository into Vercel, add the same environment variables from `.env.local`, and set Supabase Auth's Site URL and callback redirect URL to the Vercel deployment URL. No deployment was attempted because this workspace has no Vercel or Supabase project credentials.
