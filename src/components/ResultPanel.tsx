// Resultattabellens behållare. All data (result, metadata, partifärger, ±2022) och
// delad state (valtyp, valt område) kommer från <ResultsProvider>. Panelen räknar
// om områdesaggregatet när `revision` bumpas (strypt Realtime) och renderar
// <ResultTable>. Områdesväljaren styr delad `selectedArea` (kartklick → drilldown).
import { Fragment, useEffect, useMemo, useState } from 'react'
import { VALTYP_LABEL, type Valtyp } from '@/lib/results'
import { comparisonFor, mergeVotes, sparrFor, uppsamlingCountsForArea, uppsamlingEntriesFor, uppsamlingRowFor, uppsamlingSuffix, type Level } from '@/lib/aggregate'
import { RIKET, useResults } from '@/components/ResultsProvider'
import { ResultTable } from '@/components/ResultTable'
import { MandatBars } from '@/components/MandatBars'
import { MarginalSeatChips } from '@/components/MarginalSeatChips'
import { SPECTRUM } from '@/lib/soffa'
import { onDark } from '@/lib/colors'
import { ancestorsOf, childGroupsOf, childLevelOf } from '@/lib/hierarchy'
import { REPORTED_NEUTRAL, UNREPORTED_FILL } from '@/components/DistrictMap'
import { useAreaView } from '@/components/useAreaView'
import { AreaSelect } from '@/components/AreaSelect'
import { PersonrosterPanel } from '@/components/PersonrosterPanel'
import {
  fetchUppsamlingDetail,
  fetchUppsamlingPersonroster,
  fetchUppsamlingSummaries,
  type UppsamlingDetail,
  type UppsamlingPersonrosterRow,
  type UppsamlingSummary,
} from '@/lib/uppsamlingDrill'

const CHILD_LABEL: Record<string, string> = { valkrets: 'Valkretsar', region: 'Län', kommun: 'Kommuner', distrikt: 'Distrikt' }

const ELECTION: Record<Valtyp, string> = {
  RD: 'Riksdagsvalet',
  RF: 'Regionvalet',
  KF: 'Kommunvalet',
}

// `compact` sätts av mobil-layouten: samma panel, men de mest breddkänsliga delarna
// (blockrutorna i MandatBars) kortas ner så de ryms på en rad i halva mobilbredden.
export function ResultPanel({ compact = false }: { compact?: boolean } = {}) {
  const {
    valtyp,
    selectedArea,
    setSelectedArea,
    storesRef,
    turnoutStoresRef,
    partyRef,
    allCodesRef,
    groupsRef,
    uppsamlingRef,
    uppsamlingRegistryRef,
    uppsamlingRegistryReportedRef,
    comparisonRef,
    kommuner,
    regioner,
    valkretsar,
    areaIndexRef,
    distriktNamnRef,
    districtAndel2022Ref,
    ensureDistrictWinners2022,
    revision,
  } = useResults()

  // Undertexten är samtidigt progress-baren, så varje tecken kostar höjd: spricker den
  // till två rader blir baren dubbelt så hög. Mobilvarianten kortar ner den ("av" → "/",
  // "valdistrikt räknade" → "distrikt", "uppsamling" → "upps.") av samma skäl.
  // Valdeltagandet bor INTE här längre — det flyttade till den annars tomma ytan ovanför
  // Parti/Röster i tabellhuvudet (se `turnoutLabel`).
  const subtitle = (reported: number, total: number, pct: number, uppTotal = 0, uppReported = 0) => {
    const r = reported.toLocaleString('sv-SE')
    const t = total.toLocaleString('sv-SE')
    // "Bara uppsamling kvar" (handover 14 sep, Lars: "gör det tydligt när preliminärt når
    // den punkten att BARA uppsamling är det enda som är kvar att räkna") — ersätter den
    // annars missvisande "varav X uppsamling" (som inte skiljer på redan räknad vs.
    // kvarstående) med en explicit "återstår"-text när det verkligen är det enda kvar.
    const { uppRemaining, onlyUppLeft } = uppsamlingSuffix(reported, total, uppTotal, uppReported)
    if (compact) {
      const suffix = onlyUppLeft
        ? `, ${uppRemaining.toLocaleString('sv-SE')} upps. återstår`
        : uppTotal > 0
          ? `, varav ${uppTotal.toLocaleString('sv-SE')} upps.`
          : ''
      return `${r}/${t} distrikt (${pct} %)${suffix}`
    }
    const varavUpp = onlyUppLeft
      ? `, varav endast ${uppRemaining.toLocaleString('sv-SE')} uppsamling återstår`
      : uppTotal > 0
        ? `, varav ${uppTotal.toLocaleString('sv-SE')} uppsamling`
        : ''
    return `${r} av ${t} valdistrikt räknade (${pct} %)${varavUpp}`
  }

  // Samma yta i tabellhuvudet oavsett layout — mobilen kortar bara ordvalet.
  const turnoutLabel = (turnout: number | null) => {
    if (turnout == null) return undefined
    const vd = turnout.toLocaleString('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    return compact ? `${vd} % röstade` : `Valdeltagande ${vd} %`
  }


  // Röster/mandat/valdeltagande/blockvy för valt område — delad ren beräkning
  // (src/lib/areaView.ts) via useAreaView, samma logik som förut men nu återanvänd
  // av Dashboard-vyns rutor också.
  const av = useAreaView(valtyp, selectedArea)
  const areaIndex = areaIndexRef.current[valtyp]

  const pct = av.pct
  // Döljer den PRELIMINÄRA rapporteringsbaren/-pillen helt när den redan är 100 % OCH en
  // sluträkning faktiskt pågår (handover 14 sep, Lars uppföljning: "om PREL 100% och SLUT
  // t.ex. 4%, visa bara SLUT 4%") — annars två fyllda barer där den ena permanent visar
  // "100 %" utan ny information. MandatBars' egen "Prognos"-pill hanterar redan detta
  // (villkoret där är `reportPct < 100`, oberoende identiskt) — bara ResultTable:s
  // subtitle/reportPct behöver samma gate här.
  const hidePrel = pct >= 100 && av.slutligState !== 'preliminar'

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

  // Prompt-läge: RF/KF utan valt organ (ingen riksnivå finns för dem) — flyttad hit
  // (används redan nedan i `drill`) från sitt gamla ställe längre ner i filen.
  const isPrompt = selectedArea.level !== 'riket' && selectedArea.code == null

  // Drill-down: breadcrumb (uppåt) + barnens sammanfattning (nedåt). Barn-summeringen
  // är enhetlig för alla nivåer: ledande parti = argmax(aggregat), rapporterat = andel
  // av barnets distrikt som räknats. Nyckas på revision (strypt Realtime).
  //
  // Prompt-läge (RF/KF utan valt organ): det finns ingen ETT-STEG-UPP-nivå att bryta
  // ned FRÅN (RF/KF saknar "riket" i sin HIERARCHY — se hierarchy.ts) — de "barnen"
  // vi vill visa är i stället samtliga TOPPNIVÅ-organ själva (alla 20 regioner/290
  // kommuner), samma index som kartans gruppfärgläge (groupsRef.byLan/byKommun).
  // Detta ger en klickbar "Bryt ner"-lista redan innan användaren valt ett organ —
  // se JSX:en nedan som numera renderar "Bryt ner" OBEROENDE av isPrompt.
  const drill = useMemo(() => {
    void revision
    const store = storesRef.current[valtyp]
    const turnoutStore = turnoutStoresRef.current[valtyp]
    const groups = isPrompt
      ? [...(valtyp === 'RF' ? groupsRef.current.byLan : groupsRef.current.byKommun)].map(([code, districts]) => ({
          level: (valtyp === 'RF' ? 'region' : 'kommun') as Level,
          code,
          districts,
        }))
      : childGroupsOf(valtyp, selectedArea, allCodesRef.current, areaIndex)
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
          ? districtAndel2022Ref.current.get(`${valtyp}:${code}`)
          : comparison
            ? comparisonFor(comparison, valtyp, level as never, code)?.andel
            : undefined
      const out: Record<string, number> = {}
      if (bet) for (const [b, a] of Object.entries(bet)) { const f = betToFork.get(b); if (f) out[f] = (out[f] ?? 0) + a }
      return out
    }

    // childLevel ur de FAKTISKA grupperna (inte den statiska kedjan) — en enkommuns-
    // RD-valkrets kollapsar kommun-nivån → barnen är distrikt, inte kommuner. Beräknad
    // FÖRE `items` (i stället för efter, som tidigare) — behövs redan där för att veta om
    // ett barns EGEN rad ska väga in sin lösta uppsamling (bara valkrets-barn kan, se nedan).
    const childLevel = (groups[0]?.level ?? childLevelOf(valtyp, selectedArea.level)) as ReturnType<typeof childLevelOf>
    const uppsamling = uppsamlingRef.current[valtyp]
    const uppsamlingRegistry = uppsamlingRegistryRef.current[valtyp]
    const uppsamlingReported = uppsamlingRegistryReportedRef.current[valtyp]
    const items = groups.map((g) => {
      // Valkrets-barn: väg in DEN valkretsens LÖSTA uppsamling (kretskod känd) i barnets
      // egen totalrad — samma nesting som val.se gör (fast här i valkretsens totalsumma,
      // inte som en egen distriktsrad — vi har ingen geometri att hänga en sådan på, se
      // Q7/PR). Den OLÖSTA resten (eller hela hinken om barnen INTE är valkretsar) visas i
      // stället i `uppsamlingRow` nedan.
      const votes = mergeVotes(store.aggregate(g.districts), g.level === 'valkrets' ? uppsamling.byValkrets.get(g.code) : null)
      let total = 0
      for (const v of Object.values(votes)) total += v
      // Övriga partier-gapet (se areaView.ts/computeAreaView, PR #172) — samma per-distrikt-
      // summering (distriktets EGEN deklarerade rosterPaverkaMandat.antalRoster minus dess
      // itemiserade röster), men över BARNETS egna distrikt (g.districts) i stället för hela
      // områdets `codes`. Denna "Bryt ner"-beräkning lever i en helt separat kodsväng
      // (mergeVotes+total här, inte buildRows/aggregate.ts) och missades av #172 — utan detta
      // blev barnradernas nämnare (och därmed alla andelar/Δ mot 2022) systematiskt för liten.
      total += g.districts.reduce((sum, vd) => {
        const rpm = turnoutStore.rosterPaverkarMandat(vd)
        if (rpm == null) return sum
        return sum + Math.max(0, rpm - store.outcome(vd).total)
      }, 0)
      const a26: Record<string, number> = {} // förkortning → andel 2026 (0..1)
      for (const [pk, v] of Object.entries(votes)) { const f = pmap.get(pk)?.forkortning; if (f) a26[f] = (a26[f] ?? 0) + v }
      if (total > 0) for (const f in a26) a26[f] /= total
      const a22 = andel2022Of(g.level, g.code)
      // Uppsamlingsdistrikten hör till barnets yta (samma organ-/valkrets-gating som
      // huvudvyns "X av Y" sedan PR #173, se uppsamlingCountsForArea) — annars visade
      // "Räkn."-kolumnen bara de geografiska distrikten, missad av #173 (som bara rörde
      // computeAreaView + de fyra globala platserna, aldrig denna separata Bryt ner-väg).
      const uppCounts = uppsamlingCountsForArea(valtyp, g.level, g.code, uppsamlingRegistry, uppsamlingReported)
      const reported = g.districts.reduce((n, c) => n + (store.has(c) ? 1 : 0), 0) + uppCounts.reported
      const districtCount = g.districts.length + uppCounts.total
      // Slutgiltigt räknade (Lars önskemål 14 sep): EGEN räkning, skild från `reported`
      // ovan (preliminärt inrapporterat). store.isSlutlig(vd) är monotont (kan aldrig gå
      // tillbaka, se result_no_status_downgrade-triggern) — samma källa som SlutligBar/
      // slutligProgress() redan bygger på. Uppsamling har ingen egen per-post slutlig-
      // status i dagens modell → räknas bara mot de geografiska distrikten, inte mot
      // districtCount (som inkluderar uppsamling) — se raden nedan.
      const slutlig = g.districts.reduce((n, c) => n + (store.isSlutlig(c) ? 1 : 0), 0)
      const live = total > 0
      // Ledande parti (radens färgmarkering) = största i 2026; neutral/grå för ännu
      // orapporterade rader (ingen 2022-tonad ram — hela sektionen bygger på 2026).
      const src = live ? a26 : {}
      let leadFork: string | null = null
      let topA = 0
      for (const [f, a] of Object.entries(src)) if (a > topA) { topA = a; leadFork = f }
      const leadFarg = leadFork ? forkFarg.get(leadFork) ?? REPORTED_NEUTRAL : reported > 0 ? REPORTED_NEUTRAL : UNREPORTED_FILL
      return { level: g.level, code: g.code, reported, total: districtCount, uppTotal: uppCounts.total, uppReported: uppCounts.reported, slutlig, slutligTotal: g.districts.length, live, a26, a22, leadFarg }
    })
    const anyLive = items.some((it) => it.live) // finns 2026-röster alls? annars visas 2022
    // Uppsamlingsröster som INTE redan nestades i ett valkrets-barns egen rad ovan → en
    // EGEN rad längst ner i nedbrytningen (organets olösta rest när barnen är valkretsar;
    // annars, som förut, hela hinken — se uppsamlingRowFor). Andel per parti som
    // barnraderna, plus total röster. Icke-geografisk, icke-klickbar.
    const uppBucket = uppsamlingRowFor(valtyp, selectedArea.level, selectedArea.code, uppsamling, childLevel)
    let uppsamlingRow: { total: number; andel: Record<string, number> } | null = null
    if (uppBucket) {
      let total = 0
      for (const v of Object.values(uppBucket)) total += v
      if (total > 0) {
        const andel: Record<string, number> = {}
        for (const [pk, v] of Object.entries(uppBucket)) { const f = pmap.get(pk)?.forkortning; if (f) andel[f] = (andel[f] ?? 0) + v }
        for (const f in andel) andel[f] /= total
        uppsamlingRow = { total, andel }
      }
    }
    return { childLevel, items, cols, anyLive, uppsamlingRow }
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

  const crumbs = ancestorsOf(valtyp, selectedArea, areaIndex)

  // "Bryt ner"-tabellens sortering: default alfabetisk (områdesnamn). Klick på en
  // partikolumn (V/S/MP/…) cyklar samma kolumn högst→lägst → lägst→högst → tillbaka
  // till alfabetisk — samma tre-klicksmönster oavsett nivå (samma tabellkod driver
  // valkretsar/regioner/kommuner/distrikt, se JSX:en nedan). Nollställs vid ny
  // valtyp/område (annars kan en gammal kolumns sortering hänga kvar i fel tabell).
  const [sortCol, setSortCol] = useState<{ fork: string; dir: 'desc' | 'asc' } | null>(null)
  useEffect(() => setSortCol(null), [valtyp, selectedArea])
  const cycleSortCol = (fork: string) => {
    setSortCol((prev) => {
      if (!prev || prev.fork !== fork) return { fork, dir: 'desc' }
      if (prev.dir === 'desc') return { fork, dir: 'asc' }
      return null // tredje klicket på SAMMA kolumn → tillbaka till alfabetisk
    })
  }
  const drillItems = [...drill.items].sort((a, b) => {
    if (sortCol) {
      // Saknar raden ett 2026-tal för kolumnen (orapporterat/inget parti) → sist,
      // oavsett riktning (annars hoppar orapporterade rader överst i stigande läge).
      const aVal = a.live ? a.a26[sortCol.fork] : undefined
      const bVal = b.live ? b.a26[sortCol.fork] : undefined
      if (aVal == null && bVal == null) return nameOf(a).localeCompare(nameOf(b), 'sv')
      if (aVal == null) return 1
      if (bVal == null) return -1
      if (aVal !== bVal) return sortCol.dir === 'desc' ? bVal - aVal : aVal - bVal
    }
    return nameOf(a).localeCompare(nameOf(b), 'sv')
  })
  const uppRow = drill.uppsamlingRow // sena röster för organet → egen rad sist i nedbrytningen

  // Uppsamlingsdrilldown (handover 15 sep, Lars): "Uppsamling"-raden är nu klickbar ner
  // till enskilda uppsamlingsdistrikt, precis som val.se redan gör. HELT SEPARAT från
  // selectedArea/setSelectedArea — uppsamlingsdistrikt är inte en riktig geografisk
  // Area/Level-nivå (ingen egen geometri, se uppsamlingsdistrikt_registry-docstringen) —
  // ett lokalt läge i stället, så den vanliga Bryt ner-vägen (rader/URL/breadcrumbs)
  // förblir helt orörd. list = listan av enskilda distrikt i den klickade bucketen;
  // detail = ETT distrikts egen resultatrad (parti/röster, ingen valdeltagande).
  type UppView = { kind: 'list' } | { kind: 'detail'; kod: string }
  const [uppView, setUppView] = useState<UppView | null>(null)
  useEffect(() => setUppView(null), [valtyp, selectedArea])

  // SAMMA organ-/valkrets-upplösning som avgjorde uppRow ovan (uppsamlingRowFor) — delad
  // uppsamlingOrganKey-regel i aggregate.ts garanterar att listan här alltid är EXAKT de
  // distrikt som ligger bakom den klickade radens summa, aldrig fler/färre.
  const uppEntries = useMemo(
    () => uppsamlingEntriesFor(valtyp, selectedArea.level, selectedArea.code, uppsamlingRegistryRef.current[valtyp], drill.childLevel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valtyp, selectedArea, drill.childLevel, revision],
  )

  const [uppSummaries, setUppSummaries] = useState<Map<string, UppsamlingSummary>>(new Map())
  const [uppListFailed, setUppListFailed] = useState(false)
  useEffect(() => {
    if (uppView?.kind !== 'list') return
    let cancelled = false
    setUppListFailed(false)
    fetchUppsamlingSummaries(valtyp, uppEntries.map((e) => e.kod), partyRef.current)
      .then((m) => { if (!cancelled) setUppSummaries(m) })
      .catch(() => { if (!cancelled) setUppListFailed(true) })
    return () => { cancelled = true }
  }, [uppView, valtyp, uppEntries, partyRef])

  const [uppDetail, setUppDetail] = useState<UppsamlingDetail | null>(null)
  const [uppDetailPersonroster, setUppDetailPersonroster] = useState<UppsamlingPersonrosterRow[]>([])
  const [uppDetailFailed, setUppDetailFailed] = useState(false)
  useEffect(() => {
    if (uppView?.kind !== 'detail') return
    let cancelled = false
    setUppDetailFailed(false)
    setUppDetail(null)
    Promise.all([fetchUppsamlingDetail(valtyp, uppView.kod), fetchUppsamlingPersonroster(valtyp, uppView.kod).catch(() => [])])
      .then(([detail, pr]) => { if (!cancelled) { setUppDetail(detail); setUppDetailPersonroster(pr) } })
      .catch(() => { if (!cancelled) setUppDetailFailed(true) })
    return () => { cancelled = true }
  }, [uppView, valtyp])

  const uppEntryNamn = (kod: string) => uppEntries.find((e) => e.kod === kod)?.namn ?? kod

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      {/* Rad: områdesväljare (vänster) + valtyp-badge (höger) som återbekräftar vilket val
          resultatramen visar — speglar valtyp-väljaren högst upp. Områdesväljaren är valtyp-
          medveten: RD → Riket + nedbrytning; RF → region + kommun inom; KF → bara kommun. */}
      <div className="flex items-center gap-2">
        <AreaSelect valtyp={valtyp} area={selectedArea} areaName={av.areaName} onChange={setSelectedArea} />
        <span
          className="shrink-0 select-none rounded-md border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-sm font-semibold text-sky-200"
          title={ELECTION[valtyp]}
        >
          {VALTYP_LABEL[valtyp]}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {isPrompt ? (
          // Prompt-läge (RF/KF, inget organ valt än): ingen soffa/resultattabell finns
          // att visa (ingen riksnivå för RF/KF) — men "Bryt ner" nedan listar samtliga
          // toppnivå-organ (samma sektion som annars, se isPrompt-hanteringen i `drill`
          // ovan) så man kan klicka sig rakt in i ett resultat därifrån också.
          <p className="mb-2 mt-4 text-center text-sm text-slate-400">
            Välj {valtyp === 'RF' ? 'en region' : 'en kommun'} i listan ovan — eller klicka i kartan/listan nedan.
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
            {valtyp === 'RD' && selectedArea.level !== 'riket' && selectedArea.level !== 'valkrets' && (
              <p className="mb-3 text-xs text-slate-500">
                Riksdagsmandat räknas bara ut på riksnivå — se{' '}
                <button type="button" onClick={() => setSelectedArea(RIKET)} className="underline hover:text-slate-300">
                  Riket
                </button>{' '}
                för mandatfördelning. Här visas bara röstandelen för {av.areaName}.
              </p>
            )}
            {av.giltiga > 0 && (
              <div className="mb-3 border-b border-slate-800 pb-3">
                <MandatBars
                  shown={av.display.shown}
                  ovriga={av.display.ovriga}
                  totalMandat={av.totalMandat}
                  giltiga={av.giltiga}
                  sparr={sparrFor(valtyp, selectedArea.level, selectedArea.code)}
                  reportPct={pct}
                  slutligState={av.slutligState}
                  slutligPct={av.slutligPct}
                  blocks={av.blocks}
                  compact={compact}
                />
              </div>
            )}
            <ResultTable
              title={`${ELECTION[valtyp]} — ${av.areaName}`}
              statusTag={av.statusTag}
              subtitle={hidePrel ? undefined : subtitle(av.reported, av.total, pct, av.uppTotal, av.uppReported)}
              slutligState={av.slutligState}
              slutligPct={av.slutligPct}
              slutligDone={av.slutligDone}
              slutligTotal={av.slutligTotal}
              turnoutLabel={turnoutLabel(av.turnout)}
              turnoutTitle={av.turnoutTitle}
              reportPct={hidePrel ? undefined : av.total > 0 ? (av.reported / av.total) * 100 : 0}
              display={av.display}
              giltiga={av.giltiga}
              invalidVotes={av.invalidVotes}
              sparr={sparrFor(valtyp, selectedArea.level, selectedArea.code)}
              showSparr={selectedArea.level !== 'distrikt'}
              showMandat={av.showMandat}
              totalMandat={av.totalMandat}
              totalMandat2022={av.totalMandat2022}
            />
            {av.giltiga === 0 &&
              (av.has2022 ? (
                <p className="mt-4 text-center text-xs text-slate-500">
                  Inga 2026-röster inrapporterade än — <span className="text-slate-400">2022</span>-kolumnerna visar
                  förra valets slutresultat.
                </p>
              ) : (
                <p className="mt-4 text-center text-xs text-slate-500">
                  Inga resultat inrapporterade för {VALTYP_LABEL[valtyp].toLowerCase()} i {av.areaName} än.
                </p>
              ))}
            {av.marginalSeat && <MarginalSeatChips info={av.marginalSeat} totalMandat={av.totalMandat} party={partyRef.current} compact={compact} />}
          </>
        )}
        {/* "Bryt ner" renders OBEROENDE av isPrompt (se kommentar vid `drill` ovan) —
            RF/KF utan valt organ visar den ändå, med samtliga toppnivå-organ som rader.
            uppView !== null → uppsamlingsdrilldown-vyerna (nedan) tar över i stället,
            den vanliga Bryt ner-tabellen döljs helt så länge man är i den vyn. */}
        {uppView === null && drill.anyLive && drill.childLevel && drillItems.length > 0 && (
              <div className="mt-3 border-t border-slate-800 pt-3">
                <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                  Bryt ner — {CHILD_LABEL[drill.childLevel] ?? drill.childLevel}
                  <span className="text-[12px] font-normal normal-case tracking-normal text-slate-500">
                    2026 andel % · <span className="text-emerald-400/80">▲</span>/<span className="text-rose-400/80">▼</span> mot ’22
                  </span>
                </p>
                {/* Per-parti-matris: en kolumn per riksdagsparti (spektrumordning), andel %
                    för live-året + Δ mot 2022 under. Ingen egen max-höjd — listan fyller panelen. */}
                <table className="w-full border-separate border-spacing-0 text-[13px] tabular-nums">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="pb-1 pr-1 text-left font-medium">Område</th>
                      {drill.cols.map((c) => {
                        const active = sortCol?.fork === c.fork
                        return (
                          <th key={c.fork} className="px-0.5 pb-1 text-center font-bold">
                            <button
                              type="button"
                              onClick={() => cycleSortCol(c.fork)}
                              style={{ color: onDark(c.farg) }}
                              title={
                                active
                                  ? sortCol!.dir === 'desc'
                                    ? `Sorterat på ${c.fork}, högst→lägst — tryck för lägst→högst`
                                    : `Sorterat på ${c.fork}, lägst→högst — tryck för alfabetisk`
                                  : `Sortera på ${c.fork} (2026), högst→lägst`
                              }
                              className={`inline-flex items-center gap-0.5 rounded px-0.5 hover:bg-slate-800/70 ${active ? 'underline decoration-dotted underline-offset-2' : ''}`}
                            >
                              {c.fork}
                              {active && <span className="text-[9px] leading-none">{sortCol!.dir === 'desc' ? '▼' : '▲'}</span>}
                            </button>
                          </th>
                        )
                      })}
                      <th className="pb-1 pl-1 text-right font-medium">Räkn.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillItems.map((it) => {
                      // Hela "Bryt ner" bygger på 2026: sektionen finns bara när någon rad är
                      // live, en rad utan egna 2026-röster visar '·' (aldrig 2022), och 2022
                      // syns enbart som diff (▲/▼) UNDER ett faktiskt 2026-tal.
                      const upp = uppsamlingSuffix(it.reported, it.total, it.uppTotal, it.uppReported)
                      const uppTitleSuffix = upp.onlyUppLeft
                        ? ` (endast ${upp.uppRemaining} uppsamling återstår)`
                        : it.uppTotal > 0
                          ? ` (varav ${it.uppTotal} uppsamling)`
                          : ''
                      return (
                      <tr
                        key={it.code}
                        className="cursor-pointer hover:bg-slate-800/50"
                        onClick={() => setSelectedArea({ level: it.level, code: it.code })}
                      >
                        <td
                          className="max-w-[150px] truncate border-l-2 py-0.5 pl-1.5 pr-1 text-left text-slate-200"
                          style={{ borderColor: it.leadFarg }}
                          title={nameOf(it)}
                        >
                          {nameOf(it)}
                        </td>
                        {drill.cols.map((c) => {
                          const v26 = it.a26[c.fork]
                          const v22 = it.a22[c.fork]
                          const main = it.live ? v26 : undefined
                          const d = it.live && v26 != null && v22 != null ? (v26 - v22) * 100 : null
                          const has = main && main > 0.0005
                          return (
                            <td key={c.fork} className="px-0.5 py-0.5 text-center align-top leading-tight">
                              <div className={!has ? 'text-slate-600' : 'text-slate-200'}>
                                {has ? (main * 100).toFixed(1) : '·'}
                              </div>
                              {d != null && Math.abs(d) >= 0.05 && (
                                <div className={`text-[12px] leading-none ${d > 0 ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                                  {d > 0 ? '+' : '−'}
                                  {Math.abs(d).toFixed(1)}
                                </div>
                              )}
                            </td>
                          )
                        })}
                        <td className="whitespace-nowrap py-0.5 pl-1 text-right align-top leading-tight text-slate-500">
                          {it.level === 'distrikt' ? (
                            // Enskilt distrikt: Lars önskemål 14 sep — samma två-rader-mönster
                            // som gruppraderna nedan (rad 1 = preliminärt, rad 2 = slutgiltigt),
                            // fast som två BOCKAR i stället för X/Y (ett enda distrikt har inget
                            // kvottal att visa). Rad 2 döljs helt förrän distriktet är slutgiltigt.
                            <>
                              <div className={it.reported > 0 ? 'text-sky-400' : ''} title={it.reported > 0 ? 'preliminärt räknat' : 'ej räknat'}>
                                {it.reported > 0 ? '✓' : '·'}
                              </div>
                              {it.slutlig > 0 && (
                                <div className="text-[12px] leading-none text-emerald-400" title="slutgiltigt räknat">✓</div>
                              )}
                            </>
                          ) : (
                            <>
                              {/* Preliminärt inrapporterat — färdigräknat område (alla distrikt
                                  inne) → grön bock + grön text, annars neutral "X/Y". */}
                              <div
                                className={it.total > 0 && it.reported === it.total ? 'text-emerald-400' : ''}
                                title={`${it.reported} av ${it.total} distrikt räknade${uppTitleSuffix}`}
                              >
                                {it.total > 0 && it.reported === it.total && <span className="mr-0.5">✓</span>}
                                {it.reported}/{it.total}
                              </div>
                              {/* Slutgiltigt räknade — EGEN rad (Lars önskemål 14 sep), samma
                                  två-rader-mönster som partikolumnernas andel/±2022. Egen
                                  nämnare (slutligTotal, bara geografiska distrikt — uppsamling
                                  har ingen per-post slutlig-status i dagens modell) i stället för
                                  `total` (som inkluderar uppsamling) — annars skulle en "klar"
                                  grupp visa t.ex. "18/18" preliminärt men "3/23" slutgiltigt, en
                                  förvirrande nämnarskillnad mellan raderna. Döljs helt vid 0 —
                                  samma relevans-gating som Sluträknas-badgen i MandatBars.tsx.
                                  Himmelsblå = pågår, grön = alla geografiska distrikt slutgiltiga. */}
                              {it.slutlig > 0 && (
                                <div
                                  className={`text-[12px] leading-none ${it.slutlig === it.slutligTotal ? 'text-emerald-400' : 'text-sky-400'}`}
                                  title={`${it.slutlig} av ${it.slutligTotal} distrikt slutgiltigt räknade`}
                                >
                                  {it.slutlig}/{it.slutligTotal}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    )})}
                    {uppRow && (
                      // Uppsamlingsröster (sena röster) — visuellt skild från de geografiska
                      // barnen (kursiv, dämpad, streckad neutral kantlinje). Klickbar ner till
                      // enskilda uppsamlingsdistrikt (handover 15 sep, Lars: "precis som val.se
                      // redan gör") när det finns några i den här bucketen (uppEntries) — annars
                      // (borde inte hända i praktiken: uppRow>0 rader betyder röster finns, alltså
                      // ska minst ETT distrikt ligga bakom) ingen klick-handler.
                      <tr
                        className={`border-t border-slate-800 italic text-slate-400 ${uppEntries.length > 0 ? 'cursor-pointer hover:bg-slate-800/50' : ''}`}
                        onClick={uppEntries.length > 0 ? () => setUppView({ kind: 'list' }) : undefined}
                      >
                        <td
                          className="max-w-[150px] truncate border-l-2 border-dashed border-slate-600 py-0.5 pl-1.5 pr-1 text-left"
                          title="Uppsamlingsdistrikt: sena förtids-, utlands- och brevröster som inte hann sorteras till rätt distrikt i tid. Räknas vid onsdagsräkningen och vägs in i organtotalen (syns inte på kartan). Klicka för enskilda distrikt."
                        >
                          Uppsamling
                        </td>
                        {drill.cols.map((c) => {
                          const v = uppRow.andel[c.fork]
                          const has = v && v > 0.0005
                          return (
                            <td key={c.fork} className="px-0.5 py-0.5 text-center align-top leading-tight">
                              <div className={!has ? 'text-slate-600' : 'text-slate-300'}>{has ? (v * 100).toFixed(1) : '·'}</div>
                            </td>
                          )
                        })}
                        <td
                          className="whitespace-nowrap py-0.5 pl-1 text-right text-slate-500"
                          title={`${uppRow.total.toLocaleString('sv-SE')} sena röster`}
                        >
                          {uppRow.total.toLocaleString('sv-SE')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
        )}
        {/* Uppsamlingsdrilldown — listan av enskilda distrikt i den klickade bucketen
            (handover 15 sep, Lars). Samma tabellstil/kolumner som Bryt ner ovan för
            konsekvens, men egen liten tbody (uppEntries, inte drillItems). */}
        {uppView?.kind === 'list' && (
          <div className="mt-3 border-t border-slate-800 pt-3">
            <button
              type="button"
              onClick={() => setUppView(null)}
              className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-200"
            >
              ‹ Uppsamling — enskilda distrikt
            </button>
            {uppListFailed && <p className="text-[12px] text-rose-400">Kunde inte hämta uppsamlingsdistrikten.</p>}
            <table className="w-full border-separate border-spacing-0 text-[13px] tabular-nums">
              <thead>
                <tr className="text-slate-400">
                  <th className="pb-1 pr-1 text-left font-medium">Distrikt</th>
                  {drill.cols.map((c) => (
                    <th key={c.fork} className="px-0.5 pb-1 text-center font-bold" style={{ color: onDark(c.farg) }}>
                      {c.fork}
                    </th>
                  ))}
                  <th className="pb-1 pl-1 text-right font-medium">Räkn.</th>
                </tr>
              </thead>
              <tbody>
                {[...uppEntries]
                  .sort((a, b) => (a.namn ?? a.kod).localeCompare(b.namn ?? b.kod, 'sv'))
                  .map((e) => {
                    const s = uppSummaries.get(e.kod)
                    return (
                      <tr key={e.kod} className="cursor-pointer italic text-slate-400 hover:bg-slate-800/50" onClick={() => setUppView({ kind: 'detail', kod: e.kod })}>
                        <td className="max-w-[150px] truncate border-l-2 border-dashed border-slate-600 py-0.5 pl-1.5 pr-1 text-left" title={e.namn ?? e.kod}>
                          {e.namn ?? e.kod}
                        </td>
                        {drill.cols.map((c) => {
                          const v = s?.andel[c.fork]
                          const has = v && v > 0.0005
                          return (
                            <td key={c.fork} className="px-0.5 py-0.5 text-center align-top leading-tight">
                              <div className={!has ? 'text-slate-600' : 'text-slate-300'}>{has ? (v * 100).toFixed(1) : '·'}</div>
                            </td>
                          )
                        })}
                        <td className="whitespace-nowrap py-0.5 pl-1 text-right text-slate-500" title={s?.reported ? `${s.total.toLocaleString('sv-SE')} sena röster` : 'ej rapporterat'}>
                          {s?.reported ? '✓' : '·'}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        )}
        {/* Uppsamlingsdrilldown — detaljvy för ETT enskilt uppsamlingsdistrikt: partiröster
            (samma form som en vanlig distriktstabell), INGEN valdeltagande-rad (turnout
            saknar medvetet uppsamlingsdistrikt, matchar val.se — se lib/uppsamlingDrill.ts).
            Personröster (uppsamling_personroster) som komplement, inte ett hårt krav. */}
        {uppView?.kind === 'detail' && (
          <div className="mt-3 border-t border-slate-800 pt-3">
            <button
              type="button"
              onClick={() => setUppView({ kind: 'list' })}
              className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-200"
            >
              ‹ {uppEntryNamn(uppView.kod)}
            </button>
            {uppDetailFailed && <p className="text-[12px] text-rose-400">Kunde inte hämta distriktets resultat.</p>}
            {!uppDetail && !uppDetailFailed && <p className="text-[12px] text-slate-500">Laddar…</p>}
            {uppDetail && uppDetail.rows.length === 0 && <p className="text-[12px] text-slate-500">Inga röster rapporterade än.</p>}
            {uppDetail && uppDetail.rows.length > 0 && (
              <table className="w-full border-separate border-spacing-0 text-[13px] tabular-nums">
                <thead>
                  <tr className="text-slate-400">
                    <th className="pb-1 pr-1 text-left font-medium">Parti</th>
                    <th className="px-0.5 pb-1 text-right font-medium">Röster</th>
                    <th className="pb-1 pl-1 text-right font-medium">Andel</th>
                  </tr>
                </thead>
                <tbody>
                  {uppDetail.rows.map((r) => {
                    const meta = partyRef.current.get(r.partikod)
                    return (
                      <tr key={r.partikod}>
                        <td className="max-w-[150px] truncate border-l-2 py-0.5 pl-1.5 pr-1 text-left text-slate-200" style={{ borderColor: meta?.farg ?? REPORTED_NEUTRAL }}>
                          {meta?.forkortning ?? r.partikod}
                        </td>
                        <td className="px-0.5 py-0.5 text-right tabular-nums text-slate-200">{r.roster.toLocaleString('sv-SE')}</td>
                        <td className="py-0.5 pl-1 text-right tabular-nums text-slate-400">{(r.andel * 100).toFixed(1)} %</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            {uppDetailPersonroster.length > 0 && (
              <div className="mt-3 border-t border-slate-800 pt-2">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Personröster</p>
                <ul className="space-y-0.5 text-[12px] tabular-nums text-slate-300">
                  {uppDetailPersonroster.map((p) => (
                    <li key={`${p.partikod}-${p.kandidatnummer}`} className="flex items-center gap-1.5">
                      <span className="w-8 shrink-0 font-bold" style={{ color: onDark(partyRef.current.get(p.partikod)?.farg ?? '#94a3b8') }}>
                        {partyRef.current.get(p.partikod)?.forkortning ?? p.partikod}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{p.namn}</span>
                      <span className="shrink-0 text-slate-100">{p.antalPersonroster.toLocaleString('sv-SE')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {!isPrompt && <PersonrosterPanel valtyp={valtyp} area={selectedArea} parties={partyRef.current} compact={compact} />}
      </div>
    </div>
  )
}
