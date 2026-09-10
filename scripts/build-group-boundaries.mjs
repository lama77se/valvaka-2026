// Genererar UPPLÖSTA (dissolved) gränser för "en nivå under riket" per valtyp — RD:
// valkrets, RF: region, KF: kommun — till den nya kartfärgläges-funktionen (Valdistrikt
// ⇄ Valkrets/Region/Kommun, se DistrictMap.tsx). Utan dessa syns distriktens FINA
// gränser kvar inuti varje färgad grupp även i gruppläget — förvirrande mosaik i
// stället för en riktig choropleth.
//
//   node scripts/build-group-boundaries.mjs
//   (eller: npm run geometry — körs automatiskt efter build-geometry.mjs)
//
// Läser den REDAN byggda public/valdistrikt-2026-wgs84.geojson (ingen ny nedladdning)
// — dess features har redan Riksdagsvalkretskod/Regionkod/Kommunkod som properties
// (val.se:s egen husstil), så ingen extra datajoin mot `district`-tabellen krävs.
// mapshaper -dissolve slår ihop alla distrikt med samma kod till EN polygon per grupp;
// en extra -simplify efteråt krymper filerna (interna distriktszickzack försvinner
// redan av dissolve, men kustlinjen/yttergränsen förenklas ytterligare).
//
// 🔴 Kända artefakter EFTER dissolve (upptäckt 10 sep, felrapport: små vita prickar
// mitt i Värmlands/Västmanlands valkrets + en rak linje in i Kalmar läns valkrets):
// enskilda valdistrikt delar inte EXAKT koincidenta kanter (sub-meter-avvikelser,
// ärvda från källdatan) → dissolve lämnar kvar mikroskopiska "sliver"-ringar som EGNA
// MultiPolygon-delar i stället för att smälta ihop till en enda ren polygon. Åtgärdat
// i två steg:
//   1. `-dissolve gap-width=50m` + `-clean gap-width=50m` — mapshapers inbyggda
//      gap-fill (dissolve-kommandots egen beskrivning: "repairs polygon topology")
//      löser de allra flesta (28/29 valkretsar, 21/21 regioner rena direkt).
//   2. Kvarvarande enstaka fall (11/290 kommuner, t.ex. Borlänge/Falun/Mora) är INTE
//      gap-fyllbara — de ligger km-vis från huvudpolygonen (spöklika artefakter i
//      källgeometrin, inte en dissolve-brist) och mapshapers -filter-islands matchar
//      dem inte (delar inte båge-topologi enligt dess interna kriterium). Städas i
//      stället med en egen areabaserad efterfiltrering (dropSliverParts nedan): en
//      MultiPolygon-dels area jämförs mot den STÖRSTA delen i samma feature — under
//      1 % av den bort, annars behålls den (skyddar riktiga flerdelade kommuner/
//      skärgårdar om någon sådan någonsin uppstår, inte bara mikroskopiska prickar).
//
// OBS: filerna committas aldrig (gitignore: *.geojson) — samma mönster som
// build-geometry.mjs. Ladda upp till Supabase Storage-bucketen `geometry` för prod.
import { readFileSync, writeFileSync } from 'node:fs'
import mapshaper from 'mapshaper'

const SRC = 'public/valdistrikt-2026-wgs84.geojson'
const GAP_WIDTH = '50m' // mapshaper -dissolve/-clean: fyll/städa glapp smalare än detta

// [fält att slå ihop på, kopiera namn-fältet också, utfil, förväntat antal grupper —
// en hård acceptansgrind (samma idé som build-geometry.mjs) mot tyst trasig indata].
const JOBS = [
  { field: 'Riksdagsvalkretskod', nameField: 'Riksdagsvalkrets', out: 'public/valkrets-rd-boundaries.geojson', expected: 29 },
  { field: 'Regionkod', nameField: 'Region', out: 'public/region-boundaries.geojson', expected: 21 },
  { field: 'Kommunkod', nameField: 'Kommun', out: 'public/kommun-boundaries.geojson', expected: 290 },
]

function log(msg) {
  console.log(`[build-group-boundaries] ${msg}`)
}

// Shoelace — bara för att JÄMFÖRA delars storlek inom samma feature (grader², inte
// km²) → skalfel/projektion spelar ingen roll, bara den relativa storleksordningen.
function ringArea(ring) {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

// Ta bort MultiPolygon-delar som är < 1 % av den STÖRSTA delen i samma feature — de
// kvarvarande dissolve-artefakterna (se kommentaren högst upp) är 100–1000× mindre än
// huvudpolygonen, långt under vad en riktig flerdelad kommun/skärgård skulle vara.
function dropSliverParts(geojson) {
  let changed = 0
  for (const f of geojson.features) {
    if (f.geometry?.type !== 'MultiPolygon') continue
    const parts = f.geometry.coordinates
    const areas = parts.map((p) => ringArea(p[0]))
    const maxArea = Math.max(...areas)
    const kept = parts.filter((_, i) => areas[i] >= maxArea * 0.01)
    if (kept.length !== parts.length) changed++
    f.geometry = kept.length === 1 ? { type: 'Polygon', coordinates: kept[0] } : { type: 'MultiPolygon', coordinates: kept }
  }
  return changed
}

async function main() {
  readFileSync(SRC) // kastar tydligt ENOENT om build-geometry.mjs inte körts först

  for (const { field, nameField, out, expected } of JOBS) {
    await mapshaper.runCommands(
      `-i "${SRC}" ` +
        `-dissolve fields=${field} copy-fields=${nameField} gap-width=${GAP_WIDTH} ` +
        `-clean gap-width=${GAP_WIDTH} ` +
        `-simplify visvalingam 10% keep-shapes ` +
        `-o precision=0.0001 "${out}"`,
    )
    const written = JSON.parse(readFileSync(out, 'utf8'))
    const n = written.features.length
    if (n !== expected) {
      throw new Error(`ACCEPTANSFEL: ${out} — förväntade ${expected} grupper (${field}), fick ${n}.`)
    }
    const slivers = dropSliverParts(written)
    if (slivers > 0) {
      writeFileSync(out, JSON.stringify(written))
      log(`  städade ${slivers} kvarvarande sliver-artefakt(er) (areafilter, se kommentar).`)
    }
    const stillMulti = written.features.filter((f) => f.geometry.type === 'MultiPolygon').length
    const kb = (readFileSync(out).length / 1024).toFixed(0)
    log(`KLART: ${out} — ${n} grupper (${stillMulti} flerdelade), ${kb} kB.`)
  }
  log('Kom ihåg: ladda upp filerna till Supabase Storage (bucket `geometry`) för prod.')
}

main().catch((e) => {
  console.error(`[build-group-boundaries] ${e.message}`)
  process.exit(1)
})
