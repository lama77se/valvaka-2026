// Regenererar distriktsgeometrin från källan (Fas 1) — reproducerbart, cross-platform.
//
//   node scripts/build-geometry.mjs
//   (eller: npm run geometry)
//
// Kedja: ladda ner zip från val.se -> packa upp GeoJSON -> reprojicera SWEREF99 TM
// (EPSG:3006) -> WGS84 (EPSG:4326) + förenkla (mapshaper) -> skriv public/-artefakten.
// Acceptansgrind inbyggd: antalet distrikt MÅSTE bevaras (annars kastas fel).
//
// OBS: filen committas aldrig (gitignore: *.geojson). Efter regenerering måste den
// laddas upp till Supabase Storage-bucketen `geometry` för att produktionen ska få
// den nya versionen (prod läser via VITE_GEOMETRY_URL, inte från public/).
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { unzipSync } from 'fflate'
import mapshaper from 'mapshaper'
import { buildDistrictBounds } from './build-district-bounds.mjs'

// CMS-länk från råvaru-sidan. Byt om den 404:ar (Optimizely-id/ts kan rotera):
// https://www.val.se/valresultat-och-statistik/statistik-och-data/radata-val-2026
const SOURCE_URL =
  process.env.GEOMETRY_SOURCE_URL ??
  'https://www.val.se/download/18.332cf48819bd61ac1513889/1779801290842/valdistrikt-riket-2026.zip'

const RAW_DIR = 'data/raw'
const RAW_GEOJSON = `${RAW_DIR}/valdistrikt-riket-2026.geojson`
const OUT = 'public/valdistrikt-2026-wgs84.geojson'

// Sverige i SWEREF99 TM (meter) resp. WGS84 (grader) — sanity-gränser för att
// upptäcka en tyst misslyckad reprojicering.
const SWEDEN_LON = [10, 25]
const SWEDEN_LAT = [55, 70]

function log(msg) {
  console.log(`[build-geometry] ${msg}`)
}

async function main() {
  mkdirSync(RAW_DIR, { recursive: true })

  log(`Laddar ner ${SOURCE_URL}`)
  const res = await fetch(SOURCE_URL)
  if (!res.ok) {
    throw new Error(
      `Nedladdning misslyckades: HTTP ${res.status}. Hämta en färsk URL från råvaru-sidan och sätt GEOMETRY_SOURCE_URL.`,
    )
  }
  const zipBuf = new Uint8Array(await res.arrayBuffer())
  log(`Zip: ${(zipBuf.length / 1024 / 1024).toFixed(1)} MB`)

  const entries = unzipSync(zipBuf)
  const geojsonName = Object.keys(entries).find((f) => f.endsWith('.geojson'))
  if (!geojsonName) {
    throw new Error(
      `Ingen .geojson i zipen. Innehåll: ${Object.keys(entries).join(', ')}`,
    )
  }
  const rawBytes = entries[geojsonName]
  writeFileSync(RAW_GEOJSON, rawBytes)
  log(`Uppackad: ${geojsonName} (${(rawBytes.length / 1024 / 1024).toFixed(1)} MB)`)

  // Räkna input-features INNAN transformen — acceptansgrinden jämför mot output.
  const inputCount = JSON.parse(Buffer.from(rawBytes).toString('utf8')).features
    .length
  log(`Input: ${inputCount} distrikt (EPSG:3006)`)

  // Förenkla i källans plana meter, reprojicera sedan; precision ~1 m.
  log('mapshaper: förenkla + reprojicera 3006 -> 4326 ...')
  await mapshaper.runCommands(
    `-i "${RAW_GEOJSON}" -simplify visvalingam 5% keep-shapes ` +
      `-proj wgs84 from=EPSG:3006 -o precision=0.00001 "${OUT}"`,
  )

  // Verifiera output: antal bevarat + koordinater faktiskt i WGS84-Sverige.
  const out = JSON.parse(readFileSync(OUT, 'utf8'))
  const outputCount = out.features.length
  if (outputCount !== inputCount) {
    throw new Error(
      `ACCEPTANSFEL: distrikt tappade — input ${inputCount}, output ${outputCount}.`,
    )
  }
  const [lon, lat] = out.features[0].geometry.coordinates.flat(Infinity)
  const inSweden =
    lon >= SWEDEN_LON[0] &&
    lon <= SWEDEN_LON[1] &&
    lat >= SWEDEN_LAT[0] &&
    lat <= SWEDEN_LAT[1]
  if (!inSweden) {
    throw new Error(
      `ACCEPTANSFEL: reprojicering ser fel ut — första koordinaten [${lon}, ${lat}] ligger utanför Sverige (WGS84). Kontrollera 'from=EPSG:3006'.`,
    )
  }

  const outMb = (readFileSync(OUT).length / 1024 / 1024).toFixed(2)
  log(
    `KLART: ${OUT} — ${outputCount} distrikt, ${outMb} MB, första koord [${lon.toFixed(3)}, ${lat.toFixed(3)}].`,
  )
  log('Kom ihåg: ladda upp filen till Supabase Storage (bucket `geometry`) för prod.')

  // Härled distrikt-bboxar (public/district-bounds.json) ur samma output — klienten
  // använder dem för att `fitBounds` på ett valt område. Committas (litet derivat).
  const nBounds = buildDistrictBounds(OUT)
  log(`district-bounds.json: ${nBounds} bboxar skrivna.`)

  // Städa den stora råfilen; den regenereras vid behov.
  rmSync(RAW_GEOJSON, { force: true })
}

main().catch((e) => {
  console.error(`[build-geometry] ${e.message}`)
  process.exit(1)
})
