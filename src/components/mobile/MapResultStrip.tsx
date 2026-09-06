// Kompakt resultatremsa ÖVER kartan på mobil.
//
// Problemet: på Karta-fliken syns inga siffror alls — kartan färgar vinnare per distrikt,
// men "hur går det totalt?" kräver ett flikbyte till Resultat. Remsan ger svaret utan att
// lämna kartan, på minsta möjliga yta.
//
// Två rader, båda BARA 2026 (ingen 2022-jämförelse, inga mandat — det finns i Resultat):
//   1. valtypens toppnivå (RD → Riket, RF → länet, KF → kommunen)
//   2. det område kartan står på just nu (kartan zoomar till selectedArea, och ett tapp
//      på ett distrikt sätter samma state → selectedArea ÄR "där man tittar")
// Står man redan på toppnivån är raderna identiska → då visas bara en rad, så remsan
// aldrig kostar höjd den inte använder.
import { useMemo } from 'react'
import { SPARR, buildRows, districtsInArea, mergeVotes, uppsamlingForArea } from '@/lib/aggregate'
import { ancestorsOf } from '@/lib/hierarchy'
import { onDark } from '@/lib/colors'
import { useResults, type Area } from '@/components/ResultsProvider'

// Fem partier ryms på en rad från 360 px och uppåt; på 320 px klipps det femte mitt i
// talet, så där döljs det av .strip-party-5 (ren CSS, ingen JS-mätning). Mätt mot byggd
// CSS på 320/360/375/390/414. Resten läses i Resultat-fliken — de största avgör kvällen.
const MAX_PARTIER = 5

type Row = {
  key: string
  namn: string
  partier: { fork: string; farg: string; andel: number }[]
  reportPct: number
}

export function MapResultStrip() {
  const {
    valtyp,
    selectedArea,
    storesRef,
    partyRef,
    metaRef,
    allCodesRef,
    uppsamlingRef,
    areaIndexRef,
    kommuner,
    regioner,
    valkretsar,
    distriktNamnRef,
    revision,
  } = useResults()

  const areaIndex = areaIndexRef.current[valtyp]

  const rows = useMemo<Row[]>(() => {
    void revision // räkna om vid ny snapshot / strypt Realtime-bump
    const store = storesRef.current[valtyp]

    const namnAv = (a: Area): string => {
      if (a.level === 'riket') return 'Riket'
      if (a.code == null) return ''
      if (a.level === 'distrikt') return distriktNamnRef.current.get(a.code) ?? a.code
      if (a.level === 'valkrets') return valkretsar.find((v) => v.code === a.code)?.name ?? a.code
      if (a.level === 'region') return regioner.find((r) => r.code === a.code)?.name ?? a.code
      return kommuner.find((k) => k.code === a.code)?.name ?? a.code
    }

    // Lean variant av ResultPanels aggregat: bara röstandelar + räknat-andel. Ingen
    // mandatberäkning och ingen 2022-jämförelse — remsan visar bara 2026, så det dyraste
    // i panelen (computeMandate/applyComparison) hoppas över helt.
    const summera = (a: Area): Row | null => {
      const codes = districtsInArea(allCodesRef.current, a.level, a.code, valtyp, metaRef.current)
      if (codes.length === 0) return null
      const votes = mergeVotes(store.aggregate(codes), uppsamlingForArea(valtyp, a.level, a.code, uppsamlingRef.current[valtyp]))
      const res = buildRows(votes, partyRef.current, SPARR[valtyp])
      if (res.giltiga === 0) return null // inget räknat än → ingen rad (hellre tomt än nollor)
      const reported = codes.reduce((n, c) => n + (store.has(c) ? 1 : 0), 0)
      return {
        key: `${a.level}:${a.code ?? ''}`,
        namn: namnAv(a),
        // rows är redan sorterad på röster fallande → de största först.
        partier: res.rows
          .filter((r) => r.forkortning && r.andel > 0)
          .slice(0, MAX_PARTIER)
          .map((r) => ({ fork: r.forkortning!, farg: r.farg ?? '#64748b', andel: r.andel })),
        reportPct: Math.round((reported / codes.length) * 100),
      }
    }

    // ancestorsOf ger kedjan topp→valt. [0] är valtypens egen toppnivå (riket/län/kommun)
    // med rätt kod härledd ur det valda området — så RF/KF, som saknar riksnivå, får sitt
    // län respektive sin kommun som topprad. Längd 1 = man STÅR på toppnivån → en rad.
    const chain = ancestorsOf(valtyp, selectedArea, areaIndex)
    const areas = chain.length <= 1 ? [chain[0] ?? selectedArea] : [chain[0], selectedArea]
    return areas.map(summera).filter((r): r is Row => r !== null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valtyp, selectedArea, revision, areaIndex, kommuner, regioner, valkretsar])

  if (rows.length === 0) return null

  return (
    <div className="shrink-0 border-b border-slate-800 bg-slate-950/95 px-3 py-1.5">
      {rows.map((r) => (
        <div key={r.key} className="flex items-baseline gap-2 py-0.5">
          <span className="w-[62px] shrink-0 truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400" title={r.namn}>
            {r.namn}
          </span>
          <div className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
            {r.partier.map((p, i) => (
              <span
                key={p.fork}
                className={`shrink-0 whitespace-nowrap text-[11px] leading-none tabular-nums ${i === 4 ? 'strip-party-5' : ''}`}
              >
                {/* onDark lyfter mörka partifärger (V, KD) till läsbar ljushet mot den
                    mörka bakgrunden men behåller kulören → färgen kopplar till kartan. */}
                <span className="font-bold" style={{ color: onDark(p.farg) }}>{p.fork}</span>{' '}
                <span className="text-slate-200">{(p.andel * 100).toFixed(1).replace('.', ',')}</span>
              </span>
            ))}
          </div>
          <span
            className="shrink-0 text-[10px] leading-none tabular-nums text-slate-500"
            title={`${r.reportPct} % av distrikten räknade`}
          >
            {r.reportPct} %
          </span>
        </div>
      ))}
    </div>
  )
}
