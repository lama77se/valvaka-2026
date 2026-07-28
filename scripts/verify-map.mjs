// Engångs-diagnostik (Fas 1): rendera kartan headless och rapportera vad som
// faktiskt händer i webbläsaren. Körs mot dev-servern på 5926.
import { chromium } from 'playwright'

const URL = process.env.VERIFY_URL ?? 'http://localhost:5926/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
page.on('requestfailed', (r) =>
  logs.push(`[reqfail] ${r.url()} :: ${r.failure()?.errorText}`),
)
page.on('response', (r) => {
  const u = r.url()
  if (u.includes('.geojson') || u.includes('worker'))
    logs.push(`[resp ${r.status()}] ${u}`)
})

await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
// Ge maplibre tid att hämta (ev. remote) GeoJSON, parsa i workern och rendera.
await page.waitForTimeout(30000)

const report = await page.evaluate(async () => {
  // Direkt fetch-probe från sidans huvudtråd mot Supabase (isolerar worker vs page).
  const probeUrl =
    'https://emtjnmyberugrkdplnsh.supabase.co/storage/v1/object/public/geometry/valdistrikt-2026-wgs84.geojson'
  const probe = {}
  try {
    const t0 = performance.now()
    const r = await fetch(probeUrl)
    const buf = await r.arrayBuffer()
    probe.status = r.status
    probe.bytes = buf.byteLength
    probe.ms = Math.round(performance.now() - t0)
  } catch (e) {
    probe.error = String(e)
  }

  const m = window.__map
  const container = document.querySelector('.maplibregl-map')
  const canvas = document.querySelector('.maplibregl-canvas')
  const out = {
    probe,
    mapExists: !!m,
    containerSize: container
      ? { w: container.clientWidth, h: container.clientHeight }
      : null,
    canvasSize: canvas ? { w: canvas.clientWidth, h: canvas.clientHeight } : null,
  }
  if (m) {
    out.loaded = m.loaded()
    out.layers = m.getStyle().layers.map((l) => l.id)
    // Fånga nästa error- eller sourcedata-händelse (max 8 s) för att se om källan
    // faktiskt kastar ett fel i workern.
    out.event = await new Promise((resolve) => {
      const to = setTimeout(() => resolve('timeout (still pending)'), 8000)
      m.on('error', (e) => {
        clearTimeout(to)
        resolve('error: ' + (e?.error?.message ?? JSON.stringify(e?.error) ?? 'unknown'))
      })
      m.on('sourcedata', (e) => {
        if (e.sourceId === 'districts' && e.isSourceLoaded) {
          clearTimeout(to)
          resolve('sourcedata: districts loaded')
        }
      })
    })
    try {
      out.sourceLoaded = m.isSourceLoaded('districts')
    } catch (e) {
      out.sourceLoaded = 'err: ' + e.message
    }
    try {
      out.renderedDistricts = m.queryRenderedFeatures({
        layers: ['district-fill'],
      }).length
    } catch (e) {
      out.renderedDistricts = 'err: ' + e.message
    }
  }
  return out
})

console.log('=== CONSOLE / ERRORS ===')
console.log(logs.length ? logs.join('\n') : '(none)')
console.log('\n=== MAP REPORT ===')
console.log(JSON.stringify(report, null, 2))

// Hover-DB-proof (Fas 2): hovra ett känt distrikt, vänta på Supabase-uppslaget,
// läs jamforbarhet-raden i info-rutan. Kräver __map (dev-bygget).
if (report.mapExists) {
  const px = await page.evaluate(() =>
    (({ x, y }) => ({ x: Math.round(x), y: Math.round(y) }))(
      window.__map.project([18.0686, 59.3293]), // Stockholm
    ),
  )
  await page.mouse.move(px.x, px.y)
  await page.mouse.move(px.x + 3, px.y + 3)
  await page.waitForTimeout(2500)
  const proof = await page.evaluate(() => {
    const el = document.querySelector('.text-sky-300')
    return el ? el.textContent : null
  })
  console.log('\n=== HOVER DB-PROOF (info-ruta jamforbarhet) ===')
  console.log(proof ?? '(ingen jamforbarhet-rad — hover träffade inget distrikt?)')
}

await page.screenshot({ path: 'scripts/map-shot.png', fullPage: false })
console.log('\nScreenshot: scripts/map-shot.png')
await browser.close()
