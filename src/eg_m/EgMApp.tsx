// Emelie Gustafsson (M) — halvdold sida, handover 14/15 sep (Lars). Förenklad 15 sep:
// bara personröster, tre EGNA frames (en per valtyp), får plats på EN mobilskärm utan
// scroll. All datahämtning i lib/eg_m.ts (bara en summa per valtyp — se dess docstring
// för varför resultat-/mandatdelen medvetet togs bort).
import { useEffect, useRef, useState } from 'react'
import { fetchEgMData, RESYNC_MAX_MS, RESYNC_MIN_MS, type EgMPersonroster } from '@/lib/eg_m'

const nf = new Intl.NumberFormat('sv-SE')

export function EgMApp() {
  const [data, setData] = useState<EgMPersonroster[] | null>(null)
  const [failed, setFailed] = useState(false)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = () => {
      fetchEgMData()
        .then((d) => { if (aliveRef.current) { setData(d); setFailed(false) } })
        .catch(() => { if (aliveRef.current) setFailed(true) })
        .finally(() => {
          if (!aliveRef.current) return
          // Samma jittrade 30–45 s-takt som huvudsidans resync (se RESYNC_MIN_MS/MAX_MS-
          // kommentaren i lib/eg_m.ts) — självschemaläggande, ingen överlappning.
          timer = setTimeout(load, RESYNC_MIN_MS + Math.random() * (RESYNC_MAX_MS - RESYNC_MIN_MS))
        })
    }
    load()
    return () => { aliveRef.current = false; if (timer) clearTimeout(timer) }
  }, [])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-4 py-6 text-slate-100">
      <header className="text-center">
        <h1 className="text-lg font-semibold text-slate-100">Emelie Gustafsson</h1>
        <p className="text-sm text-slate-400">Moderaterna — personröster 2026</p>
      </header>

      {failed && !data && (
        <p className="rounded-md border border-rose-900 bg-rose-950/50 px-3 py-2 text-sm text-rose-300">
          Kunde inte hämta data just nu. Försöker igen automatiskt.
        </p>
      )}
      {!data && !failed && <p className="text-sm text-slate-500">Laddar…</p>}

      {data && (
        <div className="flex w-full max-w-sm flex-col gap-4">
          {data.map((p) => (
            <div key={p.valtyp} className="rounded-lg border border-slate-800 bg-slate-900/40 px-5 py-6 text-center">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{p.label}</p>
              <p className="mt-2 text-5xl font-bold tabular-nums text-slate-100">{nf.format(p.total)}</p>
              <p className="mt-1 text-sm text-slate-500">personröster</p>
            </div>
          ))}
        </div>
      )}

      <p className="text-center text-[11px] text-slate-600">Data från Valmyndigheten, via valvaka.tech.</p>
    </div>
  )
}
