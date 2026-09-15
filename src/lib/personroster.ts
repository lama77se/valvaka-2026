// Personröster — klientsidan av handover 14 sep (Lars, spec via Val ANALYSIS). Ren
// datahämtning (RPC/tabellanrop), ingen React här — se PersonrosterPanel.tsx för UI:t.
//
// Lars beslut 1: SECURITY INVOKER RPC:er (personroster_top/personroster_search, se
// migration 20260914190000_personroster_rpc.sql) gör live-aggregeringen server-side —
// klienten skickar bara valtyp/nivå/områdeskod, aldrig egen GROUP BY-logik (PostgREST
// kan inte GROUP BY på egen hand). 'distrikt'-nivån (Lars beslut 2, "en gratis
// distriktsnivå") går DIREKT mot personroster-tabellen i stället — PK:n täcker frågan,
// ingen RPC behövs (bekräftat av Val OPS: leading columns).
//
// ⚠️ Kryssspärr (Lars beslut 3) är INTE med här än — se migrationens kommentar: en
// kandidat kan stå på FLERA valkretsars listor samtidigt (rikslistekandidater,
// bekräftat av Lars med Jimmie Åkesson som exempel i skarp data), så "kandidatens egna
// valkrets" är entydig bara vid en RIKTIG valkrets-nivåfråga — kommer i en uppföljande
// migration/komponent skopad dit.
import { supabase } from './supabase'
import type { Area } from './area'
import type { Level } from './aggregate'
import type { Valtyp } from './results'

export interface PersonrosterEntry {
  partikod: string
  kandidatnummer: number
  namn: string
  antalPersonroster: number
}

// Samma nivåer som MANDAT_LEVELS (areaView.ts) + 'distrikt' (Lars beslut 2). Egen,
// separat konstant snarare än att importera/utöka MANDAT_LEVELS — den senare är
// medvetet EXAKT mandatberäkningens egna nivåer, inte personrösternas (som har en
// nivå till). RF/KF saknar 'riket' av samma skäl som mandat: ingen riksnivå-fråga
// existerar för dem (Lars beslut 2 — löser även oron om ackumulering över flera
// organ-filer, ingen nivå vi behöver spänner någonsin över mer än ETT organ).
//
// RD har DÄREMOT även 'kommun' (Lars 15 sep: "det är väl hierarkiskt inte en riktig
// nivå men vi har ju ändå valt visa resultat på den nivån") — kommun är RD:s egen
// mellannivå mellan valkrets och distrikt (HIERARCHY.RD i hierarchy.ts, kommunen
// byggs alltid av HELA valkretsar där, till skillnad från RF där en kommun kan delas
// tvärs valkretsgränser). "Ett organ"-regeln ovan bryts inte: RD:s enda organ är
// riket självt, så en kommun-nivå ligger fortfarande helt inuti det. personroster_top/
// personroster_search (20260914190000_personroster_rpc.sql) hanterar redan p_niva=
// 'kommun' helt valtyp-agnostiskt (left(valdistriktskod,4) = p_omradeskod, samma för
// RD/RF/KF) — inget migrationsbehov, bara denna klient-gate som saknade RD.
const PERSONROSTER_LEVELS: Record<Valtyp, Level[]> = {
  RD: ['riket', 'valkrets', 'kommun', 'distrikt'],
  RF: ['region', 'valkrets', 'distrikt'],
  KF: ['kommun', 'valkrets', 'distrikt'],
}

export function personrosterLevelSupported(valtyp: Valtyp, level: Level): boolean {
  return PERSONROSTER_LEVELS[valtyp].includes(level)
}

interface RawRow {
  partikod: string
  kandidatnummer: number
  namn: string
  antal_personroster: number
}
const mapRows = (rows: RawRow[] | null): PersonrosterEntry[] =>
  (rows ?? []).map((r) => ({ partikod: r.partikod, kandidatnummer: r.kandidatnummer, namn: r.namn, antalPersonroster: r.antal_personroster }))

// Toppristan (default: blandade partier: p_partikod=null; ELLER filtrerad på ETT parti).
// Sidbläddring (offset, default 0) tillagd 14 sep (20260914200000_personroster_top_
// pagination.sql) — v1 hade bara LIMIT 10 (Lars förenklade specen), men Lars efterfrågade
// sedan faktisk paginering i UI:t (bara topp 10 syntes, ingen väg vidare). Stabil
// sortering (antal_personroster desc, partikod, kandidatnummer i RPC:n) håller sidorna
// icke-överlappande även vid lika röstetal.
export async function fetchPersonrosterTop(
  valtyp: Valtyp,
  area: Area,
  partikod: string | null,
  limit = 10,
  offset = 0,
): Promise<PersonrosterEntry[]> {
  if (area.level === 'distrikt') {
    if (!area.code) return []
    let q = supabase.from('personroster').select('partikod,kandidatnummer,namn,antal_personroster').eq('valtyp', valtyp).eq('valdistriktskod', area.code)
    if (partikod) q = q.eq('partikod', partikod)
    // .range är inklusivt i båda ändar (PostgREST/supabase-js) — sista index är offset+limit-1.
    // Samma stabila tie-break som RPC:n (kandidatnummer i sig är redan unikt per parti här).
    const { data, error } = await q
      .order('antal_personroster', { ascending: false })
      .order('kandidatnummer', { ascending: true })
      .range(offset, offset + limit - 1)
    if (error) throw error
    return mapRows(data)
  }
  const { data, error } = await supabase.rpc('personroster_top', {
    p_valtyp: valtyp,
    p_niva: area.level,
    p_omradeskod: area.level === 'riket' ? null : area.code,
    p_partikod: partikod,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  return mapRows(data)
}

// Namnsökning — komplement till topplistan (Lars beslut 4). Substräng-ILIKE (INTE bara
// prefix — Val ANALYSIS granskning av personroster_search: ren prefix mot HELA "Förnamn
// Efternamn"-fältet missar efternamnssökning helt, "Åkes" gav 0 träffar för "Jimmie
// Åkesson"). Samma områdesskopning som toppristan — söker aldrig hela riket-tabellen rått,
// alltid begränsat till det VISADE området, så substräng kostar inget extra i praktiken.
export async function searchPersonroster(valtyp: Valtyp, area: Area, query: string, limit = 20): Promise<PersonrosterEntry[]> {
  const q = query.trim()
  if (!q) return []
  if (area.level === 'distrikt') {
    if (!area.code) return []
    const { data, error } = await supabase
      .from('personroster')
      .select('partikod,kandidatnummer,namn,antal_personroster')
      .eq('valtyp', valtyp)
      .eq('valdistriktskod', area.code)
      .ilike('namn', `%${q}%`)
      .order('antal_personroster', { ascending: false })
      .limit(limit)
    if (error) throw error
    return mapRows(data)
  }
  const { data, error } = await supabase.rpc('personroster_search', {
    p_valtyp: valtyp,
    p_niva: area.level,
    p_omradeskod: area.level === 'riket' ? null : area.code,
    p_query: q,
    p_limit: limit,
  })
  if (error) throw error
  return mapRows(data)
}
