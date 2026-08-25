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
import { VALTYP_LABEL, type Valtyp } from '@/lib/results'

const NEUTRAL = '#64748b'
const BUFCAP = 60 // hur många distrikt vi minns
const VISIBLE = 20 // hur många rader som visas (20 senaste inrapporterade per tavla)

type Row = { vd: string }

// val.se:s rapporteringstid "YYYY-MM-DDTHH:MM:SS" → "HH:MM". Naiv svensk lokaltid ur
// strängen (ingen Date/tz-konvertering som skulle skifta klockslaget). "—" om okänd.
const fmtTime = (iso: string | null): string => { const m = /[T ](\d{2}:\d{2})/.exec(iso ?? ''); return m ? m[1] : '—' }

export function DepartureBoard({ valtyp }: { valtyp: Valtyp }) {
  const { subscribeChanges, storesRef, partyRef, distriktNamnRef, totalByValtyp, setSelectedArea, setValtyp, revision, snapshotVersion, areaIndexRef, kommuner, regioner, valkretsListRef } = useResults()
  const [rows, setRows] = useState<Row[]>([])

  // Buffert utanför render: nyast-först-ordning + seen-set. Muteras synkront i
  // lyssnaren, spolas till state rAF-koalescerat (tål valnattsburst). Klockslaget läses
  // vid render ur store.reportTime (val.se:s riktiga rapporteringstid).
  const bufRef = useRef<{ order: string[]; seen: Set<string> }>({ order: [], seen: new Set() })
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const store = storesRef.current[valtyp]
    // Seed: NYAST rapporterade först enligt val.se:s rapporteringstid (ISO-strängar
    // sorterar kronologiskt); distrikt utan tid hamnar sist.
    const seeded = [...store.districts()]
      .map((vd) => [vd, store.reportTime(vd) ?? ''] as const)
      .sort((a, b) => b[1].localeCompare(a[1]))
      .slice(0, BUFCAP)
      .map(([vd]) => vd)
    const buf = { order: seeded, seen: new Set(seeded) }
    bufRef.current = buf
    setRows(seeded.slice(0, VISIBLE).map((vd) => ({ vd })))

    const flush = () => {
      rafRef.current = null
      const b = bufRef.current
      setRows(b.order.slice(0, VISIBLE).map((vd) => ({ vd })))
    }
    const scheduleFlush = () => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(flush)
    }

    const unsub = subscribeChanges((vd, vt) => {
      if (vt !== valtyp) return
      const b = bufRef.current
      if (!b.seen.has(vd)) {
        b.seen.add(vd)
        b.order.unshift(vd) // nytt distrikt = nyaste rapporten → överst
        if (b.order.length > BUFCAP) {
          for (const dropped of b.order.splice(BUFCAP)) b.seen.delete(dropped)
        }
      }
      scheduleFlush() // även för redan sedda: ledande parti kan ha ändrats
    })

    return () => {
      unsub()
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // snapshotVersion: store:n är tom vid mount (snapshot laddas async) — reseeda när
    // bulkladdningen är klar. Bumpas bara vid start, så ingen live-ordning slås sönder.
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
    <div className="pointer-events-auto w-[350px] overflow-hidden rounded-lg border border-slate-700 bg-slate-950/85 shadow-2xl backdrop-blur">
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
        <ul className="max-h-[200px] divide-y divide-slate-800/70 overflow-y-auto">
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
            return (
              <li
                key={r.vd}
                className="board-row cursor-pointer px-3 py-1.5 hover:bg-slate-800/50"
                style={{ borderLeft: `3px solid ${w?.farg ?? NEUTRAL}` }}
                onClick={() => { setValtyp(valtyp); setSelectedArea({ level: 'distrikt', code: r.vd }) }}
                title={`${path} — visa i tabellen (${VALTYP_LABEL[valtyp]})`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="w-11 shrink-0 text-xs tabular-nums text-slate-400">{fmtTime(store.reportTime(r.vd))}</span>
                  <span className="flex-1 truncate text-xs text-slate-200">{path}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-3 pl-[52px] text-[11px] tabular-nums">
                  {w ? (
                    [0, 1, 2, 3, 4].map((i) => {
                      const rk = rank(i)
                      return rk ? (
                        <span key={i} className={i === 0 ? 'font-semibold' : ''} style={{ color: rk.farg }}>
                          {rk.fork} {rk.pct}%
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
