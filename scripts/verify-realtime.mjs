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
const { data: districts } = await db.from('district').select('valdistriktskod').limit(8)
const codes = districts.map((d) => d.valdistriktskod)
const single = codes[0] // RD-only genom hela testet (används även i växlingstestet)
const burst = codes.slice(1, 6) // 5 distrikt för burst-testet
const dRF = codes[6] // får ENDAST RF-resultat (växlingstestet)
const dPanel = codes[7] // RD-only, används bara för panel-liveness-testet

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

// 2.5) Panel-tabellen går live via DELAD state: en Realtime-upsert höjer distrikt-
//      räknaren i resultattabellen (höger panel), inte bara kartan. Bevisar att
//      ResultsProvider→revision→ResultTable-vägen fungerar (kartan mäts via __map).
const panelReported = async () => {
  const txt = await page
    .locator('aside')
    .getByText(/distrikt räknade/)
    .first()
    .textContent()
    .catch(() => null)
  const m = txt?.match(/([\d \s.]+?)\s*av/)
  return m ? Number(m[1].replace(/\D/g, '')) : null
}
// Vänta tills snapshot-laddningen stabiliserats (två lika läsningar i rad) så att
// ökningen nedan otvetydigt kommer från Realtime-upserten, inte från snapshot.
let prevPanel = await panelReported()
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(400)
  const now = await panelReported()
  if (now != null && now === prevPanel) break
  prevPanel = now
}
const bPre = prevPanel ?? 0
await upsert(dPanel, 1300 + Math.floor(Math.random() * 400))
let panelLive = false
for (let i = 0; i < 40; i++) {
  const now = await panelReported()
  if (now != null && now > bPre) {
    panelLive = true
    break
  }
  await page.waitForTimeout(250)
}
check(panelLive, `panel-tabellen räknar upp distrikt vid Realtime-upsert (${bPre} → >${bPre})`)

// 2.6) Delad selectedArea driver panelen: välj en kommun i panel-dropdownen och
//      verifiera att tabellrubriken byter till kommunens namn. Kartklick→drilldown
//      går samma väg (setSelectedArea) — själva canvas-klicket testas ej headless.
const { data: krow } = await db.from('district').select('kommun').eq('valdistriktskod', dPanel).single()
const kommunKod = dPanel.slice(0, 4)
const kommunNamn = krow?.kommun || kommunKod
await page.locator('aside select').selectOption(`k:${kommunKod}`)
let titleFlipped = false
for (let i = 0; i < 20; i++) {
  const title = await page.locator('aside h2').first().textContent().catch(() => null)
  if (title?.includes(kommunNamn)) {
    titleFlipped = true
    break
  }
  await page.waitForTimeout(150)
}
check(titleFlipped, `panel-dropdown → delad selectedArea → rubrik byter till "${kommunNamn}"`)

// 3) Valtyp-växling (regressionstest mot feature-state-fällan): RF-resultat på ett
//    distrikt utan RD, växla till Region → RF-distriktet färgas OCH RD-only-
//    distriktet nollställs (annars sitter röd RD-färg kvar = fel).
await upsertVt('RF', dRF, 1200 + Math.floor(Math.random() * 400))
await page.getByRole('button', { name: 'Region' }).first().click()
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
