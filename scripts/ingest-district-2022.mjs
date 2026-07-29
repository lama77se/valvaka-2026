// Ingest av 2022 års distriktsresultat → district_result_2022, föraggregerat per
// 2026-distrikt via district_comparison.koder_foreg (JA = 1:1, FLERA = summa över
// föregående 2022-distrikt, NEJ = ingen rad → "–" i tabellen). Bara röstandel
// lagras (mandat fördelas inte per distrikt). Idempotent upsert på PK.
//
//   node --env-file=.env.local scripts/ingest-district-2022.mjs
//
// Kräver server-side service-role-nyckeln (ur .env.local, ALDRIG i klienten) och
// att migrationen 20260729100000 är applicerad på remote.
import ws from 'ws'
import { createClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'

globalThis.WebSocket ??= ws // Node < 22: supabase-js kräver en WebSocket-konstruktor

const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Saknar VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (kör med --env-file=.env.local).')
  process.exit(1)
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } })

const MANDIR = 'data/raw/mandat2022'
const VALTYPER = ['RD', 'RF', 'KF']
const t = (v) => String(v ?? '').trim()
const INVALID = new Set(['Valdeltagande', 'Summa giltiga röster', 'ej anmält deltagande', 'blanka röster', 'övriga ogiltiga', 'Röstberättigade'])
const round = (n) => Math.round(n * 100000) / 100000
const log = (m) => console.log(`[ingest-district-2022] ${m}`)

// 2026-distrikt → [2022-distriktskoder] ur jämförelse-xlsx (samma källa/padding som
// ingest-reference: koderna tappar ledande läns-nolla i filen → vänster-padda 8).
function loadKoderForeg() {
  const wb = XLSX.readFile('data/raw/jamforelser-2022-2026.xlsx')
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Jämförelser'], { header: 1, raw: false, defval: '' }).slice(1)
  const map = new Map()
  for (const r of rows) {
    const vd2026 = t(r[0])
    const koder = [r[5], r[6]].map((c) => t(c)).filter(Boolean).map((c) => c.padStart(8, '0'))
    if (vd2026 && koder.length) map.set(vd2026, koder)
  }
  return map
}

// 2022 röster per (2022-distrikt → parti). Distriktskoden padd:as till 8 så den
// matchar koder_foreg.
function loadVotes2022(valtyp) {
  const wb = XLSX.readFile(`${MANDIR}/roster-${valtyp.toLowerCase()}-2022.xlsx`)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[`roster_${valtyp}`], { header: 1, raw: false, defval: '' }).slice(1)
  const byDistrict = new Map()
  for (const r of rows) {
    const vd = t(r[5]).padStart(8, '0')
    const parti = t(r[9])
    const roster = Number(t(r[10])) || 0
    if (!vd || !parti || INVALID.has(parti)) continue
    const m = byDistrict.get(vd) ?? byDistrict.set(vd, new Map()).get(vd)
    m.set(parti, (m.get(parti) ?? 0) + roster)
  }
  return byDistrict
}

async function upsert(rows) {
  const CHUNK = 2000
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db
      .from('district_result_2022')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'valtyp,valdistriktskod,beteckning' })
    if (error) throw new Error(`upsert: ${error.message}`)
  }
}

async function main() {
  const koder = loadKoderForeg()
  log(`jämförelse: ${koder.size} distrikt med föregående 2022-koder (JA + FLERA)`)

  let grand = 0
  for (const valtyp of VALTYPER) {
    const votes = loadVotes2022(valtyp)
    const rows = []
    let matched = 0
    for (const [vd2026, prevCodes] of koder) {
      const agg = new Map()
      for (const c of prevCodes) {
        const m = votes.get(c)
        if (!m) continue
        for (const [parti, v] of m) agg.set(parti, (agg.get(parti) ?? 0) + v)
      }
      const total = [...agg.values()].reduce((a, b) => a + b, 0)
      if (total === 0) continue // t.ex. distrikt som inte deltar i valtypen
      matched++
      for (const [beteckning, v] of agg) {
        if (v > 0) rows.push({ valtyp, valdistriktskod: vd2026, beteckning, andel: round(v / total) })
      }
    }
    await upsert(rows)
    grand += rows.length
    log(`${valtyp}: ${matched}/${koder.size} distrikt matchade → ${rows.length} rader`)
  }

  const { count } = await db.from('district_result_2022').select('*', { count: 'exact', head: true })
  log(`DB district_result_2022: ${count} rader (skrev ${grand})`)
  log('KLART.')
}

main().catch((e) => {
  console.error(`[ingest-district-2022] ${e.message}`)
  process.exit(1)
})
