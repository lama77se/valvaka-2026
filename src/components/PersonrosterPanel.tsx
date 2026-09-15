// Personröster — handover 14 sep (Lars, spec via Val ANALYSIS). Längst ner i
// ResultPanel.tsx (mobil+desktop, INTE Dashboard-vyn — AreaSummary.tsx importerar den
// inte). Standard: topp-10 blandade partier, med sidbläddring (Lars, 14 sep: v1 hade
// bara topp 10 utan väg vidare — se personroster.ts/20260914200000_personroster_top_
// pagination.sql). Partidropdown → samma topplista filtrerad på ETT parti, egen
// sidräkning. Namnsökfält som komplement till topplistan — INTE paginerad (en ny
// sökning är redan sin egen "omstart", se personroster.ts).
//
// ⚠️ Ingen kryssspärr-badge än (Lars beslut 3) — se personroster.ts/migrationens
// kommentar: en kandidat kan stå på FLERA valkretsars listor (rikslistekandidater,
// bekräftat med Jimmie Åkesson i skarp data), så "egen valkrets" är bara entydig vid en
// RIKTIG valkrets-fråga. Kommer i en uppföljande, mindre PR skopad dit.
import { useEffect, useState } from 'react'
import type { Area } from '@/lib/area'
import type { Valtyp } from '@/lib/results'
import { onDark } from '@/lib/colors'
import { fetchPersonrosterTop, personrosterLevelSupported, searchPersonroster, type PersonrosterEntry } from '@/lib/personroster'
import type { PartyMeta } from '@/lib/aggregate'
import { spectrumRank } from '@/lib/soffa'

export function PersonrosterPanel({
  valtyp,
  area,
  parties,
  compact = false,
}: {
  valtyp: Valtyp
  area: Area
  parties: Map<string, PartyMeta>
  compact?: boolean
}) {
  const PAGE_SIZE = 10
  const [partikod, setPartikod] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [entries, setEntries] = useState<PersonrosterEntry[]>([])
  const [searchEntries, setSearchEntries] = useState<PersonrosterEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const supported = personrosterLevelSupported(valtyp, area.level) && (area.level === 'riket' || !!area.code)

  // Nollställ filter/sökning/sida på områdesbyte — annars kan ett parti/sökord/sida från
  // ETT område av misstag följa med och ge en tom (eller vilseledande) lista i nästa.
  useEffect(() => {
    setPartikod(null)
    setQuery('')
    setSearchEntries(null)
    setPage(0)
  }, [valtyp, area.level, area.code])

  // Bytt parti-filter → tillbaka till sida 1 (annars kan man landa på en sida som är
  // tom för det NYA partiet men bara fanns för det gamla).
  useEffect(() => {
    setPage(0)
  }, [partikod])

  useEffect(() => {
    if (!supported) return
    let cancelled = false
    setLoading(true)
    setFailed(false)
    fetchPersonrosterTop(valtyp, area, partikod, PAGE_SIZE, page * PAGE_SIZE)
      .then((rows) => { if (!cancelled) setEntries(rows) })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // area.level/area.code (inte hela `area`-objektet, ny referens varje render) — undviker
    // ett extra onödigt anrop per föräldra-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valtyp, area.level, area.code, partikod, page, supported])

  // Debounce (300 ms) — annars ett RPC-anrop per tangenttryck.
  useEffect(() => {
    if (!supported) return
    const q = query.trim()
    if (!q) { setSearchEntries(null); return }
    let cancelled = false
    const t = setTimeout(() => {
      searchPersonroster(valtyp, area, q)
        .then((rows) => { if (!cancelled) setSearchEntries(rows) })
        .catch(() => { if (!cancelled) setSearchEntries([]) })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
    // Samma skäl som ovan — area.level/area.code, inte hela objektet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valtyp, area.level, area.code, query, supported])

  if (!supported) return null

  const shown = searchEntries ?? entries
  // Namn: förkortning finns bara för partier med en officiell sådan (riksdagspartierna +
  // en del större lokala) — resten (de flesta av de ~80 småpartierna) saknar helt
  // förkortning i party-tabellen. Föll tidigare tillbaka direkt på den råa 4-siffriga
  // partikoden ("1902") i stället för det fullständiga namnet ("Alternativ Sanning"),
  // som redan finns i beteckning (samma fält 2022-jämförelsen joinar på).
  const partyLabel = (kod: string, p: PartyMeta) => p.forkortning ?? p.beteckning ?? kod
  // De 8 riksdagspartierna (SPECTRUM, samma vänster→höger-ordning som Bryt ner-kolumnerna
  // och MandatBars) överst, i EN egen optgroup — resten (spectrumRank===8, "okända sist")
  // alfabetiskt i en andra optgroup. Native <optgroup> ger både gruppering OCH en synlig
  // avdelare gratis, ingen egen CSS/JS-lösning behövs.
  const partyOptions = [...parties.entries()].sort((a, b) => {
    const ra = spectrumRank(a[1].forkortning)
    const rb = spectrumRank(b[1].forkortning)
    if (ra !== rb) return ra - rb
    return partyLabel(a[0], a[1]).localeCompare(partyLabel(b[0], b[1]), 'sv')
  })
  const majorOptions = partyOptions.filter(([, p]) => spectrumRank(p.forkortning) < 8)
  const minorOptions = partyOptions.filter(([, p]) => spectrumRank(p.forkortning) === 8)

  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Personröster</p>
        <select
          className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[12px] text-slate-200"
          value={partikod ?? ''}
          onChange={(e) => setPartikod(e.target.value || null)}
        >
          <option value="">Alla partier</option>
          <optgroup label="Riksdagspartier">
            {majorOptions.map(([kod, p]) => (
              <option key={kod} value={kod}>{partyLabel(kod, p)}</option>
            ))}
          </optgroup>
          <optgroup label="Övriga partier">
            {minorOptions.map(([kod, p]) => (
              <option key={kod} value={kod}>{partyLabel(kod, p)}</option>
            ))}
          </optgroup>
        </select>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Sök namn…"
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[12px] text-slate-200 placeholder:text-slate-600"
        />
      </div>
      {loading && shown.length === 0 && <p className="text-[12px] text-slate-500">Laddar…</p>}
      {failed && <p className="text-[12px] text-rose-400">Kunde inte hämta personröster.</p>}
      {!loading && !failed && shown.length === 0 && (
        <p className="text-[12px] text-slate-500">{searchEntries != null ? 'Inga träffar.' : 'Inga personröster rapporterade än.'}</p>
      )}
      {shown.length > 0 && (
        <ol className="space-y-0.5 text-[13px] tabular-nums">
          {shown.map((e, i) => {
            const p = parties.get(e.partikod)
            // Radnumret fortsätter över sidor (11, 12, … på sida 2) — bara för topplistan
            // (shown===entries); sökträffar har ingen sida att räkna från.
            const rank = shown === entries ? i + 1 + page * PAGE_SIZE : i + 1
            return (
              <li key={`${e.partikod}-${e.kandidatnummer}`} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-right text-slate-500">{rank}</span>
                <span className="w-8 shrink-0 font-bold" style={{ color: onDark(p?.farg ?? '#94a3b8') }}>{p?.forkortning ?? e.partikod}</span>
                <span className="min-w-0 flex-1 truncate text-slate-200">{e.namn}</span>
                <span className="shrink-0 font-semibold text-slate-100">{e.antalPersonroster.toLocaleString('sv-SE')}</span>
              </li>
            )
          })}
        </ol>
      )}
      {/* Sidbläddring — bara för topplistan, inte namnsökningen (searchEntries, alltid
          en enda platt topp-20 utan sidor, se personroster.ts). "Nästa" inaktiveras när
          sidan gav färre rader än PAGE_SIZE (sista sidan) — inget separat totalt-antal
          hämtas, samma "räkna raderna"-heuristik som redan gäller på andra ställen i
          appen. Döljs helt på sida 1 UTAN nästa sida (inget att bläddra i alls). */}
      {searchEntries == null && (page > 0 || entries.length === PAGE_SIZE) && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Föregående
          </button>
          <span className="text-[11px] text-slate-500">Sida {page + 1}</span>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={entries.length < PAGE_SIZE || loading}
            className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Nästa →
          </button>
        </div>
      )}
      {!compact && (
        <p className="mt-1.5 text-[11px] text-slate-500">
          Visar {shown === entries ? `${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + shown.length}` : shown.length}, {partikod ? partyLabel(partikod, parties.get(partikod) ?? { forkortning: null, farg: null }) : 'alla partier'}.
        </p>
      )}
    </div>
  )
}
