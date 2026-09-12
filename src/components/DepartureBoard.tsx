// Departure board — en live-ticker över inrapporterade valdistrikt, nyast överst
// (som en avgångstavla). Prenumererar på samma per-distrikt-notis som kartan
// (ResultsProvider.subscribeChanges) och visar EN valtyps distrikt (prop `valtyp`)
// med ledande parti + andel. Tre tavlor (RD/RF/KF) renderas samtidigt i App så alla
// tre valens rapportering syns hela tiden. Ren presentation ovanpå ResultStore.
//
// OBS (advisor): snapshot-laddningen fanar INTE ut till listeners, bara live
// Realtime-events gör det. Tavlan seedas därför från store vid mount/valtyp-byte
// (så den inte är tom efter omladdning); nya distrikt tickar in via events.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useResults } from '@/components/ResultsProvider'
import { ancestorsOf } from '@/lib/hierarchy'
import { onDark } from '@/lib/colors'
import { VALTYP_LABEL, type Valtyp } from '@/lib/results'

const NEUTRAL = '#64748b'
const VISIBLE = 20 // hur många rader som visas (20 senaste inrapporterade per tavla)
// Highlight: hur länge en matchande rad pulsar innan den lugnar sig till en kvarstående ram.
const PULSE_MS = 10_000
// Staggrad reveal: nya distrikt från ett poll-svar rullar in ETT PAR åt gången (i st f alla på en
// gång) så tavlan känns som en levande avgångstavla trots 45–90 s-pollning. Adaptiv chunk → en
// burst rullar in på ≤ ~2 s oavsett storlek (MAX_DRIP_TICKS × REVEAL_MS), ingen lagg mot verkligheten.
const REVEAL_MS = 140
const MAX_DRIP_TICKS = 14

type Row = { vd: string }

// val.se:s rapporteringstid "YYYY-MM-DDTHH:MM:SS" → "HH:MM". Naiv svensk lokaltid ur
// strängen (ingen Date/tz-konvertering som skulle skifta klockslaget). "—" om okänd.
const fmtTime = (iso: string | null): string => { const m = /[T ](\d{2}:\d{2})/.exec(iso ?? ''); return m ? m[1] : '—' }

// onRowSelect (valfritt): körs EFTER att raden satt valtyp + område. Mobil skickar in
// "byt till Resultat-fliken" så en tapp på tavlan visar distriktet i tabellen. Desktop
// skickar inget → oförändrat beteende.
// fill (desktop + mobil Senaste): tavlan är en flex-cell → listan fyller höjden och visar
// fler rader på högre skärmar (i stället för fast max-höjd).
// fullWidth (mobil): tavlan tar hela skärmbredden i stället för den fasta --boards-w.
// emphasized (desktop only): tavlan för vald valtyp får dubbla flex-grow (2 mot 1) →
// 50/25/25-fördelning av höjden mellan de tre tavlorna i stället för jämn 33/33/33.
// Mobilens "Senaste"-flik skickar aldrig in denna → förblir jämn (se MobileApp.tsx).
export function DepartureBoard({ valtyp, onRowSelect, fill, fullWidth, emphasized }: { valtyp: Valtyp; onRowSelect?: () => void; fill?: boolean; fullWidth?: boolean; emphasized?: boolean }) {
  const {
    subscribeChanges, storesRef, partyRef, distriktNamnRef, totalByValtyp, setSelectedArea, setValtyp, revision,
    snapshotVersion, areaIndexRef, kommuner, regioner, valkretsListRef, ensureValtypLoaded,
    valtyp: activeValtyp, selectedArea,
  } = useResults()
  const [rows, setRows] = useState<Row[]>([])

  // Highlight-mål: den AKTIVA valtypen + valt område (kan skilja sig från denna tavlas
  // `valtyp`, se pathOf nedan). En ref hålls uppdaterad så subscribeChanges-callbacken
  // (satt upp en gång per [valtyp, snapshotVersion], se effekten längre ner) alltid läser
  // FÄRSKA värden utan att behöva riva upp hela prenumerationen vid varje områdesbyte.
  const activeAreaRef = useRef({ activeValtyp, selectedArea })
  useEffect(() => {
    activeAreaRef.current = { activeValtyp, selectedArea }
  }, [activeValtyp, selectedArea])

  // Highlight-state: `pulsing` = matchade just nu (pulserar PULSE_MS), `ringed` = har
  // matchat minst en gång (kvarstående ram, superset av pulsing). Session-/mount-lokalt —
  // ingen persistens; en rad som rullar ut ur `rows` slutar synas oavsett innehåll här.
  const [pulsing, setPulsing] = useState<Set<string>>(new Set())
  const [ringed, setRinged] = useState<Set<string>>(new Set())
  const pulseTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  useEffect(() => () => { for (const t of pulseTimersRef.current.values()) clearTimeout(t) }, [])

  // Fas 3-trigger: en monterad tavla ber providern ladda SIN valtyps snapshot (idempotent).
  // Desktop monterar alla tre → alla tre laddas; mobil Senaste monterar alla tre först när
  // fliken öppnas → icke-aktiva valtyper laddas då, inte vid appstart.
  useEffect(() => {
    ensureValtypLoaded(valtyp)
  }, [valtyp, ensureValtypLoaded])

  // Ordning = val.se:s rapporteringstid DESC (nyast rapporterat överst), STABIL. Tidigare
  // unshift:ades varje ändrat distrikt överst; under sim-churn re-ingesteras gamla distrikt
  // (val.se uppdaterar filerna) och de poppade då upp överst med sin GAMLA tid → tavlan
  // fladdrade. Nu räknas topplistan om från store:n (sorterad på rapporteringstid) rAF-
  // koalescerat, så en re-ingest aldrig rör ordningen — bara en genuint nyare tid flyttar upp.
  const rafRef = useRef<number | null>(null)
  const revealedRef = useRef<Set<string>>(new Set()) // vd:er tavlan får visa (staggrad reveal)
  const queueRef = useRef<string[]>([])              // ej-avslöjade distrikt, NYAST FÖRST
  const dripRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const store = storesRef.current[valtyp]
    const revealed = revealedRef.current
    const changed = new Set<string>() // vd:er med en ändringsnotis i AKTUELL rAF-batch (highlight-kandidater)

    // Markera vd som matchad: tänd pulsen (om) och lägg den i den kvarstående ramen (superset).
    // Omstartar timern vid upprepade matchningar inom fönstret i stället för att stapla dem.
    const markMatched = (vd: string) => {
      setRinged((prev) => (prev.has(vd) ? prev : new Set(prev).add(vd)))
      setPulsing((prev) => (prev.has(vd) ? prev : new Set(prev).add(vd)))
      const existing = pulseTimersRef.current.get(vd)
      if (existing) clearTimeout(existing)
      pulseTimersRef.current.set(
        vd,
        setTimeout(() => {
          setPulsing((prev) => {
            if (!prev.has(vd)) return prev
            const next = new Set(prev)
            next.delete(vd)
            return next
          })
          pulseTimersRef.current.delete(vd)
        }, PULSE_MS),
      )
    }
    // Rader = top-VISIBLE av AVSLÖJADE distrikt, sorterade på rapporteringstid DESC (nyast överst).
    // ISO-tidsträngar sorterar kronologiskt → snabb strängjämförelse (localeCompare skulle spika
    // CPU:n på tusentals distrikt). Distrikt utan tid hamnar sist.
    const compute = (): Row[] =>
      [...store.districts()]
        .filter((vd) => revealed.has(vd))
        .map((vd) => [vd, store.reportTime(vd) ?? ''] as const)
        .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
        .slice(0, VISIBLE)
        .map(([vd]) => ({ vd }))

    // Seed: allt som redan finns avslöjas DIREKT (tavlan är full från mount) — dripen gäller bara
    // NYA arrivals efter det, annars skulle en snapshot rulla in tusentals rader.
    revealed.clear()
    for (const vd of store.districts()) revealed.add(vd)
    queueRef.current = []
    setRows(compute())

    // Drip: flytta en (adaptiv) chunk vd:er/​tick från kön → avslöjade. En burst rullar in på
    // ≤ ~2 s oavsett storlek (chunk skalar med kölängd) så tavlan aldrig laggar mot verkligheten;
    // små batchar rullar mjukt ett par åt gången. boardIn-animationen spelar per nytt radelement.
    const drip = () => {
      const q = queueRef.current
      const chunk = Math.max(1, Math.ceil(q.length / MAX_DRIP_TICKS))
      for (let i = 0; i < chunk && q.length; i++) revealed.add(q.shift()!)
      setRows(compute())
      dripRef.current = q.length ? setTimeout(drip, REVEAL_MS) : null
    }
    const onChange = () => {
      // Highlight: distrikt som fick en ändringsnotis i denna batch OCH ligger inom det
      // område användaren just nu tittar på i AKTIV valtyp (denna tavlas valtyp kan skilja
      // sig från aktiv, se pathOf). Ingen highlight på toppnivå (selectedArea.code == null)
      // — annars skulle allt blinka. Gäller både nya rader och redan synliga som omräknas.
      const { activeValtyp, selectedArea } = activeAreaRef.current
      if (changed.size && valtyp === activeValtyp && selectedArea.code != null) {
        for (const vd of changed) {
          const chain = ancestorsOf(valtyp, { level: 'distrikt', code: vd }, areaIndexRef.current[valtyp])
          if (chain.some((a) => a.level === selectedArea.level && a.code === selectedArea.code)) markMatched(vd)
        }
      }
      changed.clear()

      // Ej-avslöjade distrikt → kö NYAST FÖRST så de rullar in överst. Inga nya (bara omräknad
      // andel/tid på redan visade) → räkna bara om raderna (färska siffror), ingen drip.
      const pending = [...store.districts()].filter((vd) => !revealed.has(vd))
      if (pending.length === 0) { setRows(compute()); return }
      pending.sort((a, b) => { const x = store.reportTime(a) ?? '', y = store.reportTime(b) ?? ''; return x < y ? 1 : x > y ? -1 : 0 })
      queueRef.current = pending
      if (dripRef.current == null) drip() // starta dripen (self-schedulerar); pågår den redan läser den nya kön
    }

    // rAF-koalescera bursten av per-distrikt-notiser → en onChange/frame.
    const flush = () => { rafRef.current = null; onChange() }
    const scheduleFlush = () => { if (rafRef.current != null) return; rafRef.current = requestAnimationFrame(flush) }
    const unsub = subscribeChanges((vd, vt) => { if (vt !== valtyp) return; changed.add(vd); scheduleFlush() })

    return () => {
      unsub()
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      if (dripRef.current != null) clearTimeout(dripRef.current)
      rafRef.current = null
      dripRef.current = null
    }
    // snapshotVersion: store:n är tom vid mount (snapshot laddas async) — seed:a om när klar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valtyp, snapshotVersion])

  void revision // rendera om när aggregatet strypt-bumpats (håller andelar färska vid idle)
  const store = storesRef.current[valtyp]
  const reported = store.reportedCount
  const total = totalByValtyp[valtyp]

  // Namn-uppslag + hierarki-sökväg för DENNA tavlas valtyp (kan skilja sig från aktiv).
  const kommunName = useMemo(() => new Map(kommuner.map((k) => [k.code, k.name])), [kommuner])
  const regionName = useMemo(() => new Map(regioner.map((r) => [r.code, r.name])), [regioner])
  const valkretsName = useMemo(
    () => new Map((valkretsListRef.current[valtyp] ?? []).map((v) => [v.code, v.name])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valtyp, snapshotVersion],
  )
  const nameOf = (a: { level: string; code: string | null }) =>
    a.level === 'valkrets'
      ? valkretsName.get(a.code ?? '') ?? a.code ?? ''
      : a.level === 'region'
        ? regionName.get(a.code ?? '') ?? a.code ?? ''
        : a.level === 'kommun'
          ? kommunName.get(a.code ?? '') ?? a.code ?? ''
          : distriktNamnRef.current.get(a.code ?? '') ?? a.code ?? ''
  // Full väg genom hierarkin (KF: kommun › valkrets › distrikt; RF: region › valkrets ›
  // distrikt; RD: valkrets › kommun › distrikt). "Riket" släpps (redundant för RD).
  const pathOf = (vd: string) =>
    ancestorsOf(valtyp, { level: 'distrikt', code: vd }, areaIndexRef.current[valtyp])
      .filter((a) => a.level !== 'riket')
      .map(nameOf)
      .join(' › ')

  return (
    <div className={`pointer-events-auto ${fullWidth ? 'w-full' : 'w-[var(--boards-w)]'} overflow-hidden rounded-lg border border-slate-700 bg-slate-950/85 shadow-2xl backdrop-blur ${fill ? `flex min-h-0 ${emphasized ? 'flex-[2]' : 'flex-1'} flex-col transition-[flex-grow] duration-300` : ''}`}>
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-300">Senaste rapporterat</span>
        </div>
        <span className="text-[11px] tabular-nums text-slate-400">
          {VALTYP_LABEL[valtyp]} · {reported.toLocaleString('sv-SE')}
          {total ? ` / ${total.toLocaleString('sv-SE')}` : ''}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-slate-500">Inga distrikt inrapporterade än</p>
      ) : (
        <ul className={`${fill ? 'min-h-0 flex-1' : 'max-h-[150px]'} divide-y divide-slate-800/70 overflow-y-auto`}>
          {rows.map((r) => {
            // Vinnare + tvåa ur distriktets partiröster (sorterat fallande).
            const votes = store.aggregate([r.vd])
            const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1])
            const tot = sorted.reduce((s, [, v]) => s + v, 0)
            const rank = (i: number) => {
              const e = sorted[i]
              if (!e || tot === 0) return null
              const p = partyRef.current.get(e[0])
              return { fork: p?.forkortning ?? '?', farg: p?.farg ?? NEUTRAL, pct: Math.round((e[1] / tot) * 100) }
            }
            const w = rank(0)
            const path = pathOf(r.vd)
            const isSlutlig = store.isSlutlig(r.vd)
            return (
              <li
                key={r.vd}
                className={`board-row cursor-pointer px-3 py-1.5 hover:bg-slate-800/50 ${
                  pulsing.has(r.vd) ? 'board-row-pulse' : ringed.has(r.vd) ? 'board-row-matched' : ''
                }`}
                style={{ borderLeft: `3px solid ${w?.farg ?? NEUTRAL}` }}
                onClick={() => { setValtyp(valtyp); setSelectedArea({ level: 'distrikt', code: r.vd }); onRowSelect?.() }}
                title={`${path} — visa i tabellen (${VALTYP_LABEL[valtyp]})`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="w-11 shrink-0 text-xs tabular-nums text-slate-400">{fmtTime(store.reportTime(r.vd))}</span>
                  <span className="flex-1 truncate text-xs text-slate-200">{path}</span>
                  <span
                    className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${isSlutlig ? 'bg-emerald-400' : 'bg-amber-400'}`}
                    title={isSlutlig ? 'Slutgiltigt resultat' : 'Preliminärt resultat'}
                  />
                </div>
                <div className="mt-0.5 flex items-center gap-3 pl-[52px] text-[11px] tabular-nums">
                  {w ? (
                    [0, 1, 2, 3, 4].map((i) => {
                      const rk = rank(i)
                      // Förkortningen i partifärg (lightad så mörka V/KD syns mot den
                      // mörka tavlan); procenttalet vitt som i resultatpanelen.
                      return rk ? (
                        <span key={i} className={i === 0 ? 'font-semibold' : ''}>
                          <span style={{ color: onDark(rk.farg) }}>{rk.fork}</span>{' '}
                          <span className="text-slate-200">{rk.pct}%</span>
                        </span>
                      ) : null
                    })
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
