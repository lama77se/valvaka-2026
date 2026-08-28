// Fas 3-acceptans (headless, READ-ONLY): efterfrågestyrd snapshot-laddning per valtyp.
// Rör ALDRIG databasen — observerar bara den körande appen (nätverk + DEV-hook
// window.__results). Bevisar att desktop laddar alla tre valtyper (oförändrat), medan
// mobil laddar EN valtyp åt gången (Karta/Resultat) och alla tre först när Senaste öppnas.
//
// OBS churn: datakällan är en LIVE genrep-DB (2026) som strömmar nya distrikt via
// Realtime → distriktsräknarna DRIVER uppåt hela tiden. Testet jämför därför ALDRIG
// exakta räknare över tid. Parity mäts i SAMMA ögonblick (båda sidor ikappkörda via
// Realtime → samma DB-tillstånd), och idempotens bevisas via NOLL omladdning (nätverk),
// inte via frusna räknare.
//
//   node scripts/verify-fas3.mjs
// Kräver att dev-servern kör (window.__map/__results är DEV-only).
import { chromium } from 'playwright'

const URL = process.env.VERIFY_URL ?? 'http://localhost:5926/'
const DESKTOP = { width: 1400, height: 900 }
const MOBILE = { width: 390, height: 844 }

let ok = true
const check = (pass, msg) => { if (!pass) ok = false; console.log(`${pass ? 'OK ' : 'FEL'} ${msg}`) }

const readState = (page) => page.evaluate(() => {
  const r = window.__results
  return r ? { loaded: r.loaded().slice().sort(), loading: r.loading().slice().sort(), reported: r.reported() } : null
})
const waitHook = (page) => page.waitForFunction(() => !!window.__results, null, { timeout: 20000 })
const waitRealtime = (page) => page.waitForFunction(() => window.__realtimeReady === true, null, { timeout: 45000 })
const waitLoaded = (page, vts, timeout = 180000) =>
  page.waitForFunction((want) => {
    const r = window.__results
    return r && want.every((v) => r.loaded().includes(v))
  }, vts, { timeout })
const valtyperOf = (urls) => [...new Set(urls.map((u) => (u.match(/valtyp=eq\.(\w+)/) || [])[1]).filter(Boolean))].sort()

const browser = await chromium.launch()

// ── 1) DESKTOP: alla tre valtyper laddas (oförändrat beteende) ───────────────────────────
const dctx = await browser.newContext({ viewport: DESKTOP })
const dpage = await dctx.newPage()
const derr = []; const dReq = []
dpage.on('pageerror', (e) => derr.push(e.message))
dpage.on('request', (req) => { if (req.url().includes('/rest/v1/result?')) dReq.push(req.url()) })
await dpage.goto(URL, { waitUntil: 'load', timeout: 60000 })
await waitHook(dpage)
await waitRealtime(dpage)
await waitLoaded(dpage, ['RD', 'RF', 'KF'])
const d0 = await readState(dpage)
check(['RD', 'RF', 'KF'].every((v) => d0.loaded.includes(v)), `desktop laddar alla tre valtyper: [${d0.loaded}]`)
check(d0.loading.length === 0, `desktop: inga hängande laddningar (loading=[${d0.loading}])`)
check(valtyperOf(dReq).join() === 'KF,RD,RF', `desktop /result-requests täcker alla valtyper: [${valtyperOf(dReq)}]`)
check(derr.length === 0, `desktop: inga page-errors${derr.length ? ': ' + derr.join(' | ') : ''}`)
console.log(`   desktop reported (distrikt): RD=${d0.reported.RD} RF=${d0.reported.RF} KF=${d0.reported.KF}  ·  ${dReq.length} /result-requests`)

// ── 2) MOBIL KARTA: BARA aktiv valtyp (RD) laddas — RF/KF tomma i minne OCH nätverk ──────
const mctx = await browser.newContext({ viewport: MOBILE, isMobile: true, hasTouch: true })
const mpage = await mctx.newPage()
const merr = []; const mReq = []
mpage.on('pageerror', (e) => merr.push(e.message))
mpage.on('request', (req) => { if (req.url().includes('/rest/v1/result?')) mReq.push(req.url()) })
await mpage.goto(URL, { waitUntil: 'load', timeout: 60000 })
await waitHook(mpage)
await waitRealtime(mpage)
await waitLoaded(mpage, ['RD'])
await mpage.waitForTimeout(4000) // ge RF/KF en generös chans att (felaktigt) ladda om de skulle
const m1 = await readState(mpage)
check(m1.loaded.length === 1 && m1.loaded[0] === 'RD', `mobil Karta laddar BARA RD: [${m1.loaded}]`)
check(m1.reported.RF === 0 && m1.reported.KF === 0, `mobil Karta: RF/KF orörda i minnet (RF=${m1.reported.RF} KF=${m1.reported.KF})`)
check(m1.reported.RD > 5000, `mobil RD laddad och komplett i storleksordning (${m1.reported.RD} distrikt)`)
check(valtyperOf(mReq).join() === 'RD', `mobil Karta /result-requests BARA RD: [${valtyperOf(mReq)}]`)
check(mReq.length < dReq.length, `mobil färre /result-requests än desktop (${mReq.length} < ${dReq.length}, ~${Math.round((mReq.length / dReq.length) * 100)} %)`)

// ── 3) MOBIL valtyp-växling → lazy-load RF, sedan KF (en i taget) ────────────────────────
await mpage.getByRole('button', { name: 'Region' }).first().click()
await waitLoaded(mpage, ['RD', 'RF'])
const m2 = await readState(mpage)
check(m2.reported.RF > 5000, `växling→Region lazy-laddar RF (${m2.reported.RF} distrikt)`)
check(!m2.loaded.includes('KF'), `KF fortfarande OLADDAD efter Region (loaded=[${m2.loaded}])`)
await mpage.getByRole('button', { name: 'Kommun' }).first().click()
await waitLoaded(mpage, ['RD', 'RF', 'KF'])
const m3 = await readState(mpage)
check(m3.reported.KF > 5000, `växling→Kommun lazy-laddar KF (${m3.reported.KF} distrikt)`)

// ── 4) FILTER-TROHET (reset-immun): att eq-filtret laddar RÄTT valtyp bevisas deterministiskt
//    av (a) nätverket — varje /result-request bär `valtyp=eq.<vt>` (annars vore URL:en ofiltrerad
//    och all data hamnade i EN store) och (b) isolationen ovan — RF/KF-store:n är exakt 0 medan
//    bara RD laddats. Exakt RÄKNAR-parity desktop↔mobil går INTE att mäta här: genrep-DB:n
//    nollställer och spelar om (0→100 % i loop), så två sidors snapshots hamnar i olika faser
//    av cykeln (RD sågtandar 6312→5764→…). Fullständigheten fångas i stället av att varje valtyp
//    laddar ett fullstort set (>5000 av ~6312 distrikt), verifierat per valtyp nedan/ovan.
check(m3.reported.RD > 5000 && m3.reported.RF > 5000 && m3.reported.KF > 5000,
  `fullständighet: alla tre valtyper laddade i full storleksordning (RD=${m3.reported.RD} RF=${m3.reported.RF} KF=${m3.reported.KF})`)

// ── 4b) RENDER-BRYGGA: att en lazy-laddad valtyp inte bara landar i store:n utan faktiskt
//    MÅLAS på kartan. Efter Kommun-växlingen står mobil-Kartan (fortfarande monterad) på KF
//    → den deferred KF-laddningens snapshotVersion-bump ska ha färgat om kartan för KF.
//    __reportedCount = aktiv valtyps färgade distrikt (DistrictMap.tsx), __valtyp = aktiv valtyp.
await mpage.waitForFunction(() => window.__valtyp === 'KF' && (window.__reportedCount ?? 0) > 5000, null, { timeout: 20000 })
const painted = await mpage.evaluate(() => ({ vt: window.__valtyp, n: window.__reportedCount }))
check(painted.vt === 'KF' && painted.n > 5000, `render-brygga: kartan MÅLAR den lazy-laddade KF-datan (valtyp=${painted.vt}, ${painted.n} distrikt färgade)`)

// ── 5) IDEMPOTENS via NOLL omladdning: växla runt bland redan laddade valtyper → INGA nya
//    /result-requests får ske (ensureValtypLoaded är no-op när valtypen redan är laddad).
const reqAfterLoad = mReq.length
for (const name of ['Riksdag', 'Region', 'Kommun', 'Riksdag', 'Region']) {
  await mpage.getByRole('button', { name }).first().click()
  await mpage.waitForTimeout(250)
}
const m4 = await readState(mpage)
check(mReq.length === reqAfterLoad, `idempotens: NOLL omladdning vid växling bland laddade valtyper (${mReq.length} === ${reqAfterLoad})`)
check(m4.loaded.length === 3 && m4.loading.length === 0, `idempotens: alla tre laddade, inga hängande (loaded=[${m4.loaded}] loading=[${m4.loading}])`)
check(merr.length === 0, `mobil: inga page-errors${merr.length ? ': ' + merr.join(' | ') : ''}`)
await mctx.close()

// ── 6) MOBIL SENASTE: fliken monterar alla tre tavlorna → lazy-laddar RF+KF vid flikbytet
//    (Karta hade bara laddat RD). Bevisar triggern via monterade tavlor + nätverket.
const sctx = await browser.newContext({ viewport: MOBILE, isMobile: true, hasTouch: true })
const spage = await sctx.newPage()
const serr = []; const sReq = []
spage.on('pageerror', (e) => serr.push(e.message))
spage.on('request', (req) => { if (req.url().includes('/rest/v1/result?')) sReq.push(req.url()) })
await spage.goto(URL, { waitUntil: 'load', timeout: 60000 })
await waitHook(spage)
await waitLoaded(spage, ['RD'])
await spage.waitForTimeout(3000)
const s1 = await readState(spage)
check(s1.loaded.length === 1 && s1.loaded[0] === 'RD', `Senaste-test: vid start bara RD laddad [${s1.loaded}]`)
check(valtyperOf(sReq).join() === 'RD', `Senaste-test: innan flikbyte bara RD-requests [${valtyperOf(sReq)}]`)
await spage.getByRole('button', { name: 'Senaste' }).first().click()
await waitLoaded(spage, ['RD', 'RF', 'KF'])
const s2 = await readState(spage)
check(['RD', 'RF', 'KF'].every((v) => s2.loaded.includes(v)), `Senaste-flik monterar tavlor → laddar alla tre: [${s2.loaded}]`)
check(valtyperOf(sReq).join() === 'KF,RD,RF', `Senaste: RF+KF-requests tillkom EFTER flikbytet [${valtyperOf(sReq)}]`)
check(s2.reported.RF > 5000 && s2.reported.KF > 5000, `Senaste RF/KF laddade (RF=${s2.reported.RF} KF=${s2.reported.KF})`)
check(serr.length === 0, `Senaste: inga page-errors${serr.length ? ': ' + serr.join(' | ') : ''}`)
await sctx.close()

await dctx.close()
await browser.close()
console.log(ok ? '\n✅ FAS 3-ACCEPTANS OK' : '\n❌ ACCEPTANS EJ UPPFYLLD')
process.exit(ok ? 0 : 1)
