// Resultattabellens behållare. All data (result, metadata, partifärger, ±2022) och
// delad state (valtyp, valt område) kommer från <ResultsProvider>. Panelen räknar
// om områdesaggregatet när `revision` bumpas (strypt Realtime) och renderar
// <ResultTable>. Områdesväljaren styr delad `selectedArea` (kartklick → drilldown).
import { Fragment, useMemo } from 'react'
import { VALTYP_LABEL, type Valtyp } from '@/lib/results'
import {
  SPARR,
  applyComparison,
  applyMandate,
  buildRows,
  collapseForDisplay,
  computeMandate,
  districtsInArea,
} from '@/lib/aggregate'
import { RIKET, defaultAreaFor, useResults, type Area } from '@/components/ResultsProvider'
import { ResultTable } from '@/components/ResultTable'
import { MandatSoffa } from '@/components/MandatSoffa'
import { hareSeats } from '@/lib/soffa'
import { ancestorsOf, childGroupsOf, childLevelOf } from '@/lib/hierarchy'
import { REPORTED_NEUTRAL, UNREPORTED_FILL } from '@/components/DistrictMap'

const CHILD_LABEL: Record<string, string> = { region: 'Län', kommun: 'Kommuner', distrikt: 'Distrikt' }

const ELECTION: Record<Valtyp, string> = {
  RD: 'Riksdagsvalet',
  RF: 'Regionvalet',
  KF: 'Kommunvalet',
}

// Nivåer väljaren erbjuder per valtyp: den nativa nivån + geografisk nedbrytning
// UNDER den (aldrig uppåt). RD kan visa riket/län/kommun; RF region + kommun inom;
// KF bara kommun.
const LEVELS: Record<Valtyp, ('riket' | 'region' | 'kommun')[]> = {
  RD: ['riket', 'region', 'kommun'],
  RF: ['region', 'kommun'],
  KF: ['kommun'],
}
const PROMPT: Record<Valtyp, string> = { RD: '', RF: 'Välj region…', KF: 'Välj kommun…' }

export function ResultPanel() {
  const {
    valtyp,
    selectedArea,
    setSelectedArea,
    storesRef,
    metaRef,
    partyRef,
    allCodesRef,
    groupsRef,
    comparisonRef,
    kommuner,
    regioner,
    distriktNamnRef,
    district2022Ref,
    revision,
  } = useResults()

  const areaName =
    selectedArea.level === 'riket'
      ? 'Riket'
      : selectedArea.level === 'distrikt'
        ? (distriktNamnRef.current.get(selectedArea.code ?? '') ?? selectedArea.code ?? '')
        : selectedArea.level === 'region'
          ? (regioner.find((r) => r.code === selectedArea.code)?.name ?? selectedArea.code ?? '')
          : (kommuner.find((k) => k.code === selectedArea.code)?.name ?? selectedArea.code ?? '')

  const view = useMemo(() => {
    void revision // beroende: räkna om vid ny snapshot / strypt Realtime-bump
    const store = storesRef.current[valtyp]
    const codes = districtsInArea(allCodesRef.current, selectedArea.level, selectedArea.code, valtyp, metaRef.current)
    const votes = store.aggregate(codes)
    const mandate = computeMandate(valtyp, selectedArea.level, selectedArea.code, (c) => store.aggregate(c), groupsRef.current)
    let areaResult = applyMandate(buildRows(votes, partyRef.current, SPARR[valtyp]), mandate)
    const districtLeaf =
      selectedArea.level === 'distrikt' && selectedArea.code
        ? district2022Ref.current.get(`${valtyp}:${selectedArea.code}`) ?? null
        : null
    areaResult = applyComparison(areaResult, valtyp, selectedArea.level, selectedArea.code, comparisonRef.current, partyRef.current, districtLeaf)
    const display = collapseForDisplay(areaResult)
    const reported = codes.reduce((n, c) => n + (store.has(c) ? 1 : 0), 0)
    const has2022 = areaResult.rows.some((r) => r.andel2022 != null)
    const seats = areaResult.rows
      .filter((r) => (r.mandat ?? 0) > 0)
      .map((r) => ({ forkortning: r.forkortning, farg: r.farg, mandat: r.mandat as number }))
    // Ungefärlig procent-soffa (100 platser) där inget organ fördelas — RD@län/kommun,
    // distriktsklick. Ren proportion (largest-remainder), ingen spärr; tydligt märkt.
    const approxSeats =
      areaResult.totalMandat == null && areaResult.giltiga > 0
        ? (() => {
            const weights: Record<string, number> = {}
            for (const r of areaResult.rows) weights[r.partikod] = r.roster
            const alloc = hareSeats(weights, 100)
            return areaResult.rows
              .filter((r) => (alloc[r.partikod] ?? 0) > 0)
              .map((r) => ({ forkortning: r.forkortning, farg: r.farg, mandat: alloc[r.partikod] }))
          })()
        : []
    // 2022 som jämförelse-baslinje innan 2026 kommit in: fylld soffa ur mandat2022 där
    // organet fördelades, annars ihålig procent-soffa ur andel2022 (län/distrikt).
    const seats2022 =
      areaResult.totalMandat2022 != null && areaResult.totalMandat2022 > 0
        ? areaResult.rows
            .filter((r) => (r.mandat2022 ?? 0) > 0)
            .map((r) => ({ forkortning: r.forkortning, farg: r.farg, mandat: r.mandat2022 as number }))
        : []
    const approxSeats2022 =
      seats2022.length === 0 && has2022
        ? (() => {
            const weights: Record<string, number> = {}
            for (const r of areaResult.rows) if (r.andel2022 != null) weights[r.partikod] = r.andel2022
            const alloc = hareSeats(weights, 100)
            return areaResult.rows
              .filter((r) => (alloc[r.partikod] ?? 0) > 0)
              .map((r) => ({ forkortning: r.forkortning, farg: r.farg, mandat: alloc[r.partikod] }))
          })()
        : []
    return {
      display,
      giltiga: areaResult.giltiga,
      totalMandat: areaResult.totalMandat,
      totalMandat2022: areaResult.totalMandat2022,
      seats,
      approxSeats,
      seats2022,
      approxSeats2022,
      has2022,
      reported,
      total: codes.length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valtyp, selectedArea, revision])

  const pct = view.total > 0 ? Math.round((view.reported / view.total) * 100) : 0

  // Två soffbilder sida vid sida: 2026 (live) OCH 2022 (förra valet, som jämförelse) —
  // 2022 ligger kvar även efter att 2026 börjat räknas. Varje sida är fylld soffa där
  // ett organ fördelas, annars ihålig procent-soffa (röstandel).
  const show2026 = (view.totalMandat != null && view.totalMandat > 0 && view.seats.length > 0) || view.approxSeats.length > 0
  const show2022 = view.seats2022.length > 0 || view.approxSeats2022.length > 0
  const bothSoffor = show2026 && show2022
  const node2026 = !show2026 ? null : view.totalMandat != null && view.totalMandat > 0 && view.seats.length > 0 ? (
    <MandatSoffa seats={view.seats} total={view.totalMandat} badge={bothSoffor ? '2026' : undefined} reportPct={pct} />
  ) : (
    <MandatSoffa seats={view.approxSeats} total={100} approx badge={bothSoffor ? '2026 · ungefärlig' : undefined} reportPct={pct} />
  )
  const node2022 = !show2022 ? null : view.seats2022.length > 0 ? (
    <MandatSoffa seats={view.seats2022} total={view.totalMandat2022 as number} badge="2022" />
  ) : (
    <MandatSoffa seats={view.approxSeats2022} total={100} approx badge="2022 · ungefärlig" />
  )

  // Områdesnamn-uppslag för breadcrumb + barnlista.
  const regionName = useMemo(() => new Map(regioner.map((r) => [r.code, r.name])), [regioner])
  const kommunName = useMemo(() => new Map(kommuner.map((k) => [k.code, k.name])), [kommuner])
  const nameOf = (a: { level: string; code: string | null }): string =>
    a.level === 'riket'
      ? 'Riket'
      : a.level === 'region'
        ? regionName.get(a.code ?? '') ?? a.code ?? ''
        : a.level === 'kommun'
          ? kommunName.get(a.code ?? '') ?? a.code ?? ''
          : distriktNamnRef.current.get(a.code ?? '') ?? a.code ?? ''

  // Drill-down: breadcrumb (uppåt) + barnens sammanfattning (nedåt). Barn-summeringen
  // är enhetlig för alla nivåer: ledande parti = argmax(aggregat), rapporterat = andel
  // av barnets distrikt som räknats. Nyckas på revision (strypt Realtime).
  const drill = useMemo(() => {
    void revision
    const store = storesRef.current[valtyp]
    const groups = childGroupsOf(valtyp, selectedArea, allCodesRef.current)
    const items = groups.map((g) => {
      const votes = store.aggregate(g.districts)
      let winner: string | null = null
      let top = -1
      let sum = 0
      for (const [p, v] of Object.entries(votes)) {
        sum += v
        if (v > top) {
          top = v
          winner = p
        }
      }
      const reported = g.districts.reduce((n, c) => n + (store.has(c) ? 1 : 0), 0)
      return { level: g.level, code: g.code, winner, share: sum > 0 ? top / sum : 0, reported, total: g.districts.length }
    })
    return { childLevel: childLevelOf(valtyp, selectedArea.level), items }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valtyp, selectedArea, revision])

  // Prompt-läge: RF/KF utan valt organ (ingen riksnivå finns för dem).
  const isPrompt = selectedArea.level !== 'riket' && selectedArea.code == null
  const crumbs = ancestorsOf(valtyp, selectedArea)
  const drillItems = [...drill.items].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'sv'))
  const levels = LEVELS[valtyp]
  const selectValue = isPrompt
    ? ''
    : selectedArea.level === 'riket'
      ? 'riket'
      : selectedArea.level === 'distrikt'
        ? `d:${selectedArea.code}`
        : `${selectedArea.level === 'region' ? 'r' : 'k'}:${selectedArea.code}`

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      {/* Områdesväljare: valtyp-medveten (valtyp styrs från kartan). RD → Riket +
          nedbrytning; RF → region + kommun inom; KF → bara kommun. */}
      <select
        className="rounded-md border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-100"
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value
          if (v.startsWith('d:')) return // distrikt sätts via kartklick, inte listan
          const next: Area =
            v === ''
              ? defaultAreaFor(valtyp)
              : v === 'riket'
                ? RIKET
                : { level: v.startsWith('r:') ? 'region' : 'kommun', code: v.slice(2) }
          setSelectedArea(next)
        }}
      >
        {selectedArea.level === 'distrikt' && (
          <option value={`d:${selectedArea.code}`}>Distrikt: {areaName}</option>
        )}
        {levels.includes('riket') ? (
          <option value="riket">Riket</option>
        ) : (
          <option value="">{PROMPT[valtyp]}</option>
        )}
        {levels.includes('region') && (
          <optgroup label="Region / län">
            {regioner.map((r) => (
              <option key={r.code} value={`r:${r.code}`}>{r.name}</option>
            ))}
          </optgroup>
        )}
        {levels.includes('kommun') && (
          <optgroup label="Kommun">
            {kommuner.map((k) => (
              <option key={k.code} value={`k:${k.code}`}>{k.name}</option>
            ))}
          </optgroup>
        )}
      </select>

      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {isPrompt ? (
          <p className="mt-8 text-center text-sm text-slate-400">
            Välj {valtyp === 'RF' ? 'en region' : 'en kommun'} i listan ovan — eller klicka i kartan.
          </p>
        ) : (
          <>
            {crumbs.length > 1 && (
              <nav className="mb-2 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-slate-400">
                {crumbs.map((c, i) => {
                  const last = i === crumbs.length - 1
                  return (
                    <Fragment key={`${c.level}:${c.code}`}>
                      {i > 0 && <span className="text-slate-600">›</span>}
                      {last ? (
                        <span className="font-semibold text-slate-200">{nameOf(c)}</span>
                      ) : (
                        <button
                          type="button"
                          className="rounded hover:text-sky-300 hover:underline"
                          onClick={() => setSelectedArea(c.level === 'riket' ? RIKET : { level: c.level, code: c.code })}
                        >
                          {nameOf(c)}
                        </button>
                      )}
                    </Fragment>
                  )
                })}
              </nav>
            )}
            {(node2026 || node2022) && (
              <div className="mb-3 border-b border-slate-800 pb-3">
                <div className={bothSoffor ? 'grid grid-cols-2 gap-2' : ''}>
                  {node2026}
                  {node2022}
                </div>
              </div>
            )}
            <ResultTable
              title={`${ELECTION[valtyp]} — ${areaName}`}
              subtitle={`${view.reported.toLocaleString('sv-SE')} av ${view.total.toLocaleString('sv-SE')} distrikt räknade (${pct} %)`}
              display={view.display}
              giltiga={view.giltiga}
              sparr={SPARR[valtyp]}
              showSparr={selectedArea.level !== 'distrikt'}
              totalMandat={view.totalMandat}
              totalMandat2022={view.totalMandat2022}
            />
            {view.giltiga === 0 &&
              (view.has2022 ? (
                <p className="mt-4 text-center text-xs text-slate-500">
                  Inga 2026-röster inrapporterade än — <span className="text-slate-400">2022</span>-kolumnerna visar
                  förra valets slutresultat.
                </p>
              ) : (
                <p className="mt-4 text-center text-xs text-slate-500">
                  Inga resultat inrapporterade för {VALTYP_LABEL[valtyp].toLowerCase()} i {areaName} än.
                </p>
              ))}

            {drill.childLevel && drillItems.length > 0 && (
              <div className="mt-3 border-t border-slate-800 pt-3">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  Bryt ner — {CHILD_LABEL[drill.childLevel] ?? drill.childLevel}
                </p>
                <ul className="max-h-56 space-y-0.5 overflow-auto pr-1">
                  {drillItems.map((it) => {
                    const p = it.winner ? partyRef.current.get(it.winner) : null
                    const farg = p?.farg ?? REPORTED_NEUTRAL
                    return (
                      <li key={it.code}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-slate-800/50"
                          style={{ borderLeft: `3px solid ${it.reported > 0 ? farg : UNREPORTED_FILL}` }}
                          onClick={() => setSelectedArea({ level: it.level, code: it.code })}
                        >
                          <span className="flex-1 truncate text-xs text-slate-200">{nameOf(it)}</span>
                          {p && it.reported > 0 ? (
                            <span className="shrink-0 text-[11px] font-semibold" style={{ color: farg }}>
                              {p.forkortning ?? '?'}
                            </span>
                          ) : (
                            <span className="shrink-0 text-[11px] text-slate-600">—</span>
                          )}
                          {it.level === 'distrikt' ? (
                            // Lövnivå: nämnaren är alltid 1 → visa status i stället för "X/1".
                            <span className={`w-16 shrink-0 text-right text-[11px] ${it.reported > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                              {it.reported > 0 ? 'räknat' : 'ej räknat'}
                            </span>
                          ) : (
                            <span
                              className="w-16 shrink-0 text-right text-[11px] tabular-nums text-slate-500"
                              title={`${it.reported} av ${it.total} distrikt räknade`}
                            >
                              {it.reported}/{it.total}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
