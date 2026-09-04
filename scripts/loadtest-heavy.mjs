// Tyngre klient-lasttest: hitta taket på Small. Ramp 500 → 1000 subscribers + en TUNG
// skrivburst (peak-rapportering) vid 1000 subs. Skrivaren re-upsertar en roterande batch
// RD-rader med SAMMA värden (bumpar bara updated_at → WAL → Realtime fan-out). Wall-clock-
// stämplar så CPU-grafen kan korreleras. Kör: node --env-file=.env.local scripts/loadtest-heavy.mjs
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const ts = () => new Date().toISOString().slice(11, 19)
const log = (m) => console.log(`[${ts()}] ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const svc = createClient(URL, SVC)

let writePool = []
let writeMode = 'off' // 'off' | 'normal' (100/2s) | 'burst' (100/300ms)
let writeCursor = 0
let writeBatches = 0
async function loadWritePool() {
  const { data } = await svc.from('result').select('valtyp,valdistriktskod,partikod,roster,status').eq('valtyp', 'RD').order('valdistriktskod').order('partikod').limit(6000)
  writePool = data ?? []
  log(`skrivpool: ${writePool.length} RD-rader`)
}
async function writerTick() {
  if (writeMode === 'off' || writePool.length === 0) return
  const batch = []
  for (let i = 0; i < 100; i++) { batch.push(writePool[writeCursor % writePool.length]); writeCursor++ }
  const { error } = await svc.from('result').upsert(batch, { onConflict: 'valtyp,valdistriktskod,partikod' })
  if (error) log(`  [skrivfel] ${error.message}`); else writeBatches++
}
// separata loopar: normal 2s, burst 300ms (aktiveras via writeMode)
let normalTimer = null, burstTimer = null

const subs = []
let events = 0, subOk = 0, subErr = 0
async function addSubscribers(n) {
  const start = subs.length
  for (let i = 0; i < n; i++) {
    const c = createClient(URL, ANON, { realtime: { params: { eventsPerSecond: 100 } } })
    c.channel(`lh-${start + i}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'result' }, () => { events++ })
      .subscribe((s) => { if (s === 'SUBSCRIBED') subOk++; else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') subErr++ })
    subs.push(c)
    if (i % 25 === 0) await sleep(150)
  }
}

;(async () => {
  await loadWritePool()
  normalTimer = setInterval(() => { if (writeMode === 'normal') writerTick() }, 2000)
  burstTimer = setInterval(() => { if (writeMode === 'burst') writerTick() }, 300)

  log('=== STEG 1: ramp till 500 subscribers, normal skrivare (60s häll) ===')
  writeMode = 'normal'
  await addSubscribers(500)
  log(`  anslutna hittills: ok=${subOk} err=${subErr}`)
  await sleep(60000)
  log(`  @500: ok=${subOk} err=${subErr} · events=${events} · skrivbatchar=${writeBatches}`)

  log('=== STEG 2: ramp till 1000 subscribers, normal skrivare (60s häll) ===')
  await addSubscribers(500)
  log(`  anslutna hittills: ok=${subOk} err=${subErr}`)
  await sleep(60000)
  log(`  @1000: ok=${subOk} err=${subErr} · events=${events} · skrivbatchar=${writeBatches}`)

  log('=== STEG 3: TUNG SKRIVBURST @1000 subs (~330 rader/s, 45s) ===')
  const evBefore = events, wbBefore = writeBatches
  writeMode = 'burst'
  await sleep(45000)
  writeMode = 'normal'
  log(`  BURST: skrivbatchar +${writeBatches - wbBefore} (~${(writeBatches - wbBefore) * 100} upserts) · events +${events - evBefore}`)

  writeMode = 'off'
  clearInterval(normalTimer); clearInterval(burstTimer)
  log('=== KLART ===')
  log(`SLUTSUMMA: subscribers ok=${subOk}/${subs.length} err=${subErr} · totalt events=${events} · skrivbatchar=${writeBatches}`)
  for (const c of subs) { try { await c.removeAllChannels() } catch { /* noop */ } }
  process.exit(0)
})()
