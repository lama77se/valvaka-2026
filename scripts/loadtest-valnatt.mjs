// Fas 7 (del 2) — klient-last/throughput: streamar en full valnattsvolym (2026-
// koder, FK-giltiga) i hög takt och mäter om den rAF-koalescerade klienten hinner
// med per-rad-CDC via Realtime — eller om broadcast-aggregat-vägen (Fas 5-
// uppskjuten) behövs. Kopplat till uppskalningsbeslutet (§7/§9.6).
//
//   node --env-file=.env.local scripts/loadtest-valnatt.mjs [--districts N] [--batch N]
//
// Kräver att dev-servern kör (window.__map/__eventCount är DEV-only) + service_role.
import { chromium } from 'playwright'
import ws from 'ws'
import { createClient } from '@supabase/supabase-js'

globalThis.WebSocket ??= ws
const URL = process.env.VERIFY_URL ?? 'http://localhost:5926/'
const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) { console.error('Saknar VITE_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1) }
const db = createClient(url, serviceKey, { auth: { persistSession: false } })
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d }
// Realtime släpper bara igenom ändringar från TRANSAKTIONER under ett tak (~100
// rader). Jättebatchar (500 distrikt × 8 = 4000 rader/txn) tappas HELT — reellt
// fynd: skarp ingest måste upserta i SMÅ transaktioner (per distrikt/klunga).
// Håll rader/txn < taket: BATCH distrikt × ~8 partier.
const BATCH = Number(arg('--batch', '10')) // 10 × 8 = 80 rader/txn
const CONC = Number(arg('--conc', '6')) // samtidiga upserts → höjer event-takten

// Alla 2026-distrikt (paginerat) + färgade partier.
const codes = []
for (let from = 0; ; from += 1000) {
  const { data } = await db.from('district').select('valdistriktskod').range(from, from + 999)
  if (!data?.length) break
  codes.push(...data.map((d) => d.valdistriktskod))
  if (data.length < 1000) break
}
const LIMIT = Number(arg('--districts', String(codes.length)))
const targets = codes.slice(0, LIMIT)
const { data: parties } = await db.from('party').select('partikod').not('color', 'is', null)
const partikoder = parties.map((p) => p.partikod)
const rowsTotal = targets.length * partikoder.length
console.log(`[loadtest] ${targets.length} distrikt × ${partikoder.length} partier = ${rowsTotal} rader (RD)`)

// Ren tavla.
await db.from('result').delete().eq('valtyp', 'RD')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
await page.waitForFunction(() => window.__map?.isSourceLoaded('districts') && window.__realtimeReady === true, { timeout: 45000 })
await page.evaluate(() => { window.__eventCount = 0 })

// Bygg små transaktioner (klungor om BATCH distrikt) och streama dem med
// begränsad samtidighet för att pressa upp event-takten mot klienten.
const chunks = []
for (let i = 0; i < targets.length; i += BATCH) {
  const rows = []
  for (const vd of targets.slice(i, i + BATCH))
    for (const pk of partikoder)
      rows.push({ valtyp: 'RD', valdistriktskod: vd, partikod: pk, roster: 50 + Math.floor(Math.random() * 900), status: 'preliminar' })
  chunks.push(rows)
}
console.log(`[loadtest] streamar ${chunks.length} transaktioner (${BATCH} distrikt/txn, ${CONC} samtidiga) …`)
const t0 = Date.now()
let streamed = 0
let next = 0
const worker = async () => {
  while (next < chunks.length) {
    const rows = chunks[next++]
    const { error } = await db.from('result').upsert(rows, { onConflict: 'valtyp,valdistriktskod,partikod' })
    if (error) throw new Error(error.message)
    streamed += rows.length
  }
}
await Promise.all(Array.from({ length: CONC }, worker))
const streamSec = (Date.now() - t0) / 1000
console.log(`[loadtest] ${streamed} rader upsertade på ${streamSec.toFixed(1)}s (${Math.round(streamed / streamSec)} rader/s server-in)`)

// Vänta tills klienten slutar ta emot events (drain) eller timeout.
let last = -1, stable = 0, drainMs = 0
const drainStart = Date.now()
while (Date.now() - drainStart < 60000) {
  await page.waitForTimeout(500)
  const ev = await page.evaluate(() => window.__eventCount ?? 0)
  if (ev === last) { if (++stable >= 4) break } else { stable = 0 }
  last = ev
}
drainMs = Date.now() - drainStart
const received = await page.evaluate(() => window.__eventCount ?? 0)
const reported = await page.evaluate(() => window.__reportedCount ?? 0)
await browser.close()

// Städa.
await db.from('result').delete().eq('valtyp', 'RD')

const ratio = received / streamed
console.log('\n--- Resultat ---')
console.log(`rader streamade (server-in) : ${streamed}`)
console.log(`events mottagna (klient)    : ${received}  (${(ratio * 100).toFixed(1)}% av streamade)`)
console.log(`distrikt färgade (klient)   : ${reported} / ${targets.length}`)
console.log(`stream-tid                  : ${streamSec.toFixed(1)}s (${Math.round(streamed / streamSec)} rader/s in)`)
console.log(`event-takt (klient)         : ${Math.round(received / (streamSec + drainMs / 1000))} events/s`)
console.log(`drain-tid efter sista upsert: ${(drainMs / 1000).toFixed(1)}s`)

// Verdikt kopplat till uppskalningsbeslutet.
const allColored = reported >= targets.length * 0.99
const delivered = ratio >= 0.98
console.log('\n--- Verdikt (uppskalning) ---')
if (delivered && allColored) {
  console.log('✅ rAF-koalescerad per-rad-CDC BÄR denna volym: ~alla events levererade,')
  console.log('   alla distrikt färgade. Broadcast-aggregat-vägen ej nödvändig än.')
} else {
  console.log('⚠ per-rad-CDC TAPPAR under full burst:')
  if (!delivered) console.log(`   endast ${(ratio * 100).toFixed(1)}% av raderna nådde klienten (Realtime-tak/drop).`)
  if (!allColored) console.log(`   ${reported}/${targets.length} distrikt färgade.`)
  console.log('   → broadcast-aggregat-vägen (edge-funktion) behövs för valnattsvolym (§7).')
}
process.exit(0)
