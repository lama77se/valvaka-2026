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
// OBS: filerna committas aldrig (gitignore: *.geojson) — samma mönster som
// build-geometry.mjs. Ladda upp till Supabase Storage-bucketen `geometry` för prod.
import { readFileSync } from 'node:fs'
import mapshaper from 'mapshaper'

const SRC = 'public/valdistrikt-2026-wgs84.geojson'

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

async function main() {
  readFileSync(SRC) // kastar tydligt ENOENT om build-geometry.mjs inte körts först

  for (const { field, nameField, out, expected } of JOBS) {
    await mapshaper.runCommands(
      `-i "${SRC}" -dissolve fields=${field} copy-fields=${nameField} ` +
        `-simplify visvalingam 10% keep-shapes -o precision=0.0001 "${out}"`,
    )
    const written = JSON.parse(readFileSync(out, 'utf8'))
    const n = written.features.length
    if (n !== expected) {
      throw new Error(`ACCEPTANSFEL: ${out} — förväntade ${expected} grupper (${field}), fick ${n}.`)
    }
    const kb = (readFileSync(out).length / 1024).toFixed(0)
    log(`KLART: ${out} — ${n} grupper, ${kb} kB.`)
  }
  log('Kom ihåg: ladda upp filerna till Supabase Storage (bucket `geometry`) för prod.')
}

main().catch((e) => {
  console.error(`[build-group-boundaries] ${e.message}`)
  process.exit(1)
})
