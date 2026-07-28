// Fas 5 — teardown: rensa simulerade RD-resultat så demodata inte ligger kvar i
// det delade Supabase-projektet och ser skarpt ut.
//
//   node --env-file=.env.local scripts/reset-results.mjs
import ws from 'ws'
import { createClient } from '@supabase/supabase-js'

globalThis.WebSocket ??= ws

const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Saknar VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (kör med --env-file=.env.local).')
  process.exit(1)
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } })

const { error, count } = await db
  .from('result')
  .delete({ count: 'exact' })
  .eq('valtyp', 'RD')
if (error) throw new Error(error.message)
console.log(`[reset-results] raderade ${count ?? '?'} RD-rader ur result.`)
process.exit(0)
