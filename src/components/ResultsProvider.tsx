// Delad resultat-state för karta OCH tabell. Äger:
//   • EN Realtime-prenumeration (alla valtyper, routas per valtyp) — inte en per vy.
//   • EN ResultStore per valtyp (stabil ref, muteras in-place, byts aldrig).
//   • Referensdata: partifärger, distriktsmetadata (koder/grupper/kommun-/länlista),
//     2022-jämförelse (±) och district_comparison (jämförbarhet för kart-hover).
//   • Delad UI-state: vald valtyp + valt område (kartklick → tabell-drilldown).
//
// Två signalkanaler så karta och tabell inte trampar på varandra:
//   • subscribeChanges(vd, valtyp): synkron per-distrikt-notis → kartan gör inkre-
//     mentell rAF-ompaint (den bryr sig bara om aktiv valtyps distrikt).
//   • revision: strypt (~750 ms) räknare → tabellen räknar om områdesaggregatet.
// snapshotVersion bumpas när en bulkladdning (referens/snapshot) är klar → kartan
// gör en full ompaint, tabellen räknar om.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { supabase } from '@/lib/supabase'
import { ResultStore, VALTYPER, VALTYP_VK_COLUMN, type Valtyp } from '@/lib/results'
import { buildGroups, type AreaComparison, type AreaGroups, type Comparison2022, type DistrictMeta, type Level, type PartyMeta } from '@/lib/aggregate'

export type Area = { level: Level; code: string | null }
export const RIKET: Area = { level: 'riket', code: null }

// Varje valtyp väljer ett organ på EN nativ nivå: RD ett riksorgan, RF 20 region-
// fullmäktige, KF 290 kommunfullmäktige. Ovanför den nivån finns bara röstaggregat,
// ingen församling → väljaren aggregerar aldrig uppåt förbi den nativa nivån.
export const NATIVE_LEVEL: Record<Valtyp, Level> = { RD: 'riket', RF: 'region', KF: 'kommun' }
// Default-område per valtyp. RD → Riket (organ finns). RF/KF → ingen riksnivå, så
// "välj region/kommun"-läge (code null) tills man väljer i listan eller klickar i kartan.
export const defaultAreaFor = (valtyp: Valtyp): Area => ({ level: NATIVE_LEVEL[valtyp], code: null })

type NamedCode = { code: string; name: string }
type ChangeListener = (vd: string, valtyp: Valtyp) => void
export type WinnerParty = { forkortning: string | null; farg: string | null }

export interface ResultsContextValue {
  // Delad UI-state
  valtyp: Valtyp
  setValtyp: (v: Valtyp) => void
  selectedArea: Area
  setSelectedArea: (a: Area) => void

  // Stabila referens-refar (läses vid beräkning; useMemo nycklar på revision).
  storesRef: RefObject<Record<Valtyp, ResultStore>>
  partyRef: RefObject<Map<string, PartyMeta>>
  metaRef: RefObject<Map<string, DistrictMeta>>
  allCodesRef: RefObject<string[]>
  groupsRef: RefObject<AreaGroups>
  comparisonRef: RefObject<Comparison2022 | null>
  districtComparisonRef: RefObject<Map<string, string>>
  distriktNamnRef: RefObject<Map<string, string>>
  district2022Ref: RefObject<Map<string, AreaComparison | null>>
  // 2022 års vinnarparti per distrikt (batch-hämtat per kommun för drill-down-listan).
  districtWinners2022Ref: RefObject<Map<string, WinnerParty | null>>
  ensureDistrictWinners2022: (valtyp: Valtyp, kommunCode: string) => void

  // Områdesväljar-listor + HUD-nämnare
  kommuner: NamedCode[]
  regioner: NamedCode[]
  totalByValtyp: Record<Valtyp, number>

  // Signalkanaler
  subscribeChanges: (fn: ChangeListener) => () => void
  revision: number
  snapshotVersion: number
  realtimeConnected: boolean // Realtime-kanalens status (SUBSCRIBED) → live-indikator
}

const ResultsContext = createContext<ResultsContextValue | null>(null)

export function useResults(): ResultsContextValue {
  const ctx = useContext(ResultsContext)
  if (!ctx) throw new Error('useResults måste användas inuti <ResultsProvider>')
  return ctx
}

const emptyCounts = (): Record<Valtyp, number> => ({ RD: 0, RF: 0, KF: 0 })

export function ResultsProvider({ children }: { children: ReactNode }) {
  const [valtyp, setValtypState] = useState<Valtyp>('RD')
  const [selectedArea, setSelectedArea] = useState<Area>(RIKET)
  // Byt valtyp → nollställ området till den nya valtypens nativa default (ett
  // kommun-val kan inte visa "Riket" osv). Ett valt DISTRIKT behålls dock — samma
  // 8-siffriga kod gäller i alla tre valen, så man kan jämföra distriktets RD/RF/KF.
  const setValtyp = useCallback((v: Valtyp) => {
    setValtypState(v)
    setSelectedArea((prev) => (prev.level === 'distrikt' ? prev : defaultAreaFor(v)))
  }, [])
  const [revision, setRevision] = useState(0)
  const [snapshotVersion, setSnapshotVersion] = useState(0)
  const [kommuner, setKommuner] = useState<NamedCode[]>([])
  const [regioner, setRegioner] = useState<NamedCode[]>([])
  const [totalByValtyp, setTotalByValtyp] = useState<Record<Valtyp, number>>(emptyCounts)
  const [realtimeConnected, setRealtimeConnected] = useState(false)

  const storesRef = useRef<Record<Valtyp, ResultStore>>(null!)
  if (!storesRef.current) {
    storesRef.current = { RD: new ResultStore(), RF: new ResultStore(), KF: new ResultStore() }
  }
  const partyRef = useRef<Map<string, PartyMeta>>(new Map())
  const metaRef = useRef<Map<string, DistrictMeta>>(new Map())
  const allCodesRef = useRef<string[]>([])
  const groupsRef = useRef<AreaGroups>(buildGroups([]))
  const comparisonRef = useRef<Comparison2022 | null>(null)
  const districtComparisonRef = useRef<Map<string, string>>(new Map())
  const distriktNamnRef = useRef<Map<string, string>>(new Map()) // vd-kod → distriktsnamn (tabellrubrik vid kartklick)
  // 2022 per distrikt, lazy-hämtat på klick (`${valtyp}:${vd}` → löv, eller null om NEJ/inget).
  const district2022Ref = useRef<Map<string, AreaComparison | null>>(new Map())
  // 2022 års vinnarparti per distrikt (vd → parti), batch-hämtat per kommun för drill-listan.
  const districtWinners2022Ref = useRef<Map<string, WinnerParty | null>>(new Map())
  const dw2022FetchedRef = useRef<Set<string>>(new Set()) // `${valtyp}:${kommunkod}` redan hämtade

  // Hämta 2022 års vinnarparti för alla distrikt i en kommun (en gång, cache:at).
  // Distriktsbarn i drill-listan har alltid en 4-siffrig kommun som förälder.
  const ensureDistrictWinners2022 = useCallback((valtyp: Valtyp, kommunCode: string) => {
    const key = `${valtyp}:${kommunCode}`
    if (dw2022FetchedRef.current.has(key)) return
    dw2022FetchedRef.current.add(key)
    ;(async () => {
      const { data, error } = await supabase
        .from('district_result_2022')
        .select('valdistriktskod,beteckning,andel')
        .eq('valtyp', valtyp)
        .like('valdistriktskod', `${kommunCode}%`)
      if (error || !data) return
      const top = new Map<string, { namn: string; andel: number }>()
      for (const r of data) {
        const cur = top.get(r.valdistriktskod)
        if (!cur || r.andel > cur.andel) top.set(r.valdistriktskod, { namn: r.beteckning, andel: r.andel })
      }
      const nameToParty = new Map<string, PartyMeta>()
      for (const p of partyRef.current.values()) if (p.beteckning) nameToParty.set(p.beteckning, p)
      for (const [vd, t] of top) {
        const p = nameToParty.get(t.namn)
        districtWinners2022Ref.current.set(vd, p ? { forkortning: p.forkortning, farg: p.farg } : null)
      }
      setRevision((r) => r + 1)
    })()
  }, [])

  // Per-distrikt-lyssnare (kartan). Muteras utanför React-render.
  const listenersRef = useRef<Set<ChangeListener>>(new Set())
  const subscribeChanges = useCallback((fn: ChangeListener) => {
    listenersRef.current.add(fn)
    return () => {
      listenersRef.current.delete(fn)
    }
  }, [])

  // Strypt revision-bump (~750 ms) — tabellen behöver inte räkna om per rad.
  const revTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bumpRevisionThrottled = useCallback(() => {
    if (revTimerRef.current != null) return
    revTimerRef.current = setTimeout(() => {
      revTimerRef.current = null
      setRevision((r) => r + 1)
    }, 750)
  }, [])

  // Realtime + snapshot + nämnare (mount-en gång). Prenumerera FÖRE snapshot så
  // inget event faller i gapet.
  useEffect(() => {
    const channel = supabase
      .channel('result-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'result' }, (payload) => {
        const row = payload.new as { valtyp?: string; valdistriktskod?: string; partikod?: string; roster?: number }
        if (!row?.valtyp || !row.valdistriktskod || !row.partikod) return
        const store = storesRef.current[row.valtyp as Valtyp]
        if (!store) return
        if (import.meta.env.DEV) {
          const w = window as unknown as { __eventCount?: number }
          w.__eventCount = (w.__eventCount ?? 0) + 1
        }
        store.set(row.valdistriktskod, row.partikod, row.roster ?? 0)
        for (const fn of listenersRef.current) fn(row.valdistriktskod, row.valtyp as Valtyp)
        bumpRevisionThrottled()
      })
      .subscribe((status) => {
        const ok = status === 'SUBSCRIBED'
        setRealtimeConnected(ok)
        if (ok) {
          ;(window as unknown as { __realtimeReady?: boolean }).__realtimeReady = true
        }
      })

    let cancelled = false
    ;(async () => {
      // Per-valtyp nämnare: distrikt som deltar (vk_<valtyp> ej null) — härled ur data.
      const counts = emptyCounts()
      for (const vt of VALTYPER) {
        const { count } = await supabase
          .from('district')
          .select('*', { count: 'exact', head: true })
          .not(VALTYP_VK_COLUMN[vt], 'is', null)
        counts[vt] = count ?? 0
      }
      if (!cancelled) setTotalByValtyp(counts)

      // Snapshot av redan inrapporterade resultat (alla valtyper, paginerat).
      const PAGE = 1000
      for (let from = 0; !cancelled; from += PAGE) {
        const { data, error } = await supabase
          .from('result')
          .select('valtyp,valdistriktskod,partikod,roster')
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        for (const r of data) storesRef.current[r.valtyp as Valtyp]?.set(r.valdistriktskod, r.partikod, r.roster)
        if (data.length < PAGE) break
      }
      if (cancelled) return
      setSnapshotVersion((v) => v + 1)
      setRevision((r) => r + 1)
    })()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      if (revTimerRef.current != null) clearTimeout(revTimerRef.current)
    }
  }, [bumpRevisionThrottled])

  // Referensdata (mount-en gång): partifärger, distriktsmetadata, ±2022, jämförbarhet.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: parties } = await supabase.from('party').select('partikod,color,forkortning,beteckning')
      if (!cancelled && parties) {
        const m = new Map<string, PartyMeta>()
        for (const p of parties) m.set(p.partikod, { forkortning: p.forkortning, farg: p.color, beteckning: p.beteckning })
        partyRef.current = m
      }

      try {
        const res = await fetch('/comparison-2022.json')
        if (res.ok && !cancelled) comparisonRef.current = (await res.json()) as Comparison2022
      } catch {
        /* saknas → ±2022 visar "–" */
      }

      // district_comparison (jämförbarhet mot 2022) för kart-hover.
      const cmp = new Map<string, string>()
      const meta = new Map<string, DistrictMeta>()
      const namn = new Map<string, string>()
      const codes: string[] = []
      const kommunMap = new Map<string, string>()
      const lanMap = new Map<string, string>()
      const PAGE = 1000
      for (let from = 0; !cancelled; from += PAGE) {
        const { data, error } = await supabase
          .from('district')
          .select('valdistriktskod,namn,kommun,lan,vk_rd,vk_rf,vk_kf')
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        for (const d of data) {
          codes.push(d.valdistriktskod)
          meta.set(d.valdistriktskod, { vk_rd: d.vk_rd, vk_rf: d.vk_rf, vk_kf: d.vk_kf })
          namn.set(d.valdistriktskod, d.namn ?? d.valdistriktskod)
          kommunMap.set(d.valdistriktskod.slice(0, 4), d.kommun ?? d.valdistriktskod.slice(0, 4))
          lanMap.set(d.valdistriktskod.slice(0, 2), d.lan ?? d.valdistriktskod.slice(0, 2))
        }
        if (data.length < PAGE) break
      }
      for (let from = 0; !cancelled; from += PAGE) {
        const { data, error } = await supabase
          .from('district_comparison')
          .select('valdistriktskod,jamforbarhet')
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        for (const r of data) cmp.set(r.valdistriktskod, r.jamforbarhet)
        if (data.length < PAGE) break
      }
      if (cancelled) return
      metaRef.current = meta
      distriktNamnRef.current = namn
      allCodesRef.current = codes
      groupsRef.current = buildGroups(codes)
      districtComparisonRef.current = cmp
      const bySv = (a: NamedCode, b: NamedCode) => a.name.localeCompare(b.name, 'sv')
      setKommuner([...kommunMap.entries()].map(([code, name]) => ({ code, name })).sort(bySv))
      setRegioner([...lanMap.entries()].map(([code, name]) => ({ code, name })).sort(bySv))
      // Metadata redo → kartan får rätt färger (partyRef) och tabellen sitt aggregat.
      setSnapshotVersion((v) => v + 1)
      setRevision((r) => r + 1)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Distriktsval → hämta det distriktets 2022-resultat (en gång, cache:at). Bumpar
  // revision när det landat så tabellen räknar om med 2022-kolumnerna ifyllda.
  useEffect(() => {
    if (selectedArea.level !== 'distrikt' || !selectedArea.code) return
    const code = selectedArea.code
    const key = `${valtyp}:${code}`
    if (district2022Ref.current.has(key)) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('district_result_2022')
        .select('beteckning,andel')
        .eq('valtyp', valtyp)
        .eq('valdistriktskod', code)
      if (cancelled) return
      const andel: Record<string, number> = {}
      if (!error && data) for (const r of data) andel[r.beteckning] = r.andel
      // Tomt (NEJ/ingen 2022-motsvarighet) → null → 2022-kolumnerna visar "–".
      district2022Ref.current.set(key, Object.keys(andel).length ? { andel, mandat: {} } : null)
      setRevision((r) => r + 1)
    })()
    return () => {
      cancelled = true
    }
  }, [valtyp, selectedArea])

  const value: ResultsContextValue = {
    valtyp,
    setValtyp,
    selectedArea,
    setSelectedArea,
    storesRef,
    partyRef,
    metaRef,
    allCodesRef,
    groupsRef,
    comparisonRef,
    districtComparisonRef,
    distriktNamnRef,
    district2022Ref,
    districtWinners2022Ref,
    ensureDistrictWinners2022,
    kommuner,
    regioner,
    totalByValtyp,
    subscribeChanges,
    revision,
    snapshotVersion,
    realtimeConnected,
  }

  return <ResultsContext.Provider value={value}>{children}</ResultsContext.Provider>
}
