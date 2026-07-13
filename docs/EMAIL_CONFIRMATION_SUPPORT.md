# Email Confirmation — Support & Admin Runbook

How registration email confirmation works, and what admins/support should do when
a user says "I never received the confirmation email."

## How it works

1. A user registers on `/login` (Register tab).
2. `supabase.auth.signUp()` creates the auth user. A database trigger
   (`public.handle_new_user`) creates their `core.profiles` row as **pending**,
   including a server-generated `archer_id` for archers.
3. If **email confirmation is enabled** in Supabase, no session is issued yet.
   The app shows a **"Check your email"** screen with the registered address and a
   **Resend confirmation email** button (60-second cooldown).
4. The user clicks the link in the email → Supabase confirms the address and
   redirects to `/login` with a session → the app routes them to `/pending`
   (still awaiting admin approval of their role).
5. For archers, the school code they entered is claimed on this first sign-in
   (it is stored locally at registration and applied once a session exists).

> Email confirmation is **separate** from account approval. Confirming the email
> only proves the address is real. An Admin 1 / Admin 2 still approves the role.

## When a user reports "no confirmation email"

Ask them to first check **Spam / Junk / Promotions** and confirm they typed the
address correctly. Then, as admin/support:

1. Open **Supabase Dashboard → Authentication → Users**.
2. Search for the email address.
   - **Not found** → the sign-up never completed. Ask them to register again and
     watch for validation errors (e.g. weak password, invalid email).
   - **Found, `Confirmed at` empty** → the account exists but the email is not yet
     confirmed. They can use **Resend confirmation email** on the app screen, or
     you can resend from the dashboard (see below).
   - **Found, `Confirmed at` set** → the email is already confirmed. Their issue is
     approval, not email — check `core.profiles.status` and approve via the
     Admin 2 → User Management page if their identity/role is verified.

## Resending / confirming as admin

- **Preferred:** have the user click **Resend confirmation email** in the app. It
  calls `supabase.auth.resend({ type: 'signup', email })` — it never creates a new
  account and is rate-limited.
- **From the dashboard:** Authentication → Users → the user → **Send confirmation
  email** (or generate a magic link). You can also manually mark the email
  confirmed there if identity is verified — do this sparingly.

## Rules

- **Do not** manually confirm/approve random users without verifying their
  identity and intended role with a coach/admin first.
- **Never** put the Supabase **service role key** in frontend code. The web app
  uses only the anon key. Any admin-only resend / force-confirm that needs elevated
  privileges must run in a **secure backend / server function** (e.g. a Supabase
  Edge Function using the service role key server-side), never in the browser.
- The app never shows raw Supabase error text to users. Rate-limit responses
  (HTTP 429 / `over_email_send_rate_limit`) show a friendly "try again later"
  message; full errors are logged only in development.

## Rate limits

Supabase caps confirmation emails per address/project. If a user (or a spam-click)
hits the cap they see: *"Too many confirmation emails have been requested. Please
wait and try again later."* The resend button also enforces a 60-second cooldown
client-side. There is **no automatic retry loop** — resends are always
user-initiated.
