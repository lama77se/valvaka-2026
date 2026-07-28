// Engångs-diagnostik: hovra ett rutnät av distrikt och läs info-rutan DIREKT
// (300 ms) — verifierar att jamforbarhet syns synkront utan flicker.
import { chromium } from 'playwright'

const URL = process.env.VERIFY_URL ?? 'http://localhost:5926/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(4000) // karta + district_comparison-förladdning

// Rutnät av canvas-punkter över Sverige-vyn.
const points = []
for (let x = 300; x <= 760; x += 60) for (let y = 80; y <= 820; y += 60) points.push([x, y])

let hits = 0
let withJamf = 0
const empties = []
for (const [x, y] of points) {
  await page.mouse.move(x, y)
  await page.mouse.move(x + 1, y + 1)
  await page.waitForTimeout(300)
  const info = await page.evaluate(() => {
    const box = document.querySelector('.absolute.bottom-4.left-4')
    if (!box) return null
    const kod = box.querySelector('.font-mono')?.textContent ?? ''
    const jamf = box.querySelector('.text-sky-300')?.textContent ?? ''
    return { kod, jamf }
  })
  if (!info?.kod) continue
  hits++
  if (info.jamf) withJamf++
  else empties.push(info.kod)
}
console.log(`hovrade distrikt (unika träffar): ${hits}`)
console.log(`med jamforbarhet direkt: ${withJamf}`)
console.log(`tomma (300 ms): ${empties.length}`, empties.slice(0, 10))
await browser.close()
