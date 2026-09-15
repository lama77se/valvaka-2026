// Uppsamlingsdrilldown — handover 15 sep (Lars, via Val ANALYSIS): gör "Uppsamling"-
// raden i Bryt ner klickbar ner till enskilda uppsamlingsdistrikt, precis som val.se
// redan gör (resultat.val.se listar och länkar enskilda uppsamlingsdistrikt som vilket
// geografiskt distrikt som helst). Ren datahämtning (IO), ingen React här — se
// ResultPanel.tsx för UI:t. Vilka koder som hör till den klickade bucketen avgörs av
// uppsamlingEntriesFor (aggregate.ts, delar organKey-regeln med uppsamlingRowFor).
//
// Medvetet EGEN, on-demand hämtning i stället för att lägga till en per-kod-cache i
// ResultsProvider.tsx: providern folder redan in RÅA uppsamling_result-rader i
// aggregerade hinkar (UppsamlingBuckets) vid load och sparar aldrig rader per enskild
// kod — att ändra det hade rört providerns redan skarpa, livekritiska laddnings-/
// resync-väg för en funktion som bara behövs när användaren FAKTISKT klickar sig ner
// hit. En liten, skopad fråga (bara de kod:er som redan valts ut) kostar i stället
// nästan inget och rör INGET delat state.
//
// Ingen valdeltagande-rad (Lars bekräftat: turnout-tabellen har MEDVETET aldrig
// uppsamlingsdistrikt — ingen röstberättigad-nämnare finns, matchar hur val.se själva
// gör det). Personröster som kommer från uppsamling stannar där ÄVEN i sluträkningen
// (Lars, verifierat mot 2022 — omplaceras aldrig till hemdistriktet), så
// uppsamling_personroster är redan rätt modellerad för detaljvyn, ingen omdesign.
import { supabase } from './supabase'
import type { PartyMeta } from './aggregate'
import type { Valtyp } from './results'

export interface UppsamlingSummary {
  total: number
  reported: boolean
  andel: Record<string, number> // förkortning → andel (0..1)
}

// Sammanfattning (parti-andelar för Bryt ner-kolumnerna, "rapporterad?") för EN
// uppsättning enskilda uppsamlingsdistrikt — EN fråga (in-filter), inte en per-kod-loop.
export async function fetchUppsamlingSummaries(valtyp: Valtyp, koder: string[], party: Map<string, PartyMeta>): Promise<Map<string, UppsamlingSummary>> {
  const out = new Map<string, UppsamlingSummary>()
  if (koder.length === 0) return out
  const { data, error } = await supabase.from('uppsamling_result').select('kod,partikod,roster').eq('valtyp', valtyp).in('kod', koder)
  if (error) throw new Error(error.message)
  const byKod = new Map<string, Record<string, number>>()
  for (const r of data ?? []) {
    const bucket = byKod.get(r.kod) ?? byKod.set(r.kod, {}).get(r.kod)!
    bucket[r.partikod] = (bucket[r.partikod] ?? 0) + r.roster
  }
  for (const [kod, votes] of byKod) {
    const total = Object.values(votes).reduce((a, b) => a + b, 0)
    const andel: Record<string, number> = {}
    if (total > 0) {
      for (const [pk, v] of Object.entries(votes)) {
        const f = party.get(pk)?.forkortning
        if (f) andel[f] = (andel[f] ?? 0) + v / total
      }
    }
    out.set(kod, { total, reported: total > 0, andel })
  }
  return out
}

export interface UppsamlingDetailRow {
  partikod: string
  roster: number
  andel: number
}
export interface UppsamlingDetail {
  rows: UppsamlingDetailRow[]
  total: number
  status: string | null // 'preliminar' | 'slutlig' | null (inget rapporterat än)
}

// Detaljvy för ETT enskilt uppsamlingsdistrikt — partiröster, samma form som en vanlig
// distriktstabell (sorterad fallande på röster), men ingen valdeltagande-rad (se
// filhuvudet). `status` speglar val.se:s egen — samma fält som result.status.
export async function fetchUppsamlingDetail(valtyp: Valtyp, kod: string): Promise<UppsamlingDetail> {
  const { data, error } = await supabase.from('uppsamling_result').select('partikod,roster,status').eq('valtyp', valtyp).eq('kod', kod)
  if (error) throw new Error(error.message)
  const rows = data ?? []
  const total = rows.reduce((a, r) => a + r.roster, 0)
  return {
    rows: rows.map((r) => ({ partikod: r.partikod, roster: r.roster, andel: total > 0 ? r.roster / total : 0 })).sort((a, b) => b.roster - a.roster),
    total,
    status: rows[0]?.status ?? null,
  }
}

export interface UppsamlingPersonrosterRow {
  partikod: string
  kandidatnummer: number
  namn: string
  antalPersonroster: number
}

// Personröster för samma uppsamlingsdistrikt (Lars: "trevligt, inte blockerande för
// v1") — uppsamling_personroster, samma bord/mönster som huvudsajtens personroster.ts.
export async function fetchUppsamlingPersonroster(valtyp: Valtyp, kod: string): Promise<UppsamlingPersonrosterRow[]> {
  const { data, error } = await supabase
    .from('uppsamling_personroster')
    .select('partikod,kandidatnummer,namn,antal_personroster')
    .eq('valtyp', valtyp)
    .eq('kod', kod)
    .order('antal_personroster', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({ partikod: r.partikod, kandidatnummer: r.kandidatnummer, namn: r.namn, antalPersonroster: r.antal_personroster }))
}
