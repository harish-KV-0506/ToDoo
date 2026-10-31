import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const supabaseConfigIssue = (() => {
  if (!supabaseUrl || !publishableKey) {
    return 'Add your Supabase project URL and publishable key to the site build settings.'
  }
  try {
    const url = new URL(supabaseUrl)
    const isLocalHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
    if (url.protocol !== 'https:' && !isLocalHttp) {
      return 'The Supabase URL must use HTTPS outside local development.'
    }
    return null
  } catch {
    return 'The Supabase project URL is not a valid URL.'
  }
})()

export const isSupabaseConfigured = supabaseConfigIssue === null

let client: SupabaseClient<Database> | null = null

export function getSupabaseClient() {
  if (!isSupabaseConfigured) return null
  if (!client) {
    if (!supabaseUrl || !publishableKey) throw new Error(supabaseConfigIssue ?? 'Supabase configuration is unavailable.')
    client = createClient<Database>(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    })
  }
  return client
}
