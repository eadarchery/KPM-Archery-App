import { supabase } from './supabase'
import type { Profile, Role } from '@/types'

// ─── SIGN IN / OUT ───────────────────────────────────────────────────────────

export async function signIn(email: string, password: string, captchaToken?: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
    // When Supabase Auth CAPTCHA is enabled (project-wide), every auth call must
    // carry a token; harmless no-op otherwise.
    ...(captchaToken ? { options: { captchaToken } } : {}),
  })
  if (error) throw error
  return data
}

/** Where Supabase sends users after they click the email confirmation link. */
function emailConfirmationRedirect(): string {
  return `${window.location.origin}/login`
}

export interface SignUpResult {
  userId: string
  /** True when Supabase requires email confirmation before issuing a session. */
  needsEmailConfirmation: boolean
}

export async function signUp(
  email: string,
  password: string,
  role: Role,
  name: string,
  schoolCode?: string,
  captchaToken?: string,
): Promise<SignUpResult> {
  // Create the auth user. The database trigger public.handle_new_user() creates
  // the profile row — including a unique server-generated archer_id for archers,
  // and (for archers) resolving school_code → requested_school_id — with SECURITY
  // DEFINER privileges. No client-side profile write is needed, so this works
  // whether or not email confirmation is enabled (when it is, signUp returns no
  // session and a client write would run as `anon` → permission denied).
  const metadata: Record<string, string> = { name: name.trim(), role }
  if (schoolCode && schoolCode.trim()) metadata.school_code = schoolCode.trim().toUpperCase()

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: metadata,
      emailRedirectTo: emailConfirmationRedirect(),
      ...(captchaToken ? { captchaToken } : {}),
    },
  })
  if (authError) throw authError
  if (!authData.user) throw new Error('Registration failed — no user returned.')

  // When email confirmation is enabled Supabase returns a user but no session.
  return { userId: authData.user.id, needsEmailConfirmation: !authData.session }
}

// ─── EMAIL CONFIRMATION RESEND ───────────────────────────────────────────────

/** Detect Supabase "too many emails" responses across their various shapes. */
export function isEmailRateLimitError(error: unknown): boolean {
  const e = error as { status?: number; code?: string; message?: string } | null
  if (!e) return false
  if (e.status === 429) return true
  if (e.code === 'over_email_send_rate_limit') return true
  const msg = (e.message ?? '').toLowerCase()
  return msg.includes('rate limit') || msg.includes('too many requests')
}

export type ResendOutcome =
  | { ok: true }
  | { ok: false; rateLimited: boolean }

/**
 * Resend the sign-up confirmation email. NEVER creates a new account and never
 * calls signUp() again. Returns a discriminated outcome so the UI can show
 * friendly messaging without exposing raw Supabase error text to end users.
 * The full error is logged only in development.
 */
export async function resendConfirmationEmail(email: string): Promise<ResendOutcome> {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: emailConfirmationRedirect() },
  })
  if (error) {
    if (import.meta.env.DEV) console.error('[auth] resendConfirmationEmail failed:', error)
    return { ok: false, rateLimited: isEmailRateLimitError(error) }
  }
  return { ok: true }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// ─── PROFILE ─────────────────────────────────────────────────────────────────

export async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) {
    // Row not found = new user whose profile hasn't been inserted yet
    if (error.code === 'PGRST116') return null
    console.error('loadProfile:', error)
    return null
  }
  return data as Profile
}

export async function updateProfile(userId: string, updates: Partial<Profile>): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) throw error
}

// ─── SESSION ─────────────────────────────────────────────────────────────────

export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  return session
}

export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) throw error
  return user
}

// ─── PASSWORD MANAGEMENT ─────────────────────────────────────────────────────

/** Change the current user's password. */
export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

/**
 * Admin password reset: Direct password change for a user account.
 * Calls the admin-reset-password Edge Function which has service role access.
 */
export async function adminResetUserPassword(userId: string, newPassword: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('admin-reset-password', {
    body: {
      target_user_id: userId,
      new_password: newPassword,
    },
  })

  if (error) {
    throw new Error(error.message || 'Failed to reset password')
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Password reset failed')
  }
}

/** Send a password reset email to a user. */
export async function sendPasswordResetEmail(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    { redirectTo: `${window.location.origin}/reset-password` },
  )
  if (error) throw error
}
