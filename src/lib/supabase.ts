import { createClient } from '@supabase/supabase-js'

// Klienten använder ENDAST publika värden: URL + anon-nyckel (RLS skyddar datan).
// Service-role-nyckeln får ALDRIG importeras här — den lever bara server-side i
// ingestion-edge-funktionen. Se docs/implementationsplan.md (nyckelhygien).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Kastar tidigt i dev om env saknas, i stället för kryptiska fel senare.
  console.warn(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY saknas — kopiera .env.example till .env.local och fyll i.',
  )
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '')
