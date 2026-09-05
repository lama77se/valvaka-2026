// Klient-concurrency-lasttest mot Supabase (valnatts-CPU-oro). Simulerar:
//  • en valnatts-lik SKRIVSTRÖM (re-upsertar en roterande batch RD-rader med SAMMA värden →
//    bumpar updated_at via trigger → WAL → Realtime fan-out; ingen datakorruption),
//  • N samtidiga SUBSCRIBERS (anon Realtime-prenumeration på result, som riktiga flikar),
//  • en SNAPSHOT-HERD (M samtidiga fulla snapshot-läsningar).
// Skriver stegade wall-clock-tidsstämplar så CPU-grafen i Supabase kan korreleras per steg.
// Städar inget (skrivaren rör bara updated_at). Kör: node --env-file=.env.local scripts/loadtest-clients.mjs
import ws from 'ws'
import { createClient } from '@supabase/supabase-js'
globalThis.WebSocket ??= ws // supabase-js kräver WebSocket-konstruktor även utan Realtime; Node 20 saknar nativ

const URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const ts = () => new Date().toISOString().slice(11, 19)
const log = (m) => console.log(`[${ts()}] ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const svc = createClient(URL, SVC)

// --- skrivare: roterande batch om 100 RD-rader, re-upsert med samma värden var 2s ---
let writePool = []
let writeOn = false
let writeCursor = 0
let writeBatches = 0
async function loadWritePool() {
  const { data } = await svc.from('result').select('valtyp,valdistriktskod,partikod,roster,status').eq('valtyp', 'RD').order('valdistriktskod').order('partikod').limit(4000)
  writePool = data ?? []
  log(`skrivpool: ${writePool.length} RD-rader`)
}
async function writerTick() {
  if (!writeOn || writePool.length === 0) return
  const batch = []
  for (let i = 0; i < 100; i++) { batch.push(writePool[writeCursor % writePool.length]); writeCursor++ }
  const { error } = await svc.from('result').upsert(batch, { onConflict: 'valtyp,valdistriktskod,partikod' })
  if (error) log(`  [skrivfel] ${error.message}`); else writeBatches++
}

// --- subscribers ---
const subs = []
let events = 0
let subErrors = 0
let subOk = 0
async function addSubscribers(n) {
  const start = subs.length
  for (let i = 0; i < n; i++) {
    const c = createClient(URL, ANON, { realtime: { params: { eventsPerSecond: 40 } } })
    c.channel(`lt-${start + i}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'result' }, () => { events++ })
      .subscribe((status) => { if (status === 'SUBSCRIBED') subOk++; else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') subErrors++ })
    subs.push(c)
    if (i % 25 === 0) await sleep(120) // strypt anslutningstakt så vi inte spikar lokalt
  }
}

// --- snapshot-herd: M samtidiga fulla RD-snapshot-läsningar ---
async function snapshotOnce() {
  const t0 = Date.now()
  let from = 0, rows = 0
  for (;;) {
    const { data, error } = await createClient(URL, ANON).from('result').select('valtyp,valdistriktskod,partikod,roster,status,updated_at').eq('valtyp', 'RD').order('valdistriktskod').order('partikod').range(from, from + 10000 - 1)
    if (error) return { ms: Date.now() - t0, rows, err: error.message }
    if (!data?.length) break
    rows += data.length; from += data.length
    if (data.length < 10000) break
  }
  return { ms: Date.now() - t0, rows }
}

;(async () => {
  await loadWritePool()
  const writer = setInterval(writerTick, 2000)

  log('=== STEG 0: baslinje — bara skrivare, 0 subscribers (30s) ===')
  writeOn = true
  await sleep(30000)
  log(`  skrivbatchar hittills: ${writeBatches} (~${writeBatches * 100} upserts)`)

  log('=== STEG 1: +50 subscribers (60s) ===')
  await addSubscribers(50)
  await sleep(60000)
  log(`  subscribers ok=${subOk} err=${subErrors} · events mottagna=${events}`)

  log('=== STEG 2: +100 → 150 subscribers (60s) ===')
  await addSubscribers(100)
  await sleep(60000)
  log(`  subscribers ok=${subOk} err=${subErrors} · events mottagna=${events}`)

  log('=== STEG 3: +150 → 300 subscribers (60s) ===')
  await addSubscribers(150)
  await sleep(60000)
  log(`  subscribers ok=${subOk} err=${subErrors} · events mottagna=${events}`)

  log('=== STEG 4: snapshot-herd — 50 samtidiga fulla snapshot-läsningar ===')
  const t0 = Date.now()
  const res = await Promise.all(Array.from({ length: 50 }, () => snapshotOnce()))
  const okr = res.filter((r) => !r.err)
  const errs = res.filter((r) => r.err)
  const mss = okr.map((r) => r.ms).sort((a, b) => a - b)
  log(`  50 snapshots klara på ${Date.now() - t0}ms väggtid. per-läsning: min ${mss[0]}ms · median ${mss[Math.floor(mss.length / 2)]}ms · max ${mss[mss.length - 1]}ms · fel ${errs.length}`)
  if (errs.length) log(`  snapshot-fel (ex): ${errs[0].err}`)

  writeOn = false
  clearInterval(writer)
  log('=== KLART ===')
  log(`SLUTSUMMA: subscribers ok=${subOk}/${subs.length} err=${subErrors} · totalt events=${events} · skrivbatchar=${writeBatches}`)
  for (const c of subs) { try { await c.removeAllChannels() } catch { /* noop */ } }
  process.exit(0)
})()
