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

// GLOBAL REQUEST-TIMEOUT. Utan den kan ett hängt anrop (tappad mobilanslutning mitt i en request,
// stallad HTTP/2-ström under överlast) ligga kvar i minuter/obegränsat — och eftersom resync-
// spärrarna (resyncingRef m.fl.) släpps först när promisen settlar, slutade den valtypen då att
// polla för resten av sessionen, med grön Live-prick. 30 s räcker gott för en 10k-raders sida
// på Large; ett avbrutet anrop blir ett vanligt fel → nästa tick försöker igen.
const REQUEST_TIMEOUT_MS = 30_000
const fetchWithTimeout: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) })

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  global: { fetch: fetchWithTimeout },
})
