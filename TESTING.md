# Jibon AI testing

The dated results and fixes are recorded centrally in [CHANGELOG.md](CHANGELOG.md). These instructions reproduce the checks without modifying hosted user records.

## Automated checks

From the repository root:

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev --audit-level=moderate
```

`npm test` runs six unit tests and an isolated in-memory PostgreSQL database through PGlite. The database runner applies every application migration in filename order, checks legacy-record preservation, runs the three rollback-based SQL suites, exercises thirteen multi-account scenarios, and checks RLS/function grants. It requires no `.env.local`, Docker, hosted database, or credentials. Fixtures are discarded with the in-memory database.

`tests/support/platform.sql` is **test-only**. Never apply it to Supabase. It supplies minimal Auth/Storage tables and JWT helper functions and records cron schedules. Application RLS, functions, triggers, and constraints run as SQL; Auth servers, Storage APIs, PostgREST, cron execution, and multi-connection concurrency are not simulated. This suite does not replace a full Supabase integration environment.

## Local HTTP checks

Configure the public Supabase URL and publishable key in `.env.local`, build, then start the app:

```sh
npm run start
```

In another terminal:

```sh
npm run test:http
```

An alternative local port can be supplied with `TEST_BASE_URL=http://localhost:3001 npm run test:http`. The 24 checks send no cookies, verify protected endpoints and cross-origin rejection, reject malformed JSON, and inspect redirects and auth-form return links. App Router may stream a redirect after sending HTTP 200; the checks inspect the redirect instruction in that case. The current tests do not sign in, create users, or send real invitations.

Restart `npm run start` after rebuilding to avoid testing a stale server bundle. Use `npm run dev` for normal editing.

## Live acceptance checklist

First compare the hosted migration history with `supabase/migrations/`. Apply **only unapplied** migrations in filename order. The latest fix is `20261115184913_invitation_acceptance_regression_fixes.sql`. Back up the database before migrating an existing project. Never run the platform test stub against it or disable RLS. The current session has no database-admin connection, so hosted application is a separate required step.

Use two dedicated test accounts in a disposable Supabase test project and separate browser profiles:

1. Register and verify email; check login/logout, session persistence, and invitation return paths through registration and verification. Configure localhost callback URLs to allow the callback query string.
2. Invite account B from account A by Jibon ID and by email link. Verify only B receives the invitation and sees the name, relationship, inviter, and access scope. Before acceptance, B must have no membership or tree person in A's family.
3. Accept once. Verify exactly one linked person, the correct directional edge, and the intended workspace membership. Refresh both accounts, edit B's own personal details, and confirm synchronization. Test an expired, cancelled, replayed, and wrong-account invitation. A stale inviter/anchor or ancestry conflict must leave no partial membership.
4. Test **tree-only sharing separately**: B can view A's tree/authorized portraits after acceptance, cannot access A's tasks, bills, appointments, finances, shopping, or documents, and loses tree access immediately on revocation. Workspace invitations intentionally grant shared household access; they are not tree-only invites.
5. Create/edit/complete/delete tasks, create/pay/edit/delete bills, and manage appointments. Refresh and compare dashboard totals with the records, including overdue, due-today, paid, completed, and timezone-boundary cases. Attempt unauthorized reads/writes with the other account.
6. Check invalid inputs, network failures, retry states, keyboard focus, screen-reader announcements, and small/large screens with populated trees and lists. Browser checks completed so far cover only a subset of screens and basic form labeling.
7. With server-side service configuration, verify email delivery, retry/idempotency and worker restarts, private uploads/downloads, document processing/deletion, reminder scheduling, and real Gemini proposals requiring confirmation. Without Gemini, verify the unavailable state and manual CRUD.

Record actual outcomes and failures in the change log. No production deployment is part of the current localhost testing scope.
