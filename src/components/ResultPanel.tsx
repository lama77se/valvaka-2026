// Resultattabellens behållare. All data (result, metadata, partifärger, ±2022) och
// delad state (valtyp, valt område) kommer från <ResultsProvider>. Panelen räknar
// om områdesaggregatet när `revision` bumpas (strypt Realtime) och renderar
// <ResultTable>. Områdesväljaren styr delad `selectedArea` (kartklick → drilldown).
import { Fragment, useEffect, useMemo } from 'react'
import { VALTYP_LABEL, type Valtyp } from '@/lib/results'
import {
  SPARR,
  applyComparison,
  applyMandate,
  buildRows,
  collapseForDisplay,
  comparisonFor,
  computeMandate,
  districtsInArea,
} from '@/lib/aggregate'
import { RIKET, defaultAreaFor, useResults, type Area } from '@/components/ResultsProvider'
import { ResultTable } from '@/components/ResultTable'
import { MandatSoffa } from '@/components/MandatSoffa'
import { hareSeats, SPECTRUM } from '@/lib/soffa'
import { ancestorsOf, childGroupsOf, childLevelOf } from '@/lib/hierarchy'
import { REPORTED_NEUTRAL, UNREPORTED_FILL } from '@/components/DistrictMap'

const CHILD_LABEL: Record<string, string> = { valkrets: 'Valkretsar', region: 'Län', kommun: 'Kommuner', distrikt: 'Distrikt' }

const ELECTION: Record<Valtyp, string> = {
  RD: 'Riksdagsvalet',
  RF: 'Regionvalet',
  KF: 'Kommunvalet',
}

// Nivåer väljaren erbjuder per valtyp: den nativa nivån + geografisk nedbrytning
// UNDER den (aldrig uppåt). RD: riket → VALKRETS (riksdagens nivå) → kommun; RF:
// region → VALKRETS (regionens nivå — Stockholm delas tvärs kommuner) → distrikt;
// KF bara kommun.
const LEVELS: Record<Valtyp, ('riket' | 'valkrets' | 'region' | 'kommun')[]> = {
  RD: ['riket', 'valkrets', 'kommun'],
  RF: ['region', 'valkrets'],
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
    valkretsar,
    areaIndexRef,
    distriktNamnRef,
    district2022Ref,
    districtAndel2022Ref,
    ensureDistrictWinners2022,
    revision,
  } = useResults()

  const areaIndex = areaIndexRef.current[valtyp]

  const areaName =
    selectedArea.level === 'riket'
      ? 'Riket'
      : selectedArea.level === 'distrikt'
        ? (distriktNamnRef.current.get(selectedArea.code ?? '') ?? selectedArea.code ?? '')
        : selectedArea.level === 'valkrets'
          ? (valkretsar.find((v) => v.code === selectedArea.code)?.name ?? selectedArea.code ?? '')
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
  const valkretsName = useMemo(() => new Map(valkretsar.map((v) => [v.code, v.name])), [valkretsar])
  const nameOf = (a: { level: string; code: string | null }): string =>
    a.level === 'riket'
      ? 'Riket'
      : a.level === 'valkrets'
        ? valkretsName.get(a.code ?? '') ?? a.code ?? ''
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
    const groups = childGroupsOf(valtyp, selectedArea, allCodesRef.current, areaIndex)
    const comparison = comparisonRef.current
    const pmap = partyRef.current
    // Uppslag för per-parti-kolumnerna: beteckning→förkortning (2022 nycklas på namn),
    // partikod→förkortning (2026-röster), förkortning→färg.
    const betToFork = new Map<string, string>()
    const forkFarg = new Map<string, string>()
    for (const p of pmap.values()) {
      if (p.beteckning && p.forkortning) betToFork.set(p.beteckning, p.forkortning)
      if (p.forkortning && p.farg) forkFarg.set(p.forkortning, p.farg)
    }
    const cols = SPECTRUM.map((fork) => ({ fork, farg: forkFarg.get(fork) ?? REPORTED_NEUTRAL }))

    // 2022 års andel per förkortning för ett barn: aggregatnivåer ur comparison-2022.json,
    // distrikt ur district_result_2022 (batch-hämtat, se effekt nedan).
    const andel2022Of = (level: string, code: string): Record<string, number> => {
      const bet =
        level === 'distrikt'
          ? districtAndel2022Ref.current.get(code)
          : comparison
            ? comparisonFor(comparison, valtyp, level as never, code)?.andel
            : undefined
      const out: Record<string, number> = {}
      if (bet) for (const [b, a] of Object.entries(bet)) { const f = betToFork.get(b); if (f) out[f] = (out[f] ?? 0) + a }
      return out
    }

    const items = groups.map((g) => {
      const votes = store.aggregate(g.districts)
      let total = 0
      for (const v of Object.values(votes)) total += v
      const a26: Record<string, number> = {} // förkortning → andel 2026 (0..1)
      for (const [pk, v] of Object.entries(votes)) { const f = pmap.get(pk)?.forkortning; if (f) a26[f] = (a26[f] ?? 0) + v }
      if (total > 0) for (const f in a26) a26[f] /= total
      const a22 = andel2022Of(g.level, g.code)
      const reported = g.districts.reduce((n, c) => n + (store.has(c) ? 1 : 0), 0)
      const live = total > 0
      // Ledande parti (radens färgmarkering) = största i live-året; grå om lokalt/okänt.
      const src = live ? a26 : a22
      let leadFork: string | null = null
      let topA = 0
      for (const [f, a] of Object.entries(src)) if (a > topA) { topA = a; leadFork = f }
      const leadFarg = leadFork ? forkFarg.get(leadFork) ?? REPORTED_NEUTRAL : reported > 0 ? REPORTED_NEUTRAL : UNREPORTED_FILL
      return { level: g.level, code: g.code, reported, total: g.districts.length, live, a26, a22, leadFarg }
    })
    // childLevel ur de FAKTISKA grupperna (inte den statiska kedjan) — en enkommuns-
    // RD-valkrets kollapsar kommun-nivån → barnen är distrikt, inte kommuner.
    const childLevel = (groups[0]?.level ?? childLevelOf(valtyp, selectedArea.level)) as ReturnType<typeof childLevelOf>
    const anyLive = items.some((it) => it.live) // finns 2026-röster alls? annars visas 2022
    return { childLevel, items, cols, anyLive }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valtyp, selectedArea, revision])

  // Distriktsbarn: batch-hämta deras 2022-vinnare per KOMMUN (aggregatnivåer har 2022
  // synkront). Barnen kan spänna flera kommuner (RF/KF-valkrets skär ej alltid en enda
  // kommun-prefix — t.ex. RF-valkretsen "Nordväst" täcker flera kommuner) → härled
  // kommunkoderna ur barnens distriktskoder, inte ur det valda områdets kod (som kan
  // vara en valkretskod, inte ett valdistrikts-prefix).
  useEffect(() => {
    if (drill.childLevel !== 'distrikt') return
    const kommuner = new Set(drill.items.map((it) => it.code.slice(0, 4)))
    for (const k of kommuner) ensureDistrictWinners2022(valtyp, k)
  }, [drill, valtyp, ensureDistrictWinners2022])

  // Prompt-läge: RF/KF utan valt organ (ingen riksnivå finns för dem).
  const isPrompt = selectedArea.level !== 'riket' && selectedArea.code == null
  const crumbs = ancestorsOf(valtyp, selectedArea, areaIndex)
  const drillItems = [...drill.items].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'sv'))
  const levels = LEVELS[valtyp]
  const selectValue = isPrompt
    ? ''
    : selectedArea.level === 'riket'
      ? 'riket'
      : selectedArea.level === 'distrikt'
        ? `d:${selectedArea.code}`
        : selectedArea.level === 'valkrets'
          ? `vk:${selectedArea.code}`
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
                : v.startsWith('vk:')
                  ? { level: 'valkrets', code: v.slice(3) }
                  : { level: v.startsWith('r:') ? 'region' : 'kommun', code: v.slice(2) }
          setSelectedArea(next)
        }}
      >
        {selectedArea.level === 'distrikt' && (
          <option value={`d:${selectedArea.code}`}>Distrikt: {areaName}</option>
        )}
        {selectedArea.level === 'valkrets' && !levels.includes('valkrets') && (
          // KF-valkrets når man via drill (kommun→valkrets), inte i den platta listan
          // (~313 st, mest 1-per-kommun) → syntetisk nuvarande-option så select:en inte tappar värdet.
          <option value={`vk:${selectedArea.code}`}>Valkrets: {areaName}</option>
        )}
        {levels.includes('riket') ? (
          <option value="riket">Riket</option>
        ) : (
          <option value="">{PROMPT[valtyp]}</option>
        )}
        {levels.includes('valkrets') && (
          <optgroup label="Valkrets">
            {valkretsar.map((v) => (
              // RF-valkretsnamn ("Nordväst") är region-lokala → prefixa med regionen i
              // den platta listan; i breadcrumb/drill räcker namnet (regionen är förälder).
              <option key={v.code} value={`vk:${v.code}`}>
                {valtyp === 'RF' ? `${regionName.get(v.code.slice(0, 2)) ?? ''} · ${v.name}` : v.name}
              </option>
            ))}
          </optgroup>
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
                <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  Bryt ner — {CHILD_LABEL[drill.childLevel] ?? drill.childLevel}
                  {drill.anyLive ? (
                    <span className="font-normal normal-case tracking-normal text-slate-500">
                      2026 andel % · <span className="text-emerald-400/80">▲</span>/<span className="text-rose-400/80">▼</span> mot ’22
                    </span>
                  ) : (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-amber-300/90">
                      2022 års resultat — inga 2026-röster än
                    </span>
                  )}
                </p>
                {/* Per-parti-matris: en kolumn per riksdagsparti (spektrumordning), andel %
                    för live-året + Δ mot 2022 under. Ingen egen max-höjd — listan fyller panelen. */}
                <table className="w-full border-separate border-spacing-0 text-[11px] tabular-nums">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="pb-1 pr-1 text-left font-medium">Område</th>
                      {drill.cols.map((c) => (
                        <th key={c.fork} className="px-0.5 pb-1 text-center font-bold" style={{ color: c.farg }} title={c.fork}>
                          {c.fork}
                        </th>
                      ))}
                      <th className="pb-1 pl-1 text-right font-medium">Räkn.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillItems.map((it) => {
                      // I en delvis inrapporterad lista (anyLive) visar rader utan egna
                      // 2026-röster fortfarande 2022 års siffror. Utan markör ser de
                      // identiska ut med live-2026-rader → ambertona siffrorna + '22-tagg
                      // (samma språk som rubrikens "2022 års resultat"-badge).
                      const stale = drill.anyLive && !it.live
                      return (
                      <tr
                        key={it.code}
                        className="cursor-pointer hover:bg-slate-800/50"
                        onClick={() => setSelectedArea({ level: it.level, code: it.code })}
                      >
                        <td
                          className="max-w-[104px] truncate border-l-2 py-0.5 pl-1.5 pr-1 text-left text-slate-200"
                          style={{ borderColor: it.leadFarg }}
                          title={nameOf(it)}
                        >
                          {nameOf(it)}
                          {stale && (
                            <span className="ml-1 rounded bg-amber-500/15 px-1 text-[9px] font-semibold text-amber-300/90" title="Inga 2026-röster än — visar 2022 års resultat">
                              ’22
                            </span>
                          )}
                        </td>
                        {drill.cols.map((c) => {
                          const v26 = it.a26[c.fork]
                          const v22 = it.a22[c.fork]
                          const main = it.live ? v26 : v22
                          const d = it.live && v26 != null && v22 != null ? (v26 - v22) * 100 : null
                          const has = main && main > 0.0005
                          return (
                            <td key={c.fork} className="px-0.5 py-0.5 text-center align-top leading-tight">
                              <div className={!has ? 'text-slate-600' : stale ? 'italic text-amber-300/70' : 'text-slate-200'}>
                                {has ? (main * 100).toFixed(1) : '·'}
                              </div>
                              {d != null && Math.abs(d) >= 0.05 && (
                                <div className={`text-[9px] leading-none ${d > 0 ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                                  {d > 0 ? '+' : '−'}
                                  {Math.abs(d).toFixed(1)}
                                </div>
                              )}
                            </td>
                          )
                        })}
                        <td className="whitespace-nowrap py-0.5 pl-1 text-right text-slate-500">
                          {it.level === 'distrikt' ? (
                            it.reported > 0 ? <span className="text-emerald-400" title="räknat">✓</span> : <span title="ej räknat">·</span>
                          ) : (
                            <span title={`${it.reported} av ${it.total} distrikt räknade`}>
                              {it.reported}/{it.total}
                            </span>
                          )}
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
