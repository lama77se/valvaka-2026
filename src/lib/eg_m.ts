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

export interface EgMPersonroster {
  valtyp: Valtyp
  label: string
  total: number
}

interface PersonrosterRow { valtyp: string; antal_personroster: number }

export async function fetchEgMData(): Promise<EgMPersonroster[]> {
  const [pr, uppPr] = await Promise.all([
    supabase.from('personroster').select('valtyp,antal_personroster').eq('kandidatnummer', KANDIDATNUMMER).eq('partikod', PARTIKOD),
    supabase.from('uppsamling_personroster').select('valtyp,antal_personroster').eq('kandidatnummer', KANDIDATNUMMER).eq('partikod', PARTIKOD),
  ])
  if (pr.error) throw new Error(pr.error.message)
  if (uppPr.error) throw new Error(uppPr.error.message)

  const all = [...((pr.data ?? []) as PersonrosterRow[]), ...((uppPr.data ?? []) as PersonrosterRow[])]
  const sumBy = (valtyp: Valtyp) => all.filter((r) => r.valtyp === valtyp).reduce((a, r) => a + r.antal_personroster, 0)
  const LABEL: Record<Valtyp, string> = { RD: 'Riksdagsvalet', RF: 'Regionvalet', KF: 'Kommunvalet' }
  return (['RD', 'RF', 'KF'] as Valtyp[]).map((valtyp) => ({ valtyp, label: LABEL[valtyp], total: sumBy(valtyp) }))
}
