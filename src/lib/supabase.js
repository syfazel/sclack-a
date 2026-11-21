import { createClient } from '@supabase/supabase-js'

// Supabase project sclack-a. The URL is public; the publishable key comes
// ONLY from the build-time env var VITE_SUPABASE_PUBLISHABLE_KEY (injected
// via GitHub Actions Secret). No key value is ever written in any file.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://bbmjurrbkgnysnrtxbnz.supabase.co'

export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''

// True only when a key was injected at build time. Without it the app shows
// a "key not connected" notice and the login form stays inert.
export const isConfigured = Boolean(SUPABASE_KEY)

export const sb = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    })
  : null
