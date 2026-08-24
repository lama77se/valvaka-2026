// Uppdaterar party.color i DB för riksdagspartierna — så nya märkesfärger slår igenom
// direkt utan att köra om hela referens-ingesten (som kräver data/raw-filerna).
//
//   node --env-file=.env.local scripts/update-party-colors.mjs
//
// Håll paletten i synk med PARTY_COLORS i ingest-reference.mjs (källan vid full ingest).
import ws from 'ws'
import { createClient } from '@supabase/supabase-js'

globalThis.WebSocket ??= ws

const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Saknar VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (kör med --env-file=.env.local)')
  process.exit(1)
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } })

const PARTY_COLORS = {
  S: '#E8112d', M: '#52BDEC', SD: '#DDDD00', C: '#009933',
  V: '#8B0016', KD: '#231977', L: '#006AB3', MP: '#83CF39',
}

for (const [forkortning, color] of Object.entries(PARTY_COLORS)) {
  const { data, error } = await db.from('party').update({ color }).eq('forkortning', forkortning).select('partikod')
  if (error) throw new Error(`${forkortning}: ${error.message}`)
  console.log(`${forkortning} → ${color}  (${data?.length ?? 0} rad)`)
}
console.log('Klart.')
