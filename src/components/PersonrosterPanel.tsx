// Personröster — handover 14 sep (Lars, spec via Val ANALYSIS). Längst ner i
// ResultPanel.tsx (mobil+desktop, INTE Dashboard-vyn — AreaSummary.tsx importerar den
// inte). Standard: topp-10 blandade partier. Partidropdown → topp-10 filtrerat på ETT
// parti (ingen paginering, Lars förenklade specen 14 sep — bara LIMIT 10, ingen offset).
// Namnsökfält som komplement till topplistan.
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
  const [partikod, setPartikod] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<PersonrosterEntry[]>([])
  const [searchEntries, setSearchEntries] = useState<PersonrosterEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const supported = personrosterLevelSupported(valtyp, area.level) && (area.level === 'riket' || !!area.code)

  // Nollställ filter/sökning på områdesbyte — annars kan ett parti/sökord från ETT
  // område av misstag följa med och ge en tom (eller vilseledande) lista i nästa.
  useEffect(() => {
    setPartikod(null)
    setQuery('')
    setSearchEntries(null)
  }, [valtyp, area.level, area.code])

  useEffect(() => {
    if (!supported) return
    let cancelled = false
    setLoading(true)
    setFailed(false)
    fetchPersonrosterTop(valtyp, area, partikod)
      .then((rows) => { if (!cancelled) setEntries(rows) })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // area.level/area.code (inte hela `area`-objektet, ny referens varje render) — undviker
    // ett extra onödigt anrop per föräldra-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valtyp, area.level, area.code, partikod, supported])

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
  const partyOptions = [...parties.entries()].sort((a, b) => (a[1].forkortning ?? a[0]).localeCompare(b[1].forkortning ?? b[0], 'sv'))

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
          {partyOptions.map(([kod, p]) => (
            <option key={kod} value={kod}>{p.forkortning ?? kod}</option>
          ))}
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
            return (
              <li key={`${e.partikod}-${e.kandidatnummer}`} className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-right text-slate-500">{i + 1}</span>
                <span className="w-8 shrink-0 font-bold" style={{ color: onDark(p?.farg ?? '#94a3b8') }}>{p?.forkortning ?? e.partikod}</span>
                <span className="min-w-0 flex-1 truncate text-slate-200">{e.namn}</span>
                <span className="shrink-0 font-semibold text-slate-100">{e.antalPersonroster.toLocaleString('sv-SE')}</span>
              </li>
            )
          })}
        </ol>
      )}
      {!compact && <p className="mt-1.5 text-[11px] text-slate-600">Topp {shown === entries ? 10 : shown.length}, {partikod ? (parties.get(partikod)?.forkortning ?? partikod) : 'alla partier'}.</p>}
    </div>
  )
}
