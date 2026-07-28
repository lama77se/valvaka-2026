// Fas 2 — ingest av statiska referenstabeller (party, district, district_comparison).
//
//   node --env-file=.env.local scripts/ingest-reference.mjs
//
// Idempotent upsert (körs om när val.se publicerar en "slutlig" jämförelsefil).
// Kräver server-side service-role-nyckeln (kringgår RLS) — läses ur .env.local,
// ALDRIG VITE_-prefix, ALDRIG i klienten/Vercel.
//
// Källor:
//   party              <- data/raw/deltagande-partier.csv         (val.se, husstil-CSV)
//   district           <- public/valdistrikt-2026-wgs84.geojson   (redan reprojicerad)
//   district_comparison<- data/raw/jamforelser-2022-2026.xlsx     (blad "Jämförelser")
import { readFileSync } from 'node:fs'
import ws from 'ws'
import { createClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'

// Node < 22 saknar inbyggd WebSocket; supabase-js initierar Realtime eagerly.
// Vi använder bara REST här, men klienten kräver ändå en WebSocket-konstruktor.
globalThis.WebSocket ??= ws

const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error(
    'Saknar VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Kör med: node --env-file=.env.local scripts/ingest-reference.mjs',
  )
  process.exit(1)
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } })

// Riksdagspartiernas märkesfärger (choropleth). Övriga ~370 partier -> null (grå i UI).
// Nyckel = PARTIFÖRKORTNING (stabil, igenkännbar). Fas 5-paint kan förfina.
const PARTY_COLORS = {
  S: '#E8112d', M: '#52BDEC', SD: '#DDDD00', C: '#009933',
  V: '#DA291C', KD: '#231977', L: '#006AB3', MP: '#83CF39',
}

const log = (m) => console.log(`[ingest-reference] ${m}`)

// Upsert i chunkar (PostgREST gillar inte gigantiska payloads).
// OBS: detta är upsert, inte mirror — rader som FÖRSVINNER ur källan (t.ex. ett
// borttaget distrikt i "slutlig"-versionen ~30 dagar före valet) städas INTE bort.
// Distriktsindelningen är låst 30 dagar innan, så det är sannolikt ett icke-problem,
// men vid en riktig full-sync krävs en delete-of-missing-fas.
async function upsert(table, rows, onConflict) {
  const CHUNK = 1000
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db
      .from(table)
      .upsert(rows.slice(i, i + CHUNK), { onConflict })
    if (error) throw new Error(`${table}: ${error.message}`)
  }
  log(`${table}: upsert ${rows.length} rader`)
}

function buildParties() {
  // Husstil: strippa BOM, avgränsare ';', versala nycklar, läs koder som string.
  const csv = readFileSync('data/raw/deltagande-partier.csv', 'utf8').replace(/^﻿/, '')
  const lines = csv.split(/\r?\n/).filter(Boolean)
  const H = lines[0].split(';')
  const iKod = H.indexOf('PARTIKOD')
  const iBet = H.indexOf('PARTIBETECKNING')
  const iFor = H.indexOf('PARTIFÖRKORTNING')
  const byKod = new Map()
  for (const line of lines.slice(1)) {
    const c = line.split(';')
    const partikod = c[iKod]?.trim()
    if (!partikod || byKod.has(partikod)) continue
    const forkortning = c[iFor]?.trim() || null
    byKod.set(partikod, {
      partikod,
      beteckning: c[iBet]?.trim() ?? '',
      forkortning,
      color: (forkortning && PARTY_COLORS[forkortning]) || null,
    })
  }
  return [...byKod.values()]
}

function buildDistricts() {
  const gj = JSON.parse(readFileSync('public/valdistrikt-2026-wgs84.geojson', 'utf8'))
  return gj.features.map((f) => {
    const p = f.properties
    return {
      valdistriktskod: p.Valdistriktskod,
      namn: p.Valdistriktsnamn,
      kommunkod: p.Kommunkod,
      kommun: p.Kommun ?? null,
      lanskod: p['Länskod'],
      lan: p['Län'] ?? null,
      vk_rd: p.Riksdagsvalkretskod ?? null,
      vk_rf: p.Regionvalkretskod ?? null,
      vk_kf: p.Kommunvalkretskod ?? null,
    }
  })
}

const TYPE_MAP = {
  'Kan jämföras': 'JA',
  'Ej jämförbart': 'NEJ',
  'Kan jämföras mot flera': 'FLERA',
}

function buildComparisons() {
  const wb = XLSX.readFile('data/raw/jamforelser-2022-2026.xlsx')
  const rows = XLSX.utils
    .sheet_to_json(wb.Sheets['Jämförelser'], { header: 1, raw: false, defval: '' })
    .slice(1)
  return rows.map((r) => {
    const jamforbarhet = TYPE_MAP[r[4]]
    if (!jamforbarhet) throw new Error(`Okänd JAMFORELSETYP: "${r[4]}" för ${r[0]}`)
    // 2022-koderna tappar ledande läns-nolla i filen -> vänster-padda till 8.
    const koder_foreg = [r[5], r[6]]
      .map((c) => String(c).trim())
      .filter(Boolean)
      .map((c) => c.padStart(8, '0'))
    for (const c of koder_foreg) {
      if (c.length !== 8) throw new Error(`Föregående kod inte 8 siffror efter padding: "${c}" (${r[0]})`)
    }
    return { valdistriktskod: String(r[0]), jamforbarhet, koder_foreg }
  })
}

async function main() {
  const parties = buildParties()
  const districts = buildDistricts()
  const comparisons = buildComparisons()
  log(`parsat: ${parties.length} partier, ${districts.length} distrikt, ${comparisons.length} jämförelser`)

  // FK-ordning: party + district först, sedan district_comparison (-> district).
  await upsert('party', parties, 'partikod')
  await upsert('district', districts, 'valdistriktskod')
  await upsert('district_comparison', comparisons, 'valdistriktskod')

  // Verifiera radantal i DB.
  for (const t of ['party', 'district', 'district_comparison']) {
    const { count, error } = await db.from(t).select('*', { count: 'exact', head: true })
    if (error) throw new Error(`count ${t}: ${error.message}`)
    log(`DB ${t}: ${count} rader`)
  }
  log('KLART.')
}

main().catch((e) => {
  console.error(`[ingest-reference] ${e.message}`)
  process.exit(1)
})
