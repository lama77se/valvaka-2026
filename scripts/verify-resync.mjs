// Verifierar auto-resync-mekanismen (självläkning mot Realtime-släpning) mot den LEVANDE
// genrep-DB:n. Kan inte lätt släppa Realtime-socketen headless, så vi bevisar kärnan direkt via
// DEV-hookarna: spola cursorn bakåt 5 min → framtvinga en delta → resync ska HÄMTA, APPLICERA och
// FLYTTA FRAM cursorn igen, utan att tappa rader. Det är exakt hämta→applicera→cursor-vägen som
// en riktig burst-tapp skulle läkas av.
import { chromium } from 'playwright'

const URL = process.env.VERIFY_URL ?? 'http://localhost:5926/'
const browser = await chromium.launch()
const page = await browser.newContext({ viewport: { width: 1280, height: 900 } }).then((c) => c.newPage())
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))

await page.goto(URL, { waitUntil: 'load', timeout: 60000 })

// Vänta tills RD-snapshoten laddat (cursorn satt).
await page.waitForFunction(() => {
  const r = window.__results
  return r && r.loaded().includes('RD') && r.cursor().RD !== ''
}, { timeout: 30000 })

const before = await page.evaluate(() => ({ cursor: window.__results.cursor().RD, reported: window.__results.reported().RD }))
console.log('Efter snapshot     — cursor:', before.cursor, ' reportedCount RD:', before.reported)

// Spola cursorn 5 min bakåt → garanterar en delta (rader skrivna den senaste stunden).
const rewound = new Date(Date.parse(before.cursor) - 5 * 60000).toISOString()
await page.evaluate((iso) => window.__results.setCursor('RD', iso), rewound)
console.log('Spolar cursor →', rewound, '(−5 min)')

// Kör resync → ska returnera antal genuint nya rader (> 0) och flytta fram cursorn.
const changed = await page.evaluate(() => window.__results.resync('RD'))
const after = await page.evaluate(() => ({ cursor: window.__results.cursor().RD, reported: window.__results.reported().RD }))
console.log('Efter resync       — cursor:', after.cursor, ' reportedCount RD:', after.reported, ' changed:', changed)

// Bevis:
//  1) changed > 0            → deltan hämtades och applicerades
//  2) cursor flyttades fram  → tillbaka till (minst) det den var (5-min-fönstret återläst)
//  3) reported minskade inte → additiv store, inga rader tappade
const advanced = Date.parse(after.cursor) >= Date.parse(before.cursor)
const noLoss = after.reported >= before.reported
const ok = changed > 0 && advanced && noLoss
console.log('')
console.log('changed > 0        :', changed > 0, `(${changed})`)
console.log('cursor framflyttad :', advanced)
console.log('inga rader tappade :', noLoss)
console.log(ok ? '\n✅ RESYNC OK — hämta→applicera→cursor-framflyttning fungerar mot live-DB' : '\n❌ RESYNC MISSLYCKADES')

await browser.close()
process.exit(ok ? 0 : 1)
