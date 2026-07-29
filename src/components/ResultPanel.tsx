// Resultattabellens behållare. All data (result, metadata, partifärger, ±2022) och
// delad state (valtyp, valt område) kommer från <ResultsProvider>. Panelen räknar
// om områdesaggregatet när `revision` bumpas (strypt Realtime) och renderar
// <ResultTable>. Områdesväljaren styr delad `selectedArea` (kartklick → drilldown).
import { useMemo } from 'react'
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
    return {
      display,
      giltiga: areaResult.giltiga,
      totalMandat: areaResult.totalMandat,
      totalMandat2022: areaResult.totalMandat2022,
      has2022,
      reported,
      total: codes.length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valtyp, selectedArea, revision])

  const pct = view.total > 0 ? Math.round((view.reported / view.total) * 100) : 0

  // Prompt-läge: RF/KF utan valt organ (ingen riksnivå finns för dem).
  const isPrompt = selectedArea.level !== 'riket' && selectedArea.code == null
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
          </>
        )}
      </div>
    </div>
  )
}
