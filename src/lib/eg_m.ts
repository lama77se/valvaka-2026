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
  // Hudiksvall för KF), rangordnat efter personröster — handover 15 sep, Lars. null =
  // ingen M-kandidat i området har personröster ännu (neighbors tom också — väntat
  // tidigt i sluträkningen). Har HON specifikt 0 kryss men ANDRA M-kandidater redan har
  // rader placeras hon INTE som null — hon sätts explicit sist, direkt efter kandidaten
  // med minst kryss (Lars 15 sep, se fetchMRanking) — rankTotal räknar då med henne
  // själv. (Bugfix samma dag: koden kollade tidigare bara hennes EGEN rad och dolde hela
  // topplistan — inkl. ledaren — så fort bara HON saknade data.)
  rank: number | null
  rankTotal: number | null
  // Ledaren (plats 1) + hennes närmaste grannar (plats-1/plats+1) — Lars, 15 sep: "vem
  // som är 1'a ... och vem som är på platsen före/efter henne". Har hon 0 kryss (syntetisk
  // sistaplats, se fetchMRanking) blir "plats före" = kandidaten med minst kryss i
  // verkligheten. Max 3 poster, dedupat (t.ex. om hon själv ligger på plats 2 ÄR "plats
  // före" = ledaren, visas bara en gång; är hon 1:a själv IS hon "ledaren"-posten).
  neighbors: RankEntry[]
}

export interface RankEntry {
  rank: number
  namn: string
  total: number
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
async function fetchMRanking(
  valtyp: Valtyp,
  prefix: string,
  orgField: 'lankod' | 'kommunkod',
): Promise<{ rank: number | null; rankTotal: number | null; neighbors: RankEntry[] }> {
  const [prRows, uppRows] = await Promise.all([
    fetchPaged<{ kandidatnummer: number; antal_personroster: number; namn: string }>((from, to) =>
      supabase.from('personroster').select('kandidatnummer,antal_personroster,namn').eq('valtyp', valtyp).eq('partikod', PARTIKOD).ilike('valdistriktskod', `${prefix}%`).range(from, to),
    ),
    fetchPaged<{ kandidatnummer: number; antal_personroster: number; namn: string }>((from, to) =>
      supabase.from('uppsamling_personroster').select('kandidatnummer,antal_personroster,namn').eq('valtyp', valtyp).eq('partikod', PARTIKOD).eq(orgField, prefix).range(from, to),
    ),
  ])
  const totals = new Map<number, number>()
  // Namn-fälla (samma princip som personroster.ts:s RPC:er): samma kandidat kan ha
  // olika stavning i olika rader — max(namn) väljer en deterministisk representant,
  // aldrig grupperingsnyckel.
  const names = new Map<number, string>()
  for (const r of [...prRows, ...uppRows]) {
    totals.set(r.kandidatnummer, (totals.get(r.kandidatnummer) ?? 0) + r.antal_personroster)
    const prev = names.get(r.kandidatnummer)
    if (prev == null || r.namn > prev) names.set(r.kandidatnummer, r.namn)
  }
  // BUGFIX 15 sep (Lars): guarden kollade tidigare bara HENNES egen rad
  // (`!totals.has(KANDIDATNUMMER)`), trots att kommentaren ovanför (EgMPersonroster.rank)
  // alltid dokumenterat det bredare villkoret "hon ELLER ALLA M-kandidater saknar data".
  // Konsekvens: val.se:s summeradePersonroster-listor verkar bara innehålla kandidater
  // med ≥1 kryss — får hon 0 kryss i de första slutgiltigt räknade distrikten medan
  // ANDRA M-kandidater redan har rader, dolde koden ändå HELA topplistan (även ledaren)
  // i stället för att visa den utan att markera hennes egen plats. Rätt villkor: "finns
  // det över huvud taget någon M-kandidat med personröster i området".
  if (totals.size === 0) return { rank: null, rankTotal: null, neighbors: [] } // ingen M-kandidat alls har personröster i området än

  const sorted = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kandidatnummer, total], i): RankEntry & { kandidatnummer: number } => ({ rank: i + 1, kandidatnummer, namn: names.get(kandidatnummer) ?? '', total }))
  const idx = sorted.findIndex((e) => e.kandidatnummer === KANDIDATNUMMER)
  // Lars 15 sep: saknar hon en egen rad (0 kryss, ingen post i totals) placeras hon
  // INTE som "ingen rank" — sätt henne explicit sist, direkt efter kandidaten med minst
  // kryss i det valet. rankTotal räknar då med henne själv (sorted.length + 1) — hon är
  // trots allt en av M:s kandidater i området, bara utan kryss ännu.
  const rank = idx === -1 ? sorted.length + 1 : idx + 1
  const rankTotal = idx === -1 ? sorted.length + 1 : sorted.length

  // Ledaren (plats 1) + hennes grannar (plats-1/plats+1) — handover 15 sep, Lars: "vem
  // som är 1'a ... och vem som är på platsen före/efter henne". Hennes EGEN rad listas
  // aldrig här (bara "runtomkring" henne) — UNDANTAGET är när hon själv är 1:a, då ÄR
  // ledarposten henne (se docstringen ovanför fältet). Är hon sist av alla (syntetisk
  // sistaplats ovan) blir "plats före" = den riktiga kandidaten med minst kryss, och
  // "plats efter" (rank+1) filtreras bort av `r <= sorted.length` (finns bara i
  // `sorted`, de RIKTIGA raderna — hennes syntetiska sistaplats är aldrig med där).
  // En Set dedupar automatiskt (t.ex. plats 2 → "plats före" ÄR ledaren, visas en gång).
  const wantedRanks = new Set([1, rank - 1, rank + 1].filter((r) => r >= 1 && r <= sorted.length))
  const neighbors = sorted.filter((e) => wantedRanks.has(e.rank)).map(({ rank, namn, total }) => ({ rank, namn, total }))

  return { rank, rankTotal, neighbors }
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
  const RANK: Record<Valtyp, { rank: number | null; rankTotal: number | null; neighbors: RankEntry[] }> = { RD: rdRank, RF: rfRank, KF: kfRank }

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
      neighbors: RANK[valtyp].neighbors,
    }
  })
}
