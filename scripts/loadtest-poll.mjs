// LASTTEST I DAGENS POLLING-FORMAT (ersätter Realtime-era-testen loadtest-clients/-heavy/-valnatt).
//
// Simulerar N samtidiga flikar EXAKT som ResultsProvider gör det:
//   mount  → keyset-snapshot av result per valtyp (10k/sida, .gte(vd)+.or(...)) + turnout-keyset
//            + uppsamling (offset) + dataset_meta — alla flikar i ett steg monterar inom --herd-window s
//            (= "alla öppnar 20:00"-herden)
//   poll   → var 45–90 s (jittrat): result-delta (updated_at >= cursor − 30 s) + turnout-delta
//            + uppsamling-omladdning + dataset_meta, per laddad valtyp
// Stegar upp antalet flikar (--steps) och håller varje nivå --hold s. Skriver väggtids-stämplar per
// steg så CPU-grafen i Supabase-dashboarden kan korreleras. KLIENT-VÄGGTID ÄR INTE SERVER-CPU —
// godkänt = CPU i dashboarden håller marginal och återhämtar sig (runbook: "Skala till Large").
//
// Skrivaren (--writer N) är OPT-IN: ändrar `roster` ±1 på N roterande RD-rader var --writer-interval s
// (alternerande, nettodrift 0, återställs vid avslut) så det finns ÄKTA deltan att polla — sedan den
// villkorliga bumpen (PR B) ger oförändrade upsertar inga deltan alls. Rör genrep-testdata; kör inte
// med --writer efter N1 på valnatten.
//
//   node --env-file=.env.local scripts/loadtest-poll.mjs
//   node --env-file=.env.local scripts/loadtest-poll.mjs --steps 50,150,300 --hold 120 --valtyper RD,RF,KF
//   node --env-file=.env.local scripts/loadtest-poll.mjs --steps 300 --hold 180 --writer 500
//
// Flaggor: --steps 50,150,300 · --hold 90 · --herd-window 10 · --valtyper RD,RF,KF (desktop; mobil = RD)
//          --poll-min 45 · --poll-max 90 · --writer 0 · --writer-interval 10
import ws from 'ws'
import { createClient } from '@supabase/supabase-js'
globalThis.WebSocket ??= ws

const URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !ANON) { console.error('Saknar VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (kör med --env-file=.env.local).'); process.exit(1) }

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d }
const STEPS = arg('--steps', '50,150,300').split(',').map(Number)
const HOLD_MS = Number(arg('--hold', '90')) * 1000
const HERD_MS = Number(arg('--herd-window', '10')) * 1000
const VALTYPER = arg('--valtyper', 'RD,RF,KF').split(',')
const POLL_MIN = Number(arg('--poll-min', '45')) * 1000
const POLL_MAX = Number(arg('--poll-max', '90')) * 1000
const WRITER_N = Number(arg('--writer', '0'))
const WRITER_MS = Number(arg('--writer-interval', '10')) * 1000
const PAGE = 10000
const OVERLAP_MS = 30_000
const EPOCH = '1970-01-01T00:00:00Z'

const ts = () => new Date().toISOString().slice(11, 19)
const log = (m) => console.log(`[${ts()}] ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const fmt = (arr) => `p50 ${pct(arr, 0.5)} · p95 ${pct(arr, 0.95)} · max ${pct(arr, 1)} ms (n=${arr.length})`

// Samma request-timeout som klienten (src/lib/supabase.ts).
const fetchWithTimeout = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) })
const newTab = () => createClient(URL, ANON, { auth: { persistSession: false }, global: { fetch: fetchWithTimeout } })

// ---- mätvärden -------------------------------------------------------------------------------
const M = { snapshot: [], delta: [], poll: [], errors: new Map(), rows: 0, req: 0 }
const err = (e) => { const k = `${e?.code ?? '?'} ${String(e?.message ?? e).slice(0, 60)}`; M.errors.set(k, (M.errors.get(k) ?? 0) + 1) }
const resetStep = () => { M.snapshot = []; M.delta = []; M.poll = []; M.errors = new Map(); M.rows = 0; M.req = 0 }
const report = (label) => {
  log(`── ${label}`)
  log(`   snapshot/valtyp: ${fmt(M.snapshot)}`)
  log(`   delta/valtyp:    ${fmt(M.delta)}`)
  log(`   poll-varv/flik:  ${fmt(M.poll)}`)
  log(`   requests: ${M.req} · rader: ${M.rows.toLocaleString('sv-SE')} · fel: ${[...M.errors].map(([k, v]) => `${v}× ${k}`).join(' | ') || 'inga'}`)
}

// ---- en simulerad flik --------------------------------------------------------------------------
class Tab {
  constructor(id) { this.id = id; this.db = newTab(); this.cursor = {}; this.tCursor = {}; this.overlap = {}; this.tOverlap = {}; this.alive = true; this.timer = null }

  async snapshot(vt) {
    const t0 = Date.now()
    let lastVd = '', lastPk = '', cursor = EPOCH
    for (;;) {
      let q = this.db.from('result').select('valtyp,valdistriktskod,partikod,roster,status,rapporteringstid,updated_at')
        .eq('valtyp', vt).order('valdistriktskod').order('partikod').limit(PAGE)
      if (lastVd !== '') q = q.gte('valdistriktskod', lastVd).or(`valdistriktskod.gt.${lastVd},and(valdistriktskod.eq.${lastVd},partikod.gt.${lastPk})`)
      const { data, error } = await q; M.req++
      if (error) { err(error); return false }
      if (!data?.length) break
      M.rows += data.length
      for (const r of data) if (r.updated_at > cursor) cursor = r.updated_at
      lastVd = data[data.length - 1].valdistriktskod; lastPk = data[data.length - 1].partikod
    }
    this.cursor[vt] = cursor
    // turnout-keyset (best-effort som i klienten)
    let tLast = '', tCursor = EPOCH
    for (;;) {
      let tq = this.db.from('turnout').select('valdistriktskod,totalt_antal_roster,antal_rostberattigade,updated_at').eq('valtyp', vt).order('valdistriktskod').limit(PAGE)
      if (tLast !== '') tq = tq.gt('valdistriktskod', tLast)
      const { data, error } = await tq; M.req++
      if (error) { err(error); break }
      if (!data?.length) break
      M.rows += data.length
      for (const r of data) if (r.updated_at > tCursor) tCursor = r.updated_at
      tLast = data[data.length - 1].valdistriktskod
    }
    this.tCursor[vt] = tCursor
    this.overlap[vt] = true; this.tOverlap[vt] = true // som klienten: första deltan efter snapshot överlappar
    M.snapshot.push(Date.now() - t0)
    return true
  }

  async uppsamling() {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db.from('uppsamling_result').select('valtyp,kommunkod,lankod,partikod,roster')
        .order('valtyp').order('kod').order('partikod').range(from, from + PAGE - 1); M.req++
      if (error) { err(error); return }
      if (!data?.length) break
      M.rows += data.length
      if (data.length < PAGE) break
    }
  }

  async meta() { const { error } = await this.db.from('dataset_meta').select('*').eq('id', 1).maybeSingle(); M.req++; if (error) err(error) }

  async delta(vt) {
    const t0 = Date.now()
    const cursor = this.cursor[vt]
    // Överlappsfönstret bara i pollen direkt efter att cursorn flyttats (speglar overlapPendingRef).
    const since = this.overlap[vt] ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : cursor
    let from = 0, maxTs = cursor
    for (;;) {
      const { data, error } = await this.db.from('result').select('valdistriktskod,partikod,roster,status,rapporteringstid,updated_at')
        .eq('valtyp', vt).gte('updated_at', since).order('updated_at').order('valdistriktskod').order('partikod').range(from, from + PAGE - 1); M.req++
      if (error) { err(error); break }
      if (!data?.length) break
      M.rows += data.length
      for (const r of data) if (r.updated_at > maxTs) maxTs = r.updated_at
      from += data.length
      if (data.length < PAGE) break
    }
    this.overlap[vt] = maxTs > cursor
    this.cursor[vt] = maxTs
    const tCursor = this.tCursor[vt]
    const tSince = this.tOverlap[vt] ? new Date(Date.parse(tCursor) - OVERLAP_MS).toISOString() : tCursor
    const { data: td, error: te } = await this.db.from('turnout').select('valdistriktskod,totalt_antal_roster,antal_rostberattigade,updated_at')
      .eq('valtyp', vt).gte('updated_at', tSince).order('updated_at').order('valdistriktskod').range(0, PAGE - 1); M.req++
    if (te) err(te); else { M.rows += td?.length ?? 0; for (const r of td ?? []) if (r.updated_at > this.tCursor[vt]) this.tCursor[vt] = r.updated_at }
    this.tOverlap[vt] = this.tCursor[vt] > tCursor
    M.delta.push(Date.now() - t0)
  }

  async mount() {
    await Promise.all([...VALTYPER.map((vt) => this.snapshot(vt)), this.uppsamling(), this.meta()])
    this.schedule()
  }

  schedule() {
    if (!this.alive) return
    this.timer = setTimeout(async () => {
      if (!this.alive) return
      const t0 = Date.now()
      await Promise.all([...VALTYPER.filter((vt) => this.cursor[vt]).map((vt) => this.delta(vt)), this.uppsamling(), this.meta()])
      M.poll.push(Date.now() - t0)
      this.schedule()
    }, POLL_MIN + Math.random() * (POLL_MAX - POLL_MIN))
  }

  stop() { this.alive = false; if (this.timer) clearTimeout(this.timer) }
}

// ---- skrivare (opt-in) ------------------------------------------------------------------------
let writerTimer = null, writerSign = 1, writePool = [], writeBatches = 0
async function startWriter() {
  if (!WRITER_N) return
  if (!SVC) { log('⚠️ --writer kräver SUPABASE_SERVICE_ROLE_KEY — hoppar skrivaren'); return }
  const svc = createClient(URL, SVC, { auth: { persistSession: false } })
  const { data } = await svc.from('result').select('valtyp,valdistriktskod,partikod,roster,status').eq('valtyp', 'RD').eq('status', 'preliminar').order('valdistriktskod').order('partikod').limit(WRITER_N)
  writePool = data ?? []
  log(`skrivare: ${writePool.length} preliminära RD-rader, roster ±1 var ${WRITER_MS / 1000}:e s (nettodrift 0)`)
  writerTimer = setInterval(async () => {
    const batch = writePool.map((r) => ({ ...r, roster: r.roster + writerSign }))
    const { error } = await svc.from('result').upsert(batch, { onConflict: 'valtyp,valdistriktskod,partikod' })
    if (error) log(`  [skrivfel] ${error.message}`); else { writeBatches++; writerSign = -writerSign }
  }, WRITER_MS)
  process.on('exit', () => { /* återställning sker i stopWriter */ })
}
async function stopWriter() {
  if (!writerTimer) return
  clearInterval(writerTimer)
  const svc = createClient(URL, SVC, { auth: { persistSession: false } })
  const { error } = await svc.from('result').upsert(writePool, { onConflict: 'valtyp,valdistriktskod,partikod' }) // ursprungsvärden
  log(`skrivare stoppad: ${writeBatches} batchar · återställning ${error ? 'MISSLYCKADES: ' + error.message : 'ok'}`)
}

// ---- körning ---------------------------------------------------------------------------------
const tabs = []
log(`loadtest-poll: steg ${STEPS.join(' → ')} flikar · håll ${HOLD_MS / 1000}s · herd-fönster ${HERD_MS / 1000}s · valtyper ${VALTYPER.join(',')} · poll ${POLL_MIN / 1000}–${POLL_MAX / 1000}s${WRITER_N ? ` · skrivare ${WRITER_N}` : ''}`)
await startWriter()
let stop = false
process.on('SIGINT', () => { stop = true })

for (const target of STEPS) {
  if (stop) break
  const add = target - tabs.length
  if (add <= 0) continue
  resetStep()
  log(`=== STEG → ${target} flikar: monterar +${add} inom ${HERD_MS / 1000}s (herd) ===`)
  const t0 = Date.now()
  const mounts = []
  for (let i = 0; i < add; i++) {
    const tab = new Tab(tabs.length)
    tabs.push(tab)
    mounts.push(sleep(Math.random() * HERD_MS).then(() => tab.mount()))
  }
  await Promise.all(mounts)
  log(`   herd klar på ${((Date.now() - t0) / 1000).toFixed(1)}s väggtid`)
  report(`HERD @${target}`)
  resetStep()
  log(`   håller ${HOLD_MS / 1000}s med pollning …`)
  await sleep(HOLD_MS)
  report(`POLL @${target} (${HOLD_MS / 1000}s)`)
}

log('=== KLART — stoppar flikar ===')
for (const t of tabs) t.stop()
await stopWriter()
process.exit(0)
