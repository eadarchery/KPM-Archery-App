-- ============================================================
-- MIGRATION STATE AUDIT  (read-only — changes nothing)
-- ------------------------------------------------------------
--   Paste this whole file into the Supabase SQL Editor and RUN.
--   It probes the catalog for one signature object per migration and
--   reports OK / MISSING. Nothing is written. Safe to run anytime.
--
--   Read the result grid: any row marked "MISSING" is a migration whose
--   changes are NOT in your database. Share the grid back and I'll turn the
--   MISSING rows into a safe, ordered run list.
--
--   NOT PROBED (grants / policy / data-only / in-place function updates that
--   can't be told apart by object existence):
--     008, 027, 035, 036, 037, 038, 042, 047, 050, 051, 055_coach_signup,
--     057_enable_coach_equipment, 060, 069.
--   These don't create a detectable object; verify them by behavior instead.
-- ============================================================

WITH c(seq, migration, gates, applied) AS (
  VALUES
  ('001','extensions & schemas','base schemas + helpers',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='core' AND p.proname='set_updated_at')),
  ('002','org tables','states / plds / schools',
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='org' AND table_name='states')),
  ('003','core tables','core.profiles',
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='core' AND table_name='profiles')),
  ('004','coaching/scoring tables','score_submissions, rounds, links',
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='scoring' AND table_name='score_submissions')),
  ('005','supporting tables','articles, notifications, certs, achievements',
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='content' AND table_name='articles')),
  ('006','RLS + api/public views','core.is_admin() etc.',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='core' AND p.proname='is_admin')),
  ('007','signup + audit + achievement fns','handle_new_user / log_audit',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='log_audit')),
  ('009','score submission columns','bow_category + status/age_group checks',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='scoring' AND table_name='score_submissions' AND column_name='bow_category')),
  ('010','archer profile page','public.archer_profiles view',
    EXISTS(SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='archer_profiles')),
  ('011','profile change requests','core.profile_change_requests',
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='core' AND table_name='profile_change_requests')),
  ('012','achievement badges','badge_light_url column',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='achievement' AND table_name='achievement_definitions' AND column_name='badge_light_url')),
  ('013','notification manager','notifications.category',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='notification' AND table_name='notifications' AND column_name='category')),
  ('014','articles fields','articles.tags',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='content' AND table_name='articles' AND column_name='tags')),
  ('015','system rules','core.system_rules table',
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='core' AND table_name='system_rules')),
  ('016','role permissions','system.role_permissions table',
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='system' AND table_name='role_permissions')),
  ('017','user management','profiles.admin_notes',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='core' AND table_name='profiles' AND column_name='admin_notes')),
  ('018','admin1 approval scope','profiles.assigned_state_id',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='core' AND table_name='profiles' AND column_name='assigned_state_id')),
  ('020','equipment profiles','equipment_setups.riser_brand',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='scoring' AND table_name='equipment_setups' AND column_name='riser_brand')),
  ('021','organization management','schools.contact_person',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='org' AND table_name='schools' AND column_name='contact_person')),
  ('023','coach profile','coach_profiles.coaching_level',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='coaching' AND table_name='coach_profiles' AND column_name='coaching_level')),
  ('024','round category + leaderboard','rounds.category',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='scoring' AND table_name='rounds' AND column_name='category')),
  ('025','reports foundation','report_state_activity view',
    EXISTS(SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='report_state_activity')),
  ('026','app settings','core.app_config table',
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='core' AND table_name='app_config')),
  ('030','account recovery','support.account_recovery_requests',
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='support' AND table_name='account_recovery_requests')),
  ('031','security audit (guard)','core.guard_profile_privilege',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='core' AND p.proname='guard_profile_privilege')),
  ('033','score guard','core.guard_score_submission',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='core' AND p.proname='guard_score_submission')),
  ('034','school-code registration','schools.reg_code + resolve_school_code()',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='org' AND table_name='schools' AND column_name='reg_code')),
  ('039','coach pending archers fn','public.coach_pending_archers',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='coach_pending_archers')),
  ('040','admin delete user','public.admin_delete_user',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin_delete_user')),
  ('041','score session time','score_submissions.session_time',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='scoring' AND table_name='score_submissions' AND column_name='session_time')),
  ('043','round manager','rounds.arrows_per_end / target_face',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='scoring' AND table_name='rounds' AND column_name='target_face')),
  ('044','coach achievements','check_and_grant_coach_achievements',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='check_and_grant_coach_achievements')),
  ('045','plot data','score_submissions.plot_data',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='scoring' AND table_name='score_submissions' AND column_name='plot_data')),
  ('046','achievement score max','achievement_definitions.max_score',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='achievement' AND table_name='achievement_definitions' AND column_name='max_score')),
  ('048','coach link by archer id','public.coach_find_archer',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='coach_find_archer')),
  ('049','coach scoring ecosystem','profiles.is_pld_coach',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='core' AND table_name='profiles' AND column_name='is_pld_coach')),
  ('052','admin1 multi-scope','core.admin1_scopes table',
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='core' AND table_name='admin1_scopes')),
  ('053','notif cover + article audiences','notifications.image_url',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='notification' AND table_name='notifications' AND column_name='image_url')),
  ('054','scoped reads + engagement','notifications.recipient_id + overview_weekly_trend',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='notification' AND table_name='notifications' AND column_name='recipient_id')),
  ('055a','recovery rate limit','account_recovery_requests.request_ip',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='support' AND table_name='account_recovery_requests' AND column_name='request_ip')),
  ('056a','coach reject archer','public.coach_reject_archer',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='coach_reject_archer')),
  ('056b','schools import meta','schools.meta',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='org' AND table_name='schools' AND column_name='meta')),
  ('057a','achievement distance/category','achievement_definitions.distance_m',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='achievement' AND table_name='achievement_definitions' AND column_name='distance_m')),
  ('058','preferred language','profiles.preferred_language',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='core' AND table_name='profiles' AND column_name='preferred_language')),
  ('059','age snapshot + unlinked lb  <<KEY>>','profiles.birth_year',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='core' AND table_name='profiles' AND column_name='birth_year')),
  ('059b','  └ score competition cols','score_submissions.competition_year',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='scoring' AND table_name='score_submissions' AND column_name='competition_year')),
  ('061','KPM development metrics','public.kpm_report_summary',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='kpm_report_summary')),
  ('062','KPM training activity','public.kpm_training_summary',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='kpm_training_summary')),
  ('063','KPM coach coverage','public.kpm_coach_coverage_summary',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='kpm_coach_coverage_summary')),
  ('064','KPM retention/dropout','public.kpm_retention_summary',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='kpm_retention_summary')),
  ('065','KPM score normalisation','public.kpm_score_summary',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='kpm_score_summary')),
  ('066','KPM talent pipeline','public.kpm_talent_summary',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='kpm_talent_summary')),
  ('067','KPM scope health','public.kpm_scope_health',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='kpm_scope_health')),
  ('068','KPM data quality','public.kpm_data_quality_summary',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='kpm_data_quality_summary')),
  ('070','mock demo data system','public.clear_kpm_demo_mock_data',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='clear_kpm_demo_mock_data')),
  ('071','KPM talent config','scoring.kpm_talent_config table',
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='scoring' AND table_name='kpm_talent_config')),
  ('072','KPM retention archers','public.kpm_retention_archers',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='kpm_retention_archers')),
  ('073','KPM coach certifications','public.kpm_coach_certifications',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='kpm_coach_certifications')),
  ('074','KPM schools without coach','public.kpm_schools_without_coach',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='kpm_schools_without_coach')),
  ('075','leaderboard gender  <<KEY>>','public.leaderboard has gender column',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leaderboard' AND column_name='gender')),
  ('076','archer disciplines  <<KEY>>','profiles.disciplines',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='core' AND table_name='profiles' AND column_name='disciplines')),
  ('077','article author name  <<KEY>>','articles.author_name',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='content' AND table_name='articles' AND column_name='author_name')),
  ('078','score view exposes age  <<KEY>>','public.score_submissions has competition_age',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='score_submissions' AND column_name='competition_age')),
  ('079','age_group check widened  <<KEY>>','constraint allows U12/U15/U18/Open',
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname='score_submissions_age_group_check' AND pg_get_constraintdef(oid) LIKE '%U12%')),
  ('080','security guards (privilege gaps)  <<KEY>>','core.guard_coach_certification trigger fn',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='core' AND p.proname='guard_coach_certification')),
  ('081','public-surface hardening  <<KEY>>','anon can NOT select public.leaderboard',
    EXISTS(SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='leaderboard')
    AND NOT has_table_privilege('anon','public.leaderboard','SELECT')),
  ('082','coach link needs archer consent  <<KEY>>','coach_archer_links.initiated_by + archer_respond RPC',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='coaching' AND table_name='coach_archer_links' AND column_name='initiated_by')
    AND EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='archer_respond_coach_link')),
  ('083','final security/query guards  <<KEY>>','achievement RPC internal + approved cert upload + audit limiter index',
    (to_regprocedure('public.check_and_grant_achievements(uuid)') IS NULL
      OR NOT has_function_privilege('authenticated','public.check_and_grant_achievements(uuid)','EXECUTE'))
    AND EXISTS(
      SELECT 1 FROM pg_policies
      WHERE schemaname='certification' AND tablename='certifications'
        AND policyname='cert_coach_inserts_own' AND with_check LIKE '%is_approved%'
    )
    AND EXISTS(
      SELECT 1 FROM pg_indexes
      WHERE schemaname='audit' AND indexname='audit_logs_actor_created_idx'
    )),
  ('084','scalable leaderboard read models  <<KEY>>','internal snapshots + guarded paginated RPCs',
    EXISTS(SELECT 1 FROM pg_matviews WHERE schemaname='reporting' AND matviewname='leaderboard_snapshot')
    AND EXISTS(SELECT 1 FROM pg_matviews WHERE schemaname='reporting' AND matviewname='coach_leaderboard_snapshot')
    AND EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='leaderboard_page')
    AND NOT has_schema_privilege('authenticated','reporting','USAGE')),
  ('085','bounded admin review queues  <<KEY>>','secured queue page + one-scan summaries + indexes',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin2_review_queue_page')
    AND EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin2_review_queue_summary')
    AND EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='scoring' AND indexname='scoring_submissions_status_created_page_idx')
    AND NOT has_function_privilege('anon','public.admin2_review_queue_page(text,jsonb,timestamptz,uuid,integer)','EXECUTE')),
  ('086','admin MFA / AAL2 enforcement  <<KEY>>','MFA-aware shared auth helpers',
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='core' AND p.proname='session_has_admin_mfa')
    AND has_function_privilege('authenticated','core.session_has_admin_mfa()','EXECUTE')
    AND NOT has_function_privilege('anon','core.session_has_admin_mfa()','EXECUTE'))
)
SELECT
  seq          AS "#",
  CASE WHEN applied THEN 'OK'      ELSE '❌ MISSING' END AS status,
  migration,
  gates
FROM c
ORDER BY seq;
