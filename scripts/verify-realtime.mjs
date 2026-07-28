// Fas 5-acceptans (headless): en simulerad upsert syns i kartan inom sekunder, och
// en burst av upserts reflekteras allihop. Bevisar Realtime→feature-state UTAN att
// service-role någonsin rör webbläsaren: Node upsertar (service-role), sidan tar
// emot över Realtime som anon.
//
//   node --env-file=.env.local scripts/verify-realtime.mjs
// Kräver att dev-servern kör (window.__map är DEV-only) och att
// migrationen 20260728150000 (publikation) är applicerad på remote.
import { chromium } from 'playwright'
import ws from 'ws'
import { createClient } from '@supabase/supabase-js'

globalThis.WebSocket ??= ws

const URL = process.env.VERIFY_URL ?? 'http://localhost:5926/'
const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Saknar VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (kör med --env-file=.env.local).')
  process.exit(1)
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } })

// En färgad (riksdags)partikod + N distrikt som testmål.
const { data: parties } = await db.from('party').select('partikod').not('color', 'is', null).limit(1)
const partikod = parties[0].partikod
const { data: districts } = await db.from('district').select('valdistriktskod').limit(7)
const codes = districts.map((d) => d.valdistriktskod)
const single = codes[0] // RD-only genom hela testet (används även i växlingstestet)
const burst = codes.slice(1, 6) // 5 distrikt för burst-testet
const dRF = codes[6] // får ENDAST RF-resultat (växlingstestet)

// Nollställ målen (alla valtyper) så snapshot vid sidladdning INTE redan har dem
// rapporterade (annars bevisar testet ingenting om realtidsvägen).
await db.from('result').delete().in('valtyp', ['RD', 'RF', 'KF']).in('valdistriktskod', codes)

const upsertVt = (valtyp, vd, roster) =>
  db.from('result').upsert(
    [{ valtyp, valdistriktskod: vd, partikod, roster, status: 'preliminar' }],
    { onConflict: 'valtyp,valdistriktskod,partikod' },
  )
const upsert = (vd, roster) => upsertVt('RD', vd, roster)

const stateOf = (page, vd) =>
  page.evaluate((id) => window.__map?.getFeatureState({ source: 'districts', id }), vd)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.stack ?? e.message))

await page.goto(URL, { waitUntil: 'load', timeout: 60000 })

// Vänta tills (a) kartkällan laddad och (b) Realtime SUBSCRIBED — annars kan
// upserten hamna i gapet före prenumerationen.
await page.waitForFunction(
  () => window.__map?.isSourceLoaded('districts') && window.__realtimeReady === true,
  { timeout: 45000 },
)

let ok = true
const check = (pass, msg) => {
  if (!pass) ok = false
  console.log(`${pass ? 'OK ' : 'FEL'} ${msg}`)
}

// 1) Enkel upsert → feature-state.reported inom N sekunder.
const before = await stateOf(page, single)
check(!before?.reported, `mål ${single} ej rapporterat vid start`)
const t0 = Date.now()
await upsert(single, 1500 + Math.floor(Math.random() * 500))
let ms = null
for (let i = 0; i < 40; i++) {
  const s = await stateOf(page, single)
  if (s?.reported) {
    ms = Date.now() - t0
    break
  }
  await page.waitForTimeout(250)
}
check(ms != null, `realtime→feature-state på ${single}${ms != null ? ` inom ${ms} ms` : ' (timeout 10 s)'}`)

// 2) Burst: 5 upserts i snabb följd → alla reflekterade (rAF-koalescerad repaint).
await Promise.all(burst.map((vd) => upsert(vd, 900 + Math.floor(Math.random() * 500))))
let reflected = 0
for (let i = 0; i < 40; i++) {
  const states = await Promise.all(burst.map((vd) => stateOf(page, vd)))
  reflected = states.filter((s) => s?.reported).length
  if (reflected === burst.length) break
  await page.waitForTimeout(250)
}
check(reflected === burst.length, `burst: ${reflected}/${burst.length} distrikt reflekterade`)

// 3) Valtyp-växling (regressionstest mot feature-state-fällan): RF-resultat på ett
//    distrikt utan RD, växla till Region → RF-distriktet färgas OCH RD-only-
//    distriktet nollställs (annars sitter röd RD-färg kvar = fel).
await upsertVt('RF', dRF, 1200 + Math.floor(Math.random() * 400))
await page.getByRole('button', { name: 'Region' }).click()
await page.waitForFunction(() => window.__valtyp === 'RF', { timeout: 5000 })
let rfReported = false
let rdCleared = false
for (let i = 0; i < 40; i++) {
  const [sRF, sRD] = await Promise.all([stateOf(page, dRF), stateOf(page, single)])
  rfReported = !!sRF?.reported
  rdCleared = !sRD?.reported // RD-only-distrikt ska vara orapporterat i Region-vyn
  if (rfReported && rdCleared) break
  await page.waitForTimeout(250)
}
check(rfReported, `RF-distrikt ${dRF} färgas efter växling till Region`)
check(rdCleared, `RD-only-distrikt ${single} nollställs (grått) i Region-vyn`)

check(errors.length === 0, `inga page-errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)

// Städa testmålen (alla valtyper).
await db.from('result').delete().in('valtyp', ['RD', 'RF', 'KF']).in('valdistriktskod', codes)
await browser.close()
console.log(ok ? '\n✅ FAS 5–6-ACCEPTANS OK' : '\n❌ ACCEPTANS EJ UPPFYLLD')
process.exit(ok ? 0 : 1)
