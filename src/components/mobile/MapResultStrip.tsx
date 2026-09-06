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
import { SPARR, applyComparison, buildRows, districtsInArea, mergeVotes, uppsamlingForArea } from '@/lib/aggregate'
import { ancestorsOf } from '@/lib/hierarchy'
import { onDark } from '@/lib/colors'
import { deltaColor, formatDeltaCompact } from '@/lib/delta'
import { useResults, type Area } from '@/components/ResultsProvider'

// Alla åtta riksdagspartier renderas; hur många som SYNS avgörs av skärmbredden via
// .strip-party-6/7/8 (ren CSS-tröskel, ingen JS-mätning). Siffrorna är 10 px och etiketten
// 44 px — det är vad som krävs för att få in ALLA ÅTTA på en vanlig telefon (390 px). Vid
// 11 px behövde åtta partier 412 px, och etikettbredden ensam räckte inte dit.
// Uppmätt minsta bredd mot byggd CSS, jämförelseraden inräknad:
//   5 partier 269 px · 6 partier 310 px · 7 partier 353 px · 8 partier 384 px
// I praktiken: 320 → 5, 360/375 → 7, 390 och uppåt → alla åtta.
const MAX_PARTIER = 8

// Lokala partier (KF) kan ha längre förkortningar än riksdagens 1–2 tecken. Kapa så en
// udda förkortning inte kan trycka ut resten av raden; fullständigt namn ligger i title.
const kortaNer = (f: string) => (f.length > 5 ? f.slice(0, 4) + '…' : f)

type Row = {
  key: string
  namn: string
  // delta = ±procentenheter mot 2022. Bara satt på toppnivåraden när remsan visar EN rad
  // (ingen drilldown) — då finns höjden över för en jämförelserad, och 2022 hämtas ur den
  // statiska comparison-filen (aggregatnivå) utan någon extra fråga.
  partier: { fork: string; farg: string; andel: number; delta: number | null; ny: boolean }[]
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
    comparisonRef,
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
    const summera = (a: Area, medDelta: boolean): Row | null => {
      const codes = districtsInArea(allCodesRef.current, a.level, a.code, valtyp, metaRef.current)
      if (codes.length === 0) return null
      const votes = mergeVotes(store.aggregate(codes), uppsamlingForArea(valtyp, a.level, a.code, uppsamlingRef.current[valtyp]))
      let res = buildRows(votes, partyRef.current, SPARR[valtyp])
      if (res.giltiga === 0) return null // inget räknat än → ingen rad (hellre tomt än nollor)
      // applyComparison bara när jämförelseraden faktiskt ritas. Toppnivåerna slår upp
      // 2022 i den statiska comparison-filen (rena map-uppslag) — distriktsnivå, som hade
      // krävt en DB-hämtning, når vi aldrig här eftersom delta bara gäller enradsläget.
      if (medDelta) res = applyComparison(res, valtyp, a.level, a.code, comparisonRef.current, partyRef.current, null)
      return {
        key: `${a.level}:${a.code ?? ''}`,
        namn: namnAv(a),
        // rows är redan sorterad på röster fallande → de största först.
        partier: res.rows
          .filter((r) => r.forkortning && r.andel > 0)
          .slice(0, MAX_PARTIER)
          .map((r) => ({ fork: r.forkortning!, farg: r.farg ?? '#64748b', andel: r.andel, delta: medDelta ? r.deltaAndel : null, ny: medDelta && r.ny })),
      }
    }

    // ancestorsOf ger kedjan topp→valt. [0] är valtypens egen toppnivå (riket/län/kommun)
    // med rätt kod härledd ur det valda området — så RF/KF, som saknar riksnivå, får sitt
    // län respektive sin kommun som topprad. Längd 1 = man STÅR på toppnivån → en rad.
    const chain = ancestorsOf(valtyp, selectedArea, areaIndex)
    // Enradsläge (ingen drilldown) → toppnivån får en jämförelserad mot 2022 under sig.
    // Vid drilldown är höjden redan uppbokad av rad två, så då utgår jämförelsen.
    const enRad = chain.length <= 1
    const areas: [Area, boolean][] = enRad ? [[chain[0] ?? selectedArea, true]] : [[chain[0], false], [selectedArea, false]]
    return areas.map(([a, d]) => summera(a, d)).filter((r): r is Row => r !== null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valtyp, selectedArea, revision, areaIndex, kommuner, regioner, valkretsar])

  if (rows.length === 0) return null

  return (
    <div className="shrink-0 border-b border-slate-800 bg-slate-950/95 px-3 py-1.5">
      {rows.map((r) => {
        // Jämförelseraden ritas bara när det finns något att jämföra med (saknad
        // comparison-fil → alla delta null → en rad med bara "–" är sämre än ingen rad).
        const visarDelta = r.partier.some((p) => p.delta != null || p.ny)
        return (
          <div key={r.key} className="flex items-baseline gap-2 py-0.5">
            <span className="w-[44px] shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400" title={r.namn}>
              <span className="block truncate">{r.namn}</span>
              {visarDelta && <span className="mt-0.5 block font-normal normal-case tracking-normal text-slate-500">±2022</span>}
            </span>
            <div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
              {r.partier.map((p, i) => (
                // Varje parti är en KOLUMN: andelen överst, ±2022 rakt under. Kolumnen blir
                // så bred som sin bredaste rad, så jämförelsen hamnar alltid under sitt eget
                // parti utan grid — och .strip-party-N kan fortsätta dölja hela kolumner.
                <span
                  key={p.fork}
                  title={`${p.fork} ${(p.andel * 100).toFixed(1).replace('.', ',')} %`}
                  className={`shrink-0 whitespace-nowrap text-[10px] leading-none tabular-nums ${i >= 5 ? `strip-party-${i + 1}` : ''}`}
                >
                  {/* onDark lyfter mörka partifärger (V, KD) till läsbar ljushet mot den
                      mörka bakgrunden men behåller kulören → färgen kopplar till kartan. */}
                  <span className="block">
                    <span className="font-bold" style={{ color: onDark(p.farg) }}>{kortaNer(p.fork)}</span>{' '}
                    <span className="text-slate-200">{(p.andel * 100).toFixed(1).replace('.', ',')}</span>
                  </span>
                  {/* Samma format och färger som resultattabellens ±-kolumn (lib/delta.ts):
                      grönt uppåt, rött nedåt, dämpat vid stiltje, "ny" i amber. */}
                  {visarDelta && (
                    <span className={`mt-0.5 block ${p.ny ? 'text-amber-400' : deltaColor(p.delta)}`}>
                      {p.ny ? 'ny' : formatDeltaCompact(p.delta)}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
