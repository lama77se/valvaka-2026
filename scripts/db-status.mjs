// Read-only DB-status: hur ser result/uppsamling_result ut just nu?
// Fokus: finns status='slutlig'-rader kvar (som blockerar preliminär re-ingest)?
//   node --env-file=.env.local scripts/db-status.mjs
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

const STATUSES = ['preliminar', 'onsdag', 'slutlig']
const VALTYPER = ['RD', 'RF', 'KF']

async function count(table, filters = {}) {
  let q = db.from(table).select('*', { count: 'exact', head: true })
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v)
  const { count, error } = await q
  if (error) return `ERR(${error.message})`
  return count ?? 0
}

async function maxUpdated(table) {
  const { data, error } = await db.from(table).select('updated_at').order('updated_at', { ascending: false }).limit(1)
  if (error) return `ERR(${error.message})`
  return data?.[0]?.updated_at ?? '(inga rader)'
}

for (const table of ['result', 'uppsamling_result']) {
  const total = await count(table)
  console.log(`\n=== ${table} — totalt: ${total} rader ===`)
  console.log(`  senast uppdaterad: ${await maxUpdated(table)}`)
  console.log('  per status:')
  for (const s of STATUSES) {
    const c = await count(table, { status: s })
    const flag = s === 'slutlig' && typeof c === 'number' && c > 0 ? '  ⚠️ BLOCKAR preliminär re-ingest' : ''
    console.log(`    ${s.padEnd(11)} ${String(c).padStart(7)}${flag}`)
  }
  // slutlig per valtyp (den kritiska)
  const slutligByVt = []
  for (const vt of VALTYPER) slutligByVt.push(`${vt}=${await count(table, { status: 'slutlig', valtyp: vt })}`)
  console.log(`    slutlig/valtyp: ${slutligByVt.join('  ')}`)
}

console.log('\n=== ingest_state ===')
console.log(`  rader: ${await count('ingest_state')}`)

console.log('\n=== dataset_meta ===')
{
  const { data, error } = await db.from('dataset_meta').select('*')
  if (error) console.log(`  ERR(${error.message})`)
  else console.log('  ' + JSON.stringify(data))
}
process.exit(0)
