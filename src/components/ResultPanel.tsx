// Behållare för resultattabellen: laddar result + distriktsmetadata + partifärger,
// aggregerar för valt område och renderar <ResultTable>. Increment 1: röster/andel
// (mandat + ±2022 wiras senare). Egen datahämtning (snapshot, ej Realtime än) —
// delas ihop med kartan i en gemensam provider i ett senare steg.
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ResultStore, VALTYPER, VALTYP_LABEL, type Valtyp } from '@/lib/results'
import {
  SPARR,
  buildRows,
  collapseForDisplay,
  districtsInArea,
  type DistrictMeta,
  type Level,
  type PartyMeta,
} from '@/lib/aggregate'
import { ResultTable } from '@/components/ResultTable'

const ELECTION: Record<Valtyp, string> = {
  RD: 'Riksdagsvalet',
  RF: 'Regionvalet',
  KF: 'Kommunvalet',
}
type Area = { level: Level; code: string | null; name: string }
const RIKET: Area = { level: 'riket', code: null, name: 'Riket' }

export function ResultPanel() {
  const [valtyp, setValtyp] = useState<Valtyp>('RD')
  const [area, setArea] = useState<Area>(RIKET)
  const [version, setVersion] = useState(0) // bumpar när storen (valtyp) laddats om

  const storeRef = useRef<ResultStore>(new ResultStore())
  const metaRef = useRef<Map<string, DistrictMeta>>(new Map())
  const partyRef = useRef<Map<string, PartyMeta>>(new Map())
  const allCodesRef = useRef<string[]>([])
  const [kommuner, setKommuner] = useState<{ code: string; name: string }[]>([])

  // Referensdata (en gång): partifärger + distriktsmetadata + kommunlista.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: parties } = await supabase.from('party').select('partikod,color,forkortning')
      if (!cancelled && parties) {
        const m = new Map<string, PartyMeta>()
        for (const p of parties) m.set(p.partikod, { forkortning: p.forkortning, farg: p.color })
        partyRef.current = m
      }
      const meta = new Map<string, DistrictMeta>()
      const codes: string[] = []
      const kommunMap = new Map<string, string>()
      const PAGE = 1000
      for (let from = 0; !cancelled; from += PAGE) {
        const { data, error } = await supabase
          .from('district')
          .select('valdistriktskod,kommun,vk_rd,vk_rf,vk_kf')
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        for (const d of data) {
          codes.push(d.valdistriktskod)
          meta.set(d.valdistriktskod, { vk_rd: d.vk_rd, vk_rf: d.vk_rf, vk_kf: d.vk_kf })
          kommunMap.set(d.valdistriktskod.slice(0, 4), d.kommun ?? d.valdistriktskod.slice(0, 4))
        }
        if (data.length < PAGE) break
      }
      if (cancelled) return
      metaRef.current = meta
      allCodesRef.current = codes
      setKommuner([...kommunMap.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name, 'sv')))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Result för vald valtyp (snapshot, paginerat) → ny store.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const store = new ResultStore()
      const PAGE = 1000
      for (let from = 0; !cancelled; from += PAGE) {
        const { data, error } = await supabase
          .from('result')
          .select('valdistriktskod,partikod,roster')
          .eq('valtyp', valtyp)
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        for (const r of data) store.set(r.valdistriktskod, r.partikod, r.roster)
        if (data.length < PAGE) break
      }
      if (cancelled) return
      storeRef.current = store
      setVersion((v) => v + 1)
    })()
    return () => {
      cancelled = true
    }
  }, [valtyp])

  const view = useMemo(() => {
    void version // beroende: räkna om när storen bytts
    const codes = districtsInArea(allCodesRef.current, area.level, area.code, valtyp, metaRef.current)
    const votes = storeRef.current.aggregate(codes)
    const areaResult = buildRows(votes, partyRef.current, SPARR[valtyp])
    const display = collapseForDisplay(areaResult)
    const reported = codes.reduce((n, c) => n + (storeRef.current.has(c) ? 1 : 0), 0)
    return { display, giltiga: areaResult.giltiga, reported, total: codes.length }
  }, [valtyp, area, version])

  const pct = view.total > 0 ? Math.round((view.reported / view.total) * 100) : 0

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      {/* Valtyp-väljare */}
      <div className="flex overflow-hidden rounded-md border border-slate-700 text-sm">
        {VALTYPER.map((vt) => (
          <button
            key={vt}
            type="button"
            onClick={() => { setValtyp(vt); setArea(RIKET) }}
            className={`flex-1 px-3 py-1.5 font-medium transition-colors ${vt === valtyp ? 'bg-sky-500 text-white' : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800'}`}
          >
            {VALTYP_LABEL[vt]}
          </button>
        ))}
      </div>

      {/* Områdesväljare: Riket + kommun-drilldown */}
      <select
        className="rounded-md border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-100"
        value={area.level === 'riket' ? 'riket' : `k:${area.code}`}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'riket') setArea(RIKET)
          else {
            const code = v.slice(2)
            const name = kommuner.find((k) => k.code === code)?.name ?? code
            setArea({ level: 'kommun', code, name })
          }
        }}
      >
        <option value="riket">Riket</option>
        {kommuner.map((k) => (
          <option key={k.code} value={`k:${k.code}`}>{k.name}</option>
        ))}
      </select>

      <div className="min-h-0 flex-1 overflow-auto pr-1">
        <ResultTable
          title={`${ELECTION[valtyp]} — ${area.name}`}
          subtitle={`${view.reported.toLocaleString('sv-SE')} av ${view.total.toLocaleString('sv-SE')} distrikt räknade (${pct} %)`}
          display={view.display}
          giltiga={view.giltiga}
          sparr={SPARR[valtyp]}
        />
        {view.giltiga === 0 && (
          <p className="mt-4 text-center text-xs text-slate-500">
            Inga resultat inrapporterade för {VALTYP_LABEL[valtyp].toLowerCase()} i {area.name} än.
          </p>
        )}
      </div>
    </div>
  )
}
