// Genererar public/district-bounds.json ur den reprojicerade distriktsgeometrin:
// { valdistriktskod: [minLng, minLat, maxLng, maxLat] } (WGS84). Litet derivat
// (~6 300 rader × 4 tal) som klienten laddar för att kunna `fitBounds` på ett
// valt område (län/valkrets/kommun/distrikt) utan att hålla hela geometrin i JS.
//
// Körs fristående (`npm run bounds`) mot en redan byggd geojson, och anropas även
// i slutet av build-geometry.mjs så pipelinen håller filen aktuell.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ID_PROP = 'Valdistriktskod' // samma som DISTRICT_ID_PROPERTY i src/lib/geometry.ts

// Utöka [minLng,minLat,maxLng,maxLat] med varje [lng,lat] i en godtyckligt nästlad
// coordinates-struktur (Point/LineString/Polygon/MultiPolygon).
function extend(box, coords) {
  if (typeof coords[0] === 'number') {
    const [lng, lat] = coords
    if (lng < box[0]) box[0] = lng
    if (lat < box[1]) box[1] = lat
    if (lng > box[2]) box[2] = lng
    if (lat > box[3]) box[3] = lat
    return
  }
  for (const c of coords) extend(box, c)
}

export function buildDistrictBounds(
  geojsonPath = 'public/valdistrikt-2026-wgs84.geojson',
  outPath = 'public/district-bounds.json',
) {
  const fc = JSON.parse(readFileSync(geojsonPath, 'utf8'))
  const out = {}
  let n = 0
  for (const f of fc.features) {
    const kod = f.properties?.[ID_PROP]
    const g = f.geometry
    if (!kod || !g?.coordinates) continue
    const box = [Infinity, Infinity, -Infinity, -Infinity]
    extend(box, g.coordinates)
    if (!Number.isFinite(box[0])) continue
    // Avrunda till 5 decimaler (~1 m) — filen blir mindre, precisionen räcker för fitBounds.
    out[kod] = box.map((v) => Math.round(v * 1e5) / 1e5)
    n++
  }
  writeFileSync(outPath, JSON.stringify(out))
  return n
}

// Direkt körning: node scripts/build-district-bounds.mjs [geojson] [out]
// (pathToFileURL → funkar även på Windows där argv[1] har backslashes)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const n = buildDistrictBounds(process.argv[2], process.argv[3])
  console.log(`[district-bounds] skrev ${n} distrikt-bboxar → public/district-bounds.json`)
}
