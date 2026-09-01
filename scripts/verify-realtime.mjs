// Acceptans (headless): en simulerad upsert syns i kartan + panelen efter en resync, och
// en burst av upserts reflekteras allihop. Bevisar upsert→poll→feature-state UTAN att
// service-role någonsin rör webbläsaren: Node upsertar (service-role), klienten hämtar
// deltan via sin resync (poll) som anon.
//
// OBS: Realtime togs bort 1 sep 2026 → klienten pollar var 45–90 s. För ett deterministiskt
// test forcerar vi resyncen direkt via DEV-hooken `window.__results.resync(vt)` i stället för
// att vänta på pollintervallet.
//
//   node --env-file=.env.local scripts/verify-realtime.mjs
// Kräver att dev-servern kör (window.__map + window.__results är DEV-only).
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
// KF Stockholm (0180) töms FÖRE sidladdning så klientens snapshot saknar 2026 där
// → 2022-baslägets union-sådd testas (partirader ska visas trots 0 inrapporterat).
await db.from('result').delete().eq('valtyp', 'KF').like('valdistriktskod', '0180%')

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

// Vänta tills (a) kartkällan laddad och (b) första RD-snapshoten klar (så resync-cursorn
// är satt — annars ser resyncen inget delta).
await page.waitForFunction(
  () => window.__map?.isSourceLoaded('districts') && window.__results?.loaded?.().includes('RD'),
  { timeout: 45000 },
)
// Forcera klientens resync (poll) i st f att vänta på 45–90 s-intervallet, så upserts
// reflekteras direkt. page.evaluate väntar in resync-promiset; kort paus för rAF/paint.
const forceSync = async (vt) => { await page.evaluate((v) => window.__results?.resync(v), vt); await page.waitForTimeout(250) }

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
await forceSync('RD')
let ms = null
for (let i = 0; i < 40; i++) {
  const s = await stateOf(page, single)
  if (s?.reported) {
    ms = Date.now() - t0
    break
  }
  await page.waitForTimeout(250)
}
check(ms != null, `poll→feature-state på ${single}${ms != null ? ` inom ${ms} ms` : ' (timeout 10 s)'}`)

// 2) Burst: 5 upserts i snabb följd → alla reflekterade (rAF-koalescerad repaint efter resync).
await Promise.all(burst.map((vd) => upsert(vd, 900 + Math.floor(Math.random() * 500))))
await forceSync('RD')
let reflected = 0
for (let i = 0; i < 40; i++) {
  const states = await Promise.all(burst.map((vd) => stateOf(page, vd)))
  reflected = states.filter((s) => s?.reported).length
  if (reflected === burst.length) break
  await page.waitForTimeout(250)
}
check(reflected === burst.length, `burst: ${reflected}/${burst.length} distrikt reflekterade`)

// 2.5) Panel-tabellen går live via DELAD state: en upsert (via poll/resync) höjer distrikt-
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
// ökningen nedan otvetydigt kommer från upserten (via forceSync/poll), inte från snapshot.
let prevPanel = await panelReported()
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(400)
  const now = await panelReported()
  if (now != null && now === prevPanel) break
  prevPanel = now
}
const bPre = prevPanel ?? 0
await upsert(dPanel, 1300 + Math.floor(Math.random() * 400))
await forceSync('RD')
let panelLive = false
for (let i = 0; i < 40; i++) {
  const now = await panelReported()
  if (now != null && now > bPre) {
    panelLive = true
    break
  }
  await page.waitForTimeout(250)
}
check(panelLive, `panel-tabellen räknar upp distrikt vid upsert+poll (${bPre} → >${bPre})`)

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
await page.waitForFunction(() => window.__results?.loaded?.().includes('RF'), { timeout: 10000 }).catch(() => {})
await forceSync('RF')
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

// 4) 2022 alltid synligt: KF Stockholm (0180) saknar 2026-röster → tabellen ska
//    ändå visa partirader ur 2022 års facit (union-sådd innan 2026 kommit in).
await page.getByRole('button', { name: 'Kommun' }).first().click()
await page.waitForFunction(() => window.__valtyp === 'KF', { timeout: 5000 })
await page.locator('aside select').selectOption('k:0180')
let baseline2022 = 0
for (let i = 0; i < 20; i++) {
  baseline2022 = await page.locator('aside tbody tr span.rounded-sm').count() // en färgprick = en partirad
  if (baseline2022 >= 1) break
  await page.waitForTimeout(150)
}
check(baseline2022 >= 1, `KF Stockholm utan 2026-röster visar ändå 2022 års resultat (${baseline2022} partirader)`)

// 5) Kartklick på ett distrikt → tabellen visar DET distriktet (minsta kartdelen =
//    minsta tabellnivån), med 2022-kolumnerna ifyllda ur district_result_2022
//    (DB-lookup). Klickar punkter över södra Sverige tills ett JÄMFÖRBART (JA/FLERA)
//    distrikt träffas, så 2022 faktiskt ska visas.
let dCode = null
for (const [x, y] of [[560, 760], [520, 700], [600, 660], [500, 800], [620, 720], [540, 640], [580, 720]]) {
  await page.mouse.click(x, y)
  await page.waitForTimeout(250)
  const val = await page.locator('aside select').inputValue()
  if (!val.startsWith('d:')) continue
  const code = val.slice(2)
  const { data: jc } = await db.from('district_comparison').select('jamforbarhet').eq('valdistriktskod', code).single()
  if (jc && (jc.jamforbarhet === 'JA' || jc.jamforbarhet === 'FLERA')) {
    dCode = code
    break
  }
}
check(!!dCode, `kartklick → jämförbart distrikt valt i tabellen (d:${dCode ?? 'ingen träff'})`)
// 2022-andel (kolumn 4) i första partiraden ska visa ett %-värde, inte "–".
let has2022cell = false
for (let i = 0; i < 20 && dCode; i++) {
  const txt = await page.locator('aside tbody tr').first().locator('td').nth(3).textContent().catch(() => null)
  if (txt && txt.includes('%')) {
    has2022cell = true
    break
  }
  await page.waitForTimeout(200)
}
check(has2022cell, 'distriktets 2022-andel visas i tabellen (DB-lookup fyller 2022-kolumnen)')

check(errors.length === 0, `inga page-errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)

// Städa testmålen (alla valtyper).
await db.from('result').delete().in('valtyp', ['RD', 'RF', 'KF']).in('valdistriktskod', codes)
await browser.close()
console.log(ok ? '\n✅ FAS 5–6-ACCEPTANS OK' : '\n❌ ACCEPTANS EJ UPPFYLLD')
process.exit(ok ? 0 : 1)
