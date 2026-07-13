// ─── ROLES & AUTH ────────────────────────────────────────────────────────────

export type Role = 'archer' | 'coach' | 'admin1' | 'admin2' | 'super_admin'

export type AccountStatus = 'pending' | 'approved' | 'rejected' | 'suspended' | 'inactive'

export interface Profile {
  id: string
  email: string
  name: string
  age?: number
  school_id?: string
  pld_id?: string
  state_id?: string
  archer_id?: string   // ASM-YYYY-XXXXXX
  coach_id?: string    // FK → profiles.id
  role: Role
  status: AccountStatus
  rejection_reason?: string
  approved_by?: string
  approved_at?: string
  // Admin-2 user-management lifecycle fields (added in migration 017)
  rejected_at?: string
  rejected_by?: string
  suspended_at?: string
  suspended_by?: string
  suspension_reason?: string
  admin_notes?: string
  /** Coach flagged by Admin 2 to validate coach scores within their PLD (migration 049). */
  is_pld_coach?: boolean
  // Admin-1 approval scope (added in migration 018)
  assigned_state_id?: string
  assigned_pld_id?: string
  assigned_school_id?: string
  scope_type?: 'national' | 'state' | 'pld' | 'school'
  avatar_url?: string
  phone?: string
  date_of_birth?: string
  /** Birth year — basis for calendar-year (competition) age group (migration 059). */
  birth_year?: number | null
  gender?: string
  bow_category?: string
  created_at: string
  updated_at: string
  // School claimed via registration code at sign-up (migrations 034/055) —
  // a claim for the approver to verify, not the official school_id.
  requested_school_id?: string | null
  /** UI language the user explicitly chose (migration 058). NULL = app default. */
  preferred_language?: 'en' | 'ms' | null
  // Joined relations (populated by query)
  school?: School
  pld?: Pld
  state?: State
  requested_school?: School
  coach?: Pick<Profile, 'id' | 'name' | 'email'>
}

// ─── GEOGRAPHY ───────────────────────────────────────────────────────────────

export interface State {
  id: string
  name: string
  code: string
  active?: boolean
  created_at?: string
  updated_at?: string
}

export interface Pld {
  id: string
  name: string
  code?: string | null
  state_id: string
  active?: boolean
  created_at?: string
  updated_at?: string
  state?: State
}

export interface School {
  id: string
  name: string
  code?: string | null
  pld_id?: string | null
  state_id: string
  address?: string | null
  contact_person?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  active: boolean
  created_at?: string
  updated_at?: string
  pld?: Pld
  state?: State
}

// ─── ROUNDS ──────────────────────────────────────────────────────────────────

export interface Round {
  id: string
  name: string
  category: string
  min_age: number
  max_age: number
  distance: string
  arrows_per_end: number
  ends_per_set: number
  sets: number
  total_arrows: number
  max_score: number
  bow_categories: string[]
  active: boolean
  created_at: string
}

// ─── SCORES ──────────────────────────────────────────────────────────────────

export type SubmissionStatus = 'pending' | 'coach_approved' | 'admin_approved' | 'rejected' | 'withdrawn'
export type SubmissionMode = 'per_arrow' | 'total'
export type ArrowValue = 'M' | 'X' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export interface ScoreSubmission {
  id: string
  archer_id: string
  coach_id?: string
  round_id: string
  date: string
  total_score: number
  max_score: number
  arrows_data?: object
  notes?: string
  status: SubmissionStatus
  proof_url?: string
  coach_approved_at?: string
  admin_approved_at?: string
  approved_by?: string
  rejection_reason?: string
  sync_source?: string
  created_at: string
  updated_at: string
  // Joined
  archer?: Pick<Profile, 'id' | 'name' | 'archer_id' | 'school_id' | 'state_id'>
  round?: Round
}

export interface ScoreArrow {
  id: string
  submission_id: string
  arrow_number: number
  value: ArrowValue
  end_number: number
}

export interface ValidationRecord {
  id: string
  submission_id: string
  validated_by: string
  action: 'approved' | 'rejected'
  reason?: string
  created_at: string
  validator?: Pick<Profile, 'id' | 'name' | 'role'>
}

// ─── TRAINING ────────────────────────────────────────────────────────────────

export interface TrainingLog {
  id: string
  archer_id: string
  coach_id?: string
  date: string
  arrows_shot: number
  session_type?: string
  notes?: string
  sync_source?: string
  created_at: string
  archer?: Pick<Profile, 'id' | 'name' | 'archer_id'>
}

// ─── EQUIPMENT ───────────────────────────────────────────────────────────────

export interface EquipmentSetup {
  id: string
  profile_id: string
  // Bow
  bow_category?: string | null
  bow_brand?: string | null
  bow_model?: string | null
  // Riser
  riser_brand?: string | null
  riser_model?: string | null
  riser_length?: string | null
  // Limbs
  limb_brand?: string | null
  limb_model?: string | null
  limb_length?: string | null
  limb_poundage?: number | null
  // Draw
  draw_weight?: number | null
  draw_length?: number | null
  // String
  string_brand?: string | null
  string_material?: string | null
  // Arrows
  arrow_brand?: string | null
  arrow_model?: string | null
  arrow_spine?: number | null
  arrow_length?: number | null
  point_weight?: number | null
  nock?: string | null
  vane?: string | null
  // Sight
  sight_brand?: string | null
  sight_model?: string | null
  // Stabilizer
  stabilizer?: string | null
  stabilizer_brand?: string | null
  stabilizer_model?: string | null
  // Accessories
  clicker?: string | null
  plunger?: string | null
  arrow_rest?: string | null
  scope?: string | null
  peep?: string | null
  release?: string | null
  finger_tab?: string | null
  sling?: string | null
  // Meta
  notes?: string | null
  updated_by?: string | null
  active: boolean
  created_at: string
  updated_at: string
}

// ─── COACH-ARCHER LINKS ──────────────────────────────────────────────────────

export interface CoachArcherLink {
  id: string
  coach_id: string
  archer_id: string
  status: 'active' | 'inactive'
  linked_at: string
  unlinked_at?: string
  archer?: Profile
  coach?: Profile
}

// ─── CERTIFICATIONS ──────────────────────────────────────────────────────────

export type CertificationStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'expired'

export interface Certification {
  id: string
  coach_id: string
  title: string
  issuer?: string
  issued_date?: string
  expiry_date?: string
  cert_url: string
  status: CertificationStatus
  rejection_reason?: string
  reviewed_by?: string
  reviewed_at?: string
  created_at: string
}

// ─── PERMISSIONS ─────────────────────────────────────────────────────────────

export type PermissionKey =
  | 'can_view_dashboard'
  | 'can_submit_own_score'
  | 'can_submit_archer_score'
  | 'can_upload_excel'
  | 'can_validate_training'
  | 'can_validate_tournament'
  | 'can_create_notification'
  | 'can_publish_notification'
  | 'can_target_notification'
  | 'can_create_edit_articles'
  | 'can_manage_badges'
  | 'can_manage_users'
  | 'can_approve_users'
  | 'can_manage_roles'
  | 'can_view_all_malaysia'
  | 'can_view_audit_logs'
  | 'can_change_app_settings'
  | 'can_change_logo_favicon'
  | 'can_manage_font_size'

export interface RoleRecord {
  id: string
  name: Role
  display_name: string
  created_at: string
}

export interface Permission {
  id: string
  role_id: string
  permission_key: PermissionKey
  allowed: boolean
  updated_by?: string
  updated_at: string
}

// Flat permission map used in the frontend
export type PermissionMap = Partial<Record<PermissionKey, boolean>>

// ─── ACHIEVEMENTS ────────────────────────────────────────────────────────────

export type AchievementCategory = 'score' | 'practice' | 'tournament' | 'coaching'
export type ThresholdType = 'score_value' | 'arrows_count' | 'sessions_count'

export interface AchievementDef {
  id: string
  slug: string
  name: string
  description: string
  category: AchievementCategory
  threshold?: number
  /** Score badges only: the round total the threshold applies to (e.g. 300 of 360). */
  max_score?: number | null
  /** Score badges only: required round distance in metres (NULL = any). */
  distance_m?: number | null
  /** Score badges only: required round type; 'practice' also matches 'training' rounds (NULL = any). */
  round_category?: 'tournament' | 'practice' | null
  icon?: string
  active: boolean
  badge_light_url?: string
  badge_dark_url?: string
  display_order?: number
  created_at: string
  updated_at?: string
}

export interface UserAchievement {
  id: string
  profile_id: string
  achievement_id: string
  earned_at: string
  context?: Record<string, unknown>
  achievement?: AchievementDef
}

// ─── NOTIFICATIONS ───────────────────────────────────────────────────────────

export type NotificationAudience = 'all' | 'archer' | 'coach' | 'admin1' | 'admin2' | 'state' | 'pld' | 'school'
export type NotificationStatus   = 'draft' | 'scheduled' | 'published' | 'archived'
export type NotificationCategory = 'announcement' | 'reminder' | 'score' | 'tournament' | 'system'
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface Notification {
  id: string
  title: string
  body: string
  audience: NotificationAudience
  audience_ref?: string
  created_by: string
  status?: NotificationStatus
  category?: NotificationCategory
  priority?: NotificationPriority
  published_at?: string
  expires_at?: string
  created_at: string
  updated_at?: string
  // Joined
  author?: Pick<Profile, 'id' | 'name' | 'role'>
  read?: { read_at: string }[]
  // Computed client-side
  is_read?: boolean
}

export interface NotificationRead {
  id: string
  notification_id: string
  profile_id: string
  read_at: string
}

// ─── ARTICLES ────────────────────────────────────────────────────────────────

export type ArticleStatus = 'draft' | 'published' | 'archived'

export type ArticleBlockType =
  | 'paragraph'
  | 'heading'
  | 'image'
  | 'gallery'
  | 'video'
  | 'quote'
  | 'linkbtn'
  | 'divider'
  // Legacy types kept for backward compatibility
  | 'pullquote'
  | 'cta'
  | 'linkcard'
  | 'carousel'

export interface ArticleBlock {
  id: string
  type: ArticleBlockType
  // Paragraph / Heading — rich HTML content
  html?: string
  content?: string
  level?: 1 | 2 | 3
  fontSize?: 'small' | 'normal' | 'medium' | 'large' | 'xl'
  fontFamily?: string
  align?: 'left' | 'center' | 'right' | 'justify'
  // Image
  url?: string
  alt?: string
  caption?: string
  // Gallery
  images?: { url: string; alt?: string; caption?: string }[]
  // Video embed
  videoUrl?: string
  provider?: 'youtube' | 'vimeo' | 'cloudflare' | 'other'
  title?: string
  // Quote / callout
  quoteStyle?: 'info' | 'warning' | 'success' | 'note'
  cite?: string
  // Link button
  label?: string
  btnStyle?: 'primary' | 'secondary' | 'outline'
  // Legacy fields
  src?: string
  items?: { src: string; caption?: string; url?: string }[]
  href?: string
}

export interface Article {
  id: string
  title: string
  slug: string
  dek?: string        // legacy alias — prefer summary
  summary?: string
  cover_url?: string
  body_blocks: ArticleBlock[]
  audience: string
  category?: string
  tags?: string[]
  is_featured?: boolean
  status: ArticleStatus
  author_id: string
  /** Optional custom byline that overrides the creator's profile name. */
  author_name?: string | null
  published_at?: string
  archived_at?: string
  updated_by?: string
  created_at: string
  updated_at: string
  author?: Pick<Profile, 'id' | 'name' | 'role'>
}

// ─── MEDIA ───────────────────────────────────────────────────────────────────

export interface ProofMedia {
  id: string
  submission_id: string
  storage_path: string
  public_url?: string
  uploaded_by: string
  created_at: string
}

// ─── APP SETTINGS (legacy single-row branding table) ─────────────────────────

export interface AppSettings {
  app_name: string
  tagline: string
  logo_url?: string
  favicon_url?: string
  pwa_icon_url?: string
  theme_color: string
  font_size_normal: number
  font_size_large: number
  font_size_small: number
  dark_mode_default: boolean
}

// ─── APP CONFIG (key-value general app settings, migration 026) ──────────────

export type AppConfigValueType = 'boolean' | 'string' | 'number' | 'json'

export type AppConfigValue =
  | boolean
  | number
  | string
  | Record<string, unknown>
  | unknown[]

export interface AppConfig {
  id: string
  key: string
  label: string
  description?: string
  category: string
  value: AppConfigValue
  value_type: AppConfigValueType
  is_public: boolean
  created_at: string
  updated_at: string
  updated_by?: string
}

// ─── SYSTEM RULES ────────────────────────────────────────────────────────────

export type SystemRuleValueType = 'boolean' | 'string' | 'number' | 'json'

export type SystemRuleValue =
  | boolean
  | number
  | string
  | Record<string, unknown>
  | unknown[]

export interface SystemRule {
  id: string
  key: string
  label: string
  description?: string
  category: string
  value: SystemRuleValue
  value_type: SystemRuleValueType
  is_public: boolean
  editable_by: string[]
  created_at: string
  updated_at: string
  updated_by?: string
}

// ─── ROLE PERMISSIONS ────────────────────────────────────────────────────────
// Super-admin-managed, per-(role, permission_key) capability matrix.
// Distinct from the legacy core.permission_rules / public.permissions table.

export type RolePermissionCategory =
  | 'navigation'
  | 'users'
  | 'scores'
  | 'achievements'
  | 'notifications'
  | 'articles'
  | 'organization'
  | 'reports'
  | 'system'

export interface RolePermission {
  id: string
  role: Role
  permission_key: string
  label: string
  description?: string
  category: string
  enabled: boolean
  locked: boolean
  locked_reason?: string
  created_at: string
  updated_at: string
  updated_by?: string
}

// ─── AUDIT LOGS ──────────────────────────────────────────────────────────────

export interface AuditLog {
  id: string
  actor_id?: string
  action: string
  target_type?: string
  target_id?: string
  meta?: Record<string, unknown>
  ip_address?: string
  created_at: string
  actor?: Pick<Profile, 'id' | 'name' | 'role'>
}

// ─── OFFLINE / SYNC ──────────────────────────────────────────────────────────

export type SyncStatus = 'local' | 'pending' | 'synced' | 'failed'

export type SyncItemType =
  | 'score_submission'
  | 'training_log'
  | 'notification_draft'
  | 'article_draft'

export interface SyncQueueItem {
  id: string
  type: SyncItemType
  payload: Record<string, unknown>
  status: SyncStatus
  created_at: string
  last_attempt?: string
  error?: string
}

// ─── UI ──────────────────────────────────────────────────────────────────────

export type Theme = 'light' | 'dark'
export type FontSize = 'normal' | 'large' | 'small' | 'xl' | 'max'

export interface BadgeCount {
  notifications: number
  achievements: number
  pendingValidations: number
  pendingApprovals: number
  failedSyncs: number
}

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number
  archer_id: string
  name: string
  age?: number
  school: string
  state: string
  pld: string
  bow_category: string
  round_name: string
  round_category?: string | null
  distance_m?: number | null
  age_group?: string | null
  competition_age?: number | null
  best_score: number
  max_score: number
  date: string
}
