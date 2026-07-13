-- ============================================================
-- Migration 055: Server-side rate limiting for public account
--                recovery requests (forgot-email queue)
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent and safe to re-run. Run AFTER 030.
--
-- The forgot-email form is public (anon INSERT). Client-side it now has a
-- 2-minute device cooldown, but nothing stopped a script from posting
-- thousands of rows. This trigger enforces, at the database:
--
--   • max 3 requests per hour   per client IP
--   • max 10 requests per day   per client IP
--   • max 30 requests per hour  globally (circuit breaker if IPs rotate)
--
-- The client IP comes from the x-forwarded-for header PostgREST exposes via
-- current_setting('request.headers'). If the header is missing (e.g. direct
-- SQL, tests) the per-IP checks are skipped and only the global cap applies.
--
-- On violation it raises 'rate_limited' — the app maps this sentinel to a
-- friendly bilingual "too many attempts" message and never reveals more.
--
-- NOTE: forgot-PASSWORD limits are separate — they are enforced by Supabase
-- Auth itself (Dashboard → Auth → Rate limits + optional CAPTCHA). This
-- migration only covers the custom forgot-email queue table.
-- ============================================================

-- ─── 1. STORE THE REQUEST IP (abuse control only) ───────────────

ALTER TABLE support.account_recovery_requests
  ADD COLUMN IF NOT EXISTS request_ip text;

-- The IP column is for admin abuse-review only; it flows through the existing
-- public view automatically (SELECT * view, admin-only SELECT policy — anon
-- can never read it back).
CREATE OR REPLACE VIEW public.account_recovery_requests
  WITH (security_invoker = true) AS
SELECT * FROM support.account_recovery_requests;

CREATE INDEX IF NOT EXISTS account_recovery_ip_time_idx
  ON support.account_recovery_requests (request_ip, created_at);
CREATE INDEX IF NOT EXISTS account_recovery_time_idx
  ON support.account_recovery_requests (created_at);

-- ─── 2. RATE-LIMIT TRIGGER ───────────────────────────────────────

CREATE OR REPLACE FUNCTION support.account_recovery_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = support, public
AS $$
DECLARE
  v_ip           text;
  v_ip_hour      int;
  v_ip_day       int;
  v_global_hour  int;
BEGIN
  -- Client IP from PostgREST headers (first hop of x-forwarded-for).
  BEGIN
    v_ip := nullif(trim(split_part(
      coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''),
      ',', 1)), '');
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;

  NEW.request_ip := v_ip;

  IF v_ip IS NOT NULL THEN
    SELECT count(*) INTO v_ip_hour
      FROM support.account_recovery_requests
     WHERE request_ip = v_ip AND created_at > now() - interval '1 hour';
    IF v_ip_hour >= 3 THEN
      RAISE EXCEPTION 'rate_limited' USING HINT = 'per-ip hourly cap';
    END IF;

    SELECT count(*) INTO v_ip_day
      FROM support.account_recovery_requests
     WHERE request_ip = v_ip AND created_at > now() - interval '24 hours';
    IF v_ip_day >= 10 THEN
      RAISE EXCEPTION 'rate_limited' USING HINT = 'per-ip daily cap';
    END IF;
  END IF;

  -- Global hourly circuit breaker (catches rotating-IP floods).
  SELECT count(*) INTO v_global_hour
    FROM support.account_recovery_requests
   WHERE created_at > now() - interval '1 hour';
  IF v_global_hour >= 30 THEN
    RAISE EXCEPTION 'rate_limited' USING HINT = 'global hourly cap';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS account_recovery_rate_limit_trg ON support.account_recovery_requests;
CREATE TRIGGER account_recovery_rate_limit_trg
  BEFORE INSERT ON support.account_recovery_requests
  FOR EACH ROW EXECUTE FUNCTION support.account_recovery_rate_limit();

-- ─── NOTES ─────────────────────────────────────────────────────
--  • SECURITY DEFINER lets the trigger COUNT rows while anon has no SELECT
--    policy — anon still cannot read any data back.
--  • Caps are deliberately generous for legitimate use (a school lab sharing
--    one NAT IP can still file 3 requests/hour) while making bulk spam
--    pointless. Tune the constants here if launch traffic proves different.
--  • Supabase Auth's own limits (password reset emails etc.) are configured in
--    the Dashboard, not in SQL — see docs/launch-readiness-checklist.md.
