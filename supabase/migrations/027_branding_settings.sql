-- ============================================================
-- Migration 027: Branding Settings
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--
-- Seeds global branding settings into the existing core.app_config
-- table (created in migration 026). All branding rows use
-- category = 'branding' so they are owned by the Branding page
-- and excluded from the App Settings page.
--
-- Storage bucket: 'branding' (public, 5 MB, image/*)
--   → Bucket must be created manually in Supabase Dashboard → Storage.
--   → Bucket storage policies were already added in migration 007.
--   → Allow: PNG, JPG, JPEG, WEBP  (SVG blocked — unsafe)
--
-- Prerequisites:
--   026_app_settings.sql must be run first (creates core.app_config).
-- ============================================================

-- ─── SEED BRANDING SETTINGS ───────────────────────────────────
-- ON CONFLICT (key) DO NOTHING → idempotent, never overwrites customised values.

INSERT INTO core.app_config (key, label, description, category, value, value_type, is_public) VALUES

-- ── Identity ─────────────────────────────────────────────────
('brand_name',
 'Brand name',
 'Primary brand name displayed in the app header and across public-facing pages.',
 'branding', '"EAD Archery Scene Monitor"', 'string', true),

('brand_short_name',
 'Brand short name',
 'Condensed name used in mobile headers and compact UI areas.',
 'branding', '"EAD ASM"', 'string', true),

('brand_tagline',
 'Tagline',
 'Short brand tagline shown on the login screen and public landing areas.',
 'branding', '"Bring archers'' next step further."', 'string', true),

('brand_footer_text',
 'Footer text',
 'Text displayed in the app footer.',
 'branding', '"© 2025 EAD Archery Scene Monitor. All rights reserved."', 'string', true),

-- ── Logos ────────────────────────────────────────────────────
('brand_logo_light',
 'Logo (light mode)',
 'Logo shown on light-mode backgrounds. Upload a PNG or WebP with transparent background. Recommended: 200 × 60 px.',
 'branding', '""', 'string', true),

('brand_logo_dark',
 'Logo (dark mode)',
 'Logo shown on dark-mode backgrounds. Upload a PNG or WebP with transparent background. Recommended: 200 × 60 px.',
 'branding', '""', 'string', true),

('brand_icon',
 'App icon',
 'Square icon used as the PWA home-screen icon. Upload a square PNG or WebP. Recommended: 512 × 512 px.',
 'branding', '""', 'string', true),

('brand_favicon',
 'Favicon',
 'Browser tab icon. Upload a square PNG. Recommended: 64 × 64 px minimum.',
 'branding', '""', 'string', true),

-- ── Login page ───────────────────────────────────────────────
('brand_login_bg',
 'Login background',
 'Background image shown on the login / sign-up page. Upload a PNG or WebP. Recommended: 1920 × 1080 px.',
 'branding', '""', 'string', false),

('brand_login_heading',
 'Login heading',
 'Main heading shown on the login page.',
 'branding', '"Welcome to EAD Archery Scene Monitor"', 'string', true),

('brand_login_subheading',
 'Login subheading',
 'Secondary line of text shown below the login heading.',
 'branding', '"Sign in to continue to your dashboard."', 'string', true),

-- ── Colors ───────────────────────────────────────────────────
('brand_primary_color',
 'Primary color',
 'Main accent color used for buttons, links, and active states. Saved here for reference; apply via CSS to take full effect.',
 'branding', '"#E85D04"', 'string', true),

('brand_secondary_color',
 'Secondary color',
 'Secondary UI color used for hover states and secondary elements.',
 'branding', '"#F48C06"', 'string', true),

('brand_accent_color',
 'Accent color',
 'Highlight color for badges, indicators, and call-to-action elements.',
 'branding', '"#FFBA08"', 'string', true),

('brand_success_color',
 'Success color',
 'Color used for success states, approved statuses, and positive indicators.',
 'branding', '"#16a34a"', 'string', true),

('brand_warning_color',
 'Warning color',
 'Color used for warning states, caution badges, and pending indicators.',
 'branding', '"#d97706"', 'string', true),

('brand_danger_color',
 'Danger color',
 'Color used for error states, rejection notices, and destructive actions.',
 'branding', '"#dc2626"', 'string', true),

-- ── Theme & display ──────────────────────────────────────────
('brand_default_theme',
 'Default theme',
 'System-wide default theme. Users may override this with their own Appearance preference. Values: system, light, dark.',
 'branding', '"system"', 'string', true),

('brand_show_powered_by',
 'Show "Powered by" text',
 'Show the powered-by attribution line in the footer.',
 'branding', 'false', 'boolean', true),

('brand_powered_by_text',
 '"Powered by" text',
 'Attribution text shown in the footer when "Show powered by" is enabled.',
 'branding', '"Powered by EAD ASM"', 'string', true),

('brand_show_footer',
 'Show footer',
 'Show the footer bar at the bottom of the app.',
 'branding', 'true', 'boolean', true),

('brand_show_tagline',
 'Show tagline',
 'Show the brand tagline on the login page.',
 'branding', 'true', 'boolean', true),

-- ── Social & contact ─────────────────────────────────────────
('brand_website_url',
 'Website URL',
 'Official website URL. Shown in the footer if configured.',
 'branding', '""', 'string', false),

('brand_facebook_url',
 'Facebook URL',
 'Facebook page URL for the social media footer links.',
 'branding', '""', 'string', false),

('brand_instagram_url',
 'Instagram URL',
 'Instagram profile URL for the social media footer links.',
 'branding', '""', 'string', false),

('brand_tiktok_url',
 'TikTok URL',
 'TikTok profile URL for the social media footer links.',
 'branding', '""', 'string', false),

('brand_youtube_url',
 'YouTube URL',
 'YouTube channel URL for the social media footer links.',
 'branding', '""', 'string', false),

('brand_support_email',
 'Support email',
 'Support contact email shown to users. Separate from the public app_contact setting; this is the branding-level contact.',
 'branding', '""', 'string', false),

('brand_support_whatsapp',
 'Support WhatsApp',
 'WhatsApp number for support contact. Include country code, e.g. +60123456789.',
 'branding', '""', 'string', false)

ON CONFLICT (key) DO NOTHING;

-- ─── NOTES ─────────────────────────────────────────────────────────────────────
--  • All branding rows use category = 'branding'.
--  • The App Settings page (/super-admin/app-settings) explicitly excludes
--    category = 'branding' to keep the two pages separate.
--  • Only Super Admin can write these settings (core.app_config RLS from 026).
--  • Logo / favicon / background image URLs are stored here after upload to the
--    'branding' Supabase Storage bucket (created manually in the Dashboard).
--  • Do NOT store API keys, credentials, or secrets in this table.
--  • Colors are saved for reference and use by the Branding preview; full
--    app-wide CSS theme application is a TODO (requires CSS variable injection
--    or a theme provider update).
