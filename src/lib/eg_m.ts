// Emelie Gustafsson (M) — halvdold, lösenordsskyddad personlig sida (handover 14/15
// sep, Lars via Val ANALYSIS, bekräftat direkt av Lars: "no connection to app's main
// menus or routing"). HELT ISOLERAD från huvudappen: egen datamodul, egen Vite-entry
// (eg_m.html/src/eg_m/), rör aldrig ResultsProvider/DistrictMap/ingest-slutlig.mjs.
//
// Lars förenklade specen 15 sep (efter att ett resultat-/mandatfrågeförsök visade sig
// ha en verklig bugg — se git-historiken för den övergivna varianten): "we skip the
// results part totally... we only do personröster. much easier." Ingen andel/mandat/
// ±2022/slutlig-status längre — bara Emelies personröstsummor per valtyp. Detta
// undviker HELA den klassen bugg (en delad ResultStore/TurnoutStore utan valtyp-
// dimension korrumperade RF/KF-aggregat med varandras röster, eftersom Hudiksvalls
// distriktskoder är en delmängd av Gävleborgs) — personröster-frågan behöver ingen
// ResultStore/TurnoutStore/computeMandate/buildRows alls, bara en ren SUMMA per valtyp.
//
// ⚠️ Namn-kollision (bekräftat av Lars): en HELT ANNAN "Emelie Gustafsson" finns i
// samma val.se-källa (kandidatnummer 12525, Centerpartiet, Linköping/Östergötland).
// All uppslagning sker på KANDIDATNUMMER + PARTIKOD, ALDRIG på namnsträngen — samma
// "namn-fälla"-princip personröster-arbetet redan byggdes runt (se personroster.ts/
// migrationskommentarerna).
import { createClient } from '@supabase/supabase-js'
import type { Valtyp } from './results'

// Egen, isolerad Supabase-klient (samma mönster som lib/supabase.ts — BARA anon-
// nyckeln, RLS skyddar datan som på huvudsajten). Ingen delad instans med huvudappen.
const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })

// Samma "takt av render/freshness" som huvudsidan (Lars, 15 sep) — ResultsProvider.tsx:s
// RESYNC_MIN_MS/RESYNC_MAX_MS (jittrat 30–45 s). Denna sida gör en FULL omhämtning på
// samma jittrade intervall i stället för att duplicera providerns inkrementella cursor-
// logik — billigt nog för tre summor.
export const RESYNC_MIN_MS = 30000
export const RESYNC_MAX_MS = 45000

export const KANDIDATNUMMER = 14863
export const PARTIKOD = '0001' // Moderaterna (bekräftat: party.beteckning === 'Moderaterna')

// Geografin badgen (sluträkningsgrad, handover 15 sep) skopas till — RD och RF delar
// SAMMA fysiska distriktsmängd (Gävleborgs län; RD:s riksdagsvalkrets 25 = länet, RF:s
// region = länet), KF skopas till Hudiksvalls kommun specifikt (Lars: "på riksdag ska
// det vara en % av [Gävleborgs distriktsantal] ... i kommun % av [Hudiksvalls]").
const LANSKOD_GAVLEBORG = '21'
const KOMMUNKOD_HUDIKSVALL = '2184'

export interface EgMPersonroster {
  valtyp: Valtyp
  label: string
  total: number
  slutligDone: number
  slutligTotal: number
  slutligPct: number
  // Emelies plats bland M:s EGNA kandidater i SAMMA geografi (Gävleborg för RD/RF,
  // Hudiksvall för KF), rangordnat efter personröster — handover 15 sep, Lars.
  // null = hon (eller ALLA M-kandidater) har ännu inga personröster i området att
  // rangordna mot (väntat tidigt i sluträkningen — se slutligPct ovan).
  rank: number | null
  rankTotal: number | null
}

interface PersonrosterRow { valtyp: string; antal_personroster: number }

async function fetchPaged<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

// Totalt antal FYSISKA distrikt i ett prefix (Gävleborgs län / Hudiksvalls kommun) —
// nämnaren är "alla distrikt i området", inte "alla hittills rapporterade" (Lars: "%
// av alla distrikt i Gävleborg"). Hämtas en gång, delas mellan RD+RF (samma prefix).
async function fetchDistrictTotal(prefix: string): Promise<number> {
  const rows = await fetchPaged<{ valdistriktskod: string }>((from, to) =>
    supabase.from('district').select('valdistriktskod').ilike('valdistriktskod', `${prefix}%`).range(from, to),
  )
  return rows.length
}

// Antal av DE distrikten som är slutgiltigt räknade för denna valtyp — samma "minst en
// rad med status='slutlig'"-princip som ResultStore.isSlutlig() (results.ts), fast en
// engångsfråga i stället för en levande store (skopad direkt i frågan: status='slutlig'
// filtrerat server-side, betydligt mindre resultset än att hämta alla rader).
async function fetchSlutligCount(valtyp: Valtyp, prefix: string): Promise<number> {
  const rows = await fetchPaged<{ valdistriktskod: string }>((from, to) =>
    supabase.from('result').select('valdistriktskod').eq('valtyp', valtyp).eq('status', 'slutlig').ilike('valdistriktskod', `${prefix}%`).range(from, to),
  )
  return new Set(rows.map((r) => r.valdistriktskod)).size
}

// Emelies plats bland M:s egna kandidater i EN valtyp+geografi (Lars, 15 sep: "vilken
// plats av moderater ... ligger hon på", per nivå/lista). Summerar VARJE M-kandidats
// personröster i samma geografiska område (personroster+uppsamling_personroster,
// samma två källor/samma union som Emelies egen summa ovan — konsekvent nämnare/
// urval), rangordnar fallande, hittar hennes kandidatnummer. Samma namn-fälla-princip
// som resten av arbetet: rangordningen görs på kandidatnummer, ALDRIG på namnsträngen
// (två M-kandidater kan i teorin ha liknande namn, kandidatnumret är alltid unikt per
// lista). Delad "isKommun"-växel mellan RF (lankod) och KF (kommunkod) — samma
// organ-nyckel-princip som uppsamling_result/uppsamling_personroster redan använder.
async function fetchMRanking(valtyp: Valtyp, prefix: string, orgField: 'lankod' | 'kommunkod'): Promise<{ rank: number | null; rankTotal: number | null }> {
  const [prRows, uppRows] = await Promise.all([
    fetchPaged<{ kandidatnummer: number; antal_personroster: number }>((from, to) =>
      supabase.from('personroster').select('kandidatnummer,antal_personroster').eq('valtyp', valtyp).eq('partikod', PARTIKOD).ilike('valdistriktskod', `${prefix}%`).range(from, to),
    ),
    fetchPaged<{ kandidatnummer: number; antal_personroster: number }>((from, to) =>
      supabase.from('uppsamling_personroster').select('kandidatnummer,antal_personroster').eq('valtyp', valtyp).eq('partikod', PARTIKOD).eq(orgField, prefix).range(from, to),
    ),
  ])
  const totals = new Map<number, number>()
  for (const r of [...prRows, ...uppRows]) totals.set(r.kandidatnummer, (totals.get(r.kandidatnummer) ?? 0) + r.antal_personroster)
  if (!totals.has(KANDIDATNUMMER)) return { rank: null, rankTotal: null } // hon har (ännu) inga egna rader i området
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const idx = sorted.findIndex(([k]) => k === KANDIDATNUMMER)
  return { rank: idx + 1, rankTotal: sorted.length }
}

export async function fetchEgMData(): Promise<EgMPersonroster[]> {
  const [pr, uppPr, gavleborgTotal, hudiksvallTotal, rdDone, rfDone, kfDone, rdRank, rfRank, kfRank] = await Promise.all([
    supabase.from('personroster').select('valtyp,antal_personroster').eq('kandidatnummer', KANDIDATNUMMER).eq('partikod', PARTIKOD),
    supabase.from('uppsamling_personroster').select('valtyp,antal_personroster').eq('kandidatnummer', KANDIDATNUMMER).eq('partikod', PARTIKOD),
    fetchDistrictTotal(LANSKOD_GAVLEBORG),
    fetchDistrictTotal(KOMMUNKOD_HUDIKSVALL),
    fetchSlutligCount('RD', LANSKOD_GAVLEBORG),
    fetchSlutligCount('RF', LANSKOD_GAVLEBORG),
    fetchSlutligCount('KF', KOMMUNKOD_HUDIKSVALL),
    fetchMRanking('RD', LANSKOD_GAVLEBORG, 'lankod'),
    fetchMRanking('RF', LANSKOD_GAVLEBORG, 'lankod'),
    fetchMRanking('KF', KOMMUNKOD_HUDIKSVALL, 'kommunkod'),
  ])
  if (pr.error) throw new Error(pr.error.message)
  if (uppPr.error) throw new Error(uppPr.error.message)

  const all = [...((pr.data ?? []) as PersonrosterRow[]), ...((uppPr.data ?? []) as PersonrosterRow[])]
  const sumBy = (valtyp: Valtyp) => all.filter((r) => r.valtyp === valtyp).reduce((a, r) => a + r.antal_personroster, 0)
  // Lars, 15 sep: etiketten ska bära med sig geografin (samma som badgens nämnare
  // ovan) — "RIKSDAGSVALET GÄVLEBORG" osv, inte bara valtypens namn.
  const LABEL: Record<Valtyp, string> = { RD: 'Riksdagsvalet Gävleborg', RF: 'Regionvalet Gävleborg', KF: 'Kommunvalet Hudiksvall' }
  const TOTAL: Record<Valtyp, number> = { RD: gavleborgTotal, RF: gavleborgTotal, KF: hudiksvallTotal }
  const DONE: Record<Valtyp, number> = { RD: rdDone, RF: rfDone, KF: kfDone }
  const RANK: Record<Valtyp, { rank: number | null; rankTotal: number | null }> = { RD: rdRank, RF: rfRank, KF: kfRank }

  return (['RD', 'RF', 'KF'] as Valtyp[]).map((valtyp) => {
    const slutligTotal = TOTAL[valtyp]
    const slutligDone = DONE[valtyp]
    return {
      valtyp,
      label: LABEL[valtyp],
      total: sumBy(valtyp),
      slutligDone,
      slutligTotal,
      slutligPct: slutligTotal > 0 ? Math.round((slutligDone / slutligTotal) * 100) : 0,
      rank: RANK[valtyp].rank,
      rankTotal: RANK[valtyp].rankTotal,
    }
  })
}
