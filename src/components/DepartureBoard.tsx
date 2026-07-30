// Departure board — en live-ticker över inrapporterade valdistrikt, nyast överst
// (som en avgångstavla). Prenumererar på samma per-distrikt-notis som kartan
// (ResultsProvider.subscribeChanges) och visar den aktiva valtypens distrikt med
// ledande parti + andel. Ren presentation ovanpå ResultStore — ingen egen data.
//
// OBS (advisor): snapshot-laddningen fanar INTE ut till listeners, bara live
// Realtime-events gör det. Tavlan seedas därför från store vid mount/valtyp-byte
// (så den inte är tom efter omladdning); nya distrikt tickar in via events.
import { useEffect, useRef, useState } from 'react'
import { useResults } from '@/components/ResultsProvider'
import { VALTYP_LABEL } from '@/lib/results'

const NEUTRAL = '#64748b'
const BUFCAP = 60 // hur många distrikt vi minns
const VISIBLE = 12 // hur många rader som visas

type Row = { vd: string; time: string }

const hhmmss = () => new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function DepartureBoard() {
  const { valtyp, subscribeChanges, storesRef, partyRef, distriktNamnRef, totalByValtyp, setSelectedArea, revision, snapshotVersion } = useResults()
  const [rows, setRows] = useState<Row[]>([])

  // Buffert utanför render: nyast-först-ordning + seen-set + tidsstämplar. Muteras
  // synkront i lyssnaren, spolas till state rAF-koalescerat (tål valnattsburst).
  const bufRef = useRef<{ order: string[]; seen: Set<string>; time: Map<string, string> }>({ order: [], seen: new Set(), time: new Map() })
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    // Seed ur redan inrapporterade distrikt (Map-insättningsordning ≈ rapport­ordning,
    // nyast sist → vänd). Blank tid = seedad, inte live-tickad.
    const seeded = [...storesRef.current[valtyp].districts()].reverse().slice(0, BUFCAP)
    const buf = { order: seeded, seen: new Set(seeded), time: new Map<string, string>() }
    bufRef.current = buf
    setRows(seeded.slice(0, VISIBLE).map((vd) => ({ vd, time: '' })))

    const flush = () => {
      rafRef.current = null
      const b = bufRef.current
      setRows(b.order.slice(0, VISIBLE).map((vd) => ({ vd, time: b.time.get(vd) ?? '' })))
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
        b.order.unshift(vd)
        b.time.set(vd, hhmmss())
        if (b.order.length > BUFCAP) {
          for (const dropped of b.order.splice(BUFCAP)) {
            b.seen.delete(dropped)
            b.time.delete(dropped)
          }
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

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 w-[300px] overflow-hidden rounded-lg border border-slate-700 bg-slate-950/85 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-300">Inrapporterat</span>
        </div>
        <span className="text-[11px] tabular-nums text-slate-400">
          {VALTYP_LABEL[valtyp]} · {reported.toLocaleString('sv-SE')}
          {total ? ` / ${total.toLocaleString('sv-SE')}` : ''}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-slate-500">Inga distrikt inrapporterade än</p>
      ) : (
        <ul className="divide-y divide-slate-800/70">
          {rows.map((r) => {
            const o = store.outcome(r.vd)
            const p = o.winner ? partyRef.current.get(o.winner) : null
            const farg = p?.farg ?? NEUTRAL
            const name = distriktNamnRef.current.get(r.vd) ?? r.vd
            return (
              <li
                key={r.vd}
                className="board-row flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-800/50"
                style={{ borderLeft: `3px solid ${farg}` }}
                onClick={() => setSelectedArea({ level: 'distrikt', code: r.vd })}
                title={`${name} — visa i tabellen`}
              >
                <span className="w-14 shrink-0 text-[11px] tabular-nums text-slate-500">{r.time || '—'}</span>
                <span className="flex-1 truncate text-xs text-slate-200">{name}</span>
                {p ? (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold" style={{ color: farg }}>
                    {p.forkortning ?? '?'}
                    <span className="tabular-nums text-slate-400">{Math.round(o.share * 100)}%</span>
                  </span>
                ) : (
                  <span className="shrink-0 text-[11px] text-slate-600">—</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
