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
import { ResultStore, TurnoutStore, VALTYPER, VALTYP_VK_COLUMN, type Valtyp } from '@/lib/results'
import { buildGroups, type AreaComparison, type AreaGroups, type Comparison2022, type DistrictMeta, type Level, type PartyMeta } from '@/lib/aggregate'
import type { PartyVotes } from '@/lib/mandate'
import type { AreaIndex } from '@/lib/hierarchy'

export type Area = { level: Level; code: string | null }
export const RIKET: Area = { level: 'riket', code: null }

// Varje valtyp väljer ett organ på EN nativ nivå: RD ett riksorgan, RF 20 region-
// fullmäktige, KF 290 kommunfullmäktige. Ovanför den nivån finns bara röstaggregat,
// ingen församling → väljaren aggregerar aldrig uppåt förbi den nativa nivån.
export const NATIVE_LEVEL: Record<Valtyp, Level> = { RD: 'riket', RF: 'region', KF: 'kommun' }
// Default-område per valtyp. RD → Riket (organ finns). RF/KF → ingen riksnivå, så
// "välj region/kommun"-läge (code null) tills man väljer i listan eller klickar i kartan.
export const defaultAreaFor = (valtyp: Valtyp): Area => ({ level: NATIVE_LEVEL[valtyp], code: null })

// --- Delbara vy-URL:er ------------------------------------------------------------------
// En vy = valtyp + markerat område. Kodas i query-strängen så en länk kan öppna en
// specifik default-vy, t.ex. ?val=KF&omrade=kommun:1488 = "Kommunalvalet Trollhättan",
// eller ?val=RD&omrade=valkrets:XX = "Riksdagsvalet i valkrets XX". Området kodas
// "nivå:kod" (riket saknar kod; RF/KF-promptläget = default → utelämnas → ren länk).
const AREA_LEVELS: Level[] = ['riket', 'region', 'kommun', 'valkrets', 'distrikt']

// Poll-intervall: Realtime är BORTTAGET → resyncen (updated_at-delta) är PRIMÄR uppdateringsväg.
// Jittrat 45–90 s så flikar inte pollar i takt (undviker synkron-herd på servern); en SYNLIG flik
// pollar, en bakgrundsflik ligger tyst (och refreshar direkt vid tab-fokus). Deltan är liten (bara
// det som ändrats sedan cursorn) → index-range-scan på (valtyp, updated_at) → lätt last som skalar
// med klienter/intervall, inte writes×subscribers. UX förblir "live": staggrad reveal + puls-indikator.
const RESYNC_MIN_MS = 45000
const RESYNC_MAX_MS = 90000

function parseAreaParam(raw: string | null, valtyp: Valtyp): Area {
  if (!raw) return defaultAreaFor(valtyp)
  if (raw === 'riket') return RIKET
  const i = raw.indexOf(':')
  const level = (i === -1 ? raw : raw.slice(0, i)) as Level
  const code = i === -1 ? null : raw.slice(i + 1)
  if (!AREA_LEVELS.includes(level)) return defaultAreaFor(valtyp)
  return { level, code: code || null }
}

export function readViewFromUrl(): { valtyp: Valtyp; area: Area } {
  if (typeof window === 'undefined') return { valtyp: 'RD', area: RIKET }
  const q = new URLSearchParams(window.location.search)
  const raw = (q.get('val') ?? '').toUpperCase()
  const valtyp = (VALTYPER as readonly string[]).includes(raw) ? (raw as Valtyp) : 'RD'
  return { valtyp, area: parseAreaParam(q.get('omrade'), valtyp) }
}

export function viewToSearch(valtyp: Valtyp, area: Area): string {
  const def = defaultAreaFor(valtyp)
  const areaIsDefault = area.level === def.level && area.code === def.code
  if (valtyp === 'RD' && areaIsDefault) return '' // app-defaulten (Riksdag/Riket) → ren URL
  // Bygg strängen för hand så "nivå:kod" behåller ett läsbart kolon (URLSearchParams
  // %3A-kodar det). Koderna är siffror/korta alfanumeriska → encodeURIComponent är no-op.
  const omrade = areaIsDefault ? '' : `&omrade=${area.level}${area.code ? ':' + encodeURIComponent(area.code) : ''}`
  return `?val=${valtyp}${omrade}`
}

type NamedCode = { code: string; name: string }
type ChangeListener = (vd: string, valtyp: Valtyp) => void
export type WinnerParty = { forkortning: string | null; farg: string | null }
// Dataset-provenance (dataset_meta, EN rad) — vilken källa färgar kartan. test=true &
// source='genrep2026' under förvalsperioden → UI:t visar en "generalrep/testdata"-banner.
export type DatasetMeta = {
  source: string
  valtillfalle: string | null
  test: boolean
  rakningstillfalle: string | null
  kalla_uppdaterad: string | null
}

export interface ResultsContextValue {
  // Delad UI-state
  valtyp: Valtyp
  setValtyp: (v: Valtyp) => void
  selectedArea: Area
  setSelectedArea: (a: Area) => void

  // Stabila referens-refar (läses vid beräkning; useMemo nycklar på revision).
  storesRef: RefObject<Record<Valtyp, ResultStore>>
  turnoutStoresRef: RefObject<Record<Valtyp, TurnoutStore>>
  partyRef: RefObject<Map<string, PartyMeta>>
  metaRef: RefObject<Map<string, DistrictMeta>>
  allCodesRef: RefObject<string[]>
  groupsRef: RefObject<AreaGroups>
  // Uppsamlingsröster per valtyp, hinkade på organ-kod (RD '', RF lankod, KF kommunkod).
  uppsamlingRef: RefObject<Record<Valtyp, Map<string, PartyVotes>>>
  comparisonRef: RefObject<Comparison2022 | null>
  districtComparisonRef: RefObject<Map<string, string>>
  distriktNamnRef: RefObject<Map<string, string>>
  district2022Ref: RefObject<Map<string, AreaComparison | null>>
  // 2022 års vinnarparti per distrikt (batch-hämtat per kommun för drill-down-listan).
  districtWinners2022Ref: RefObject<Map<string, WinnerParty | null>>
  districtAndel2022Ref: RefObject<Map<string, Record<string, number>>> // vd → beteckning → 2022-andel (per-parti-kolumner)
  ensureDistrictWinners2022: (valtyp: Valtyp, kommunCode: string) => void

  // Områdesväljar-listor + HUD-nämnare
  kommuner: NamedCode[]
  regioner: NamedCode[]
  valkretsar: NamedCode[] // valkretsar för AKTIV valtyp (RD 29 / RF 62; KF tom)
  valkretsListRef: RefObject<Record<Valtyp, NamedCode[]>> // valkrets-namn PER valtyp (avgångstavlan visar en annan valtyp än den aktiva)
  areaIndexRef: RefObject<Record<Valtyp, AreaIndex>> // valkretsindex per valtyp
  totalByValtyp: Record<Valtyp, number>

  // Signalkanaler
  subscribeChanges: (fn: ChangeListener) => () => void
  // Fas 3: be providern ladda EN valtyps resultat-snapshot (idempotent; no-op om redan
  // laddad/på väg). Tavlan kallar den för sin valtyp så icke-aktiva valtyper laddas i mobil.
  ensureValtypLoaded: (vt: Valtyp) => void
  revision: number
  snapshotVersion: number
  realtimeConnected: boolean // Realtime-kanalens status (SUBSCRIBED) → live-indikator
  dataset: DatasetMeta | null // datakällans provenance (genrep/skarpt) → UI-banner
}

const ResultsContext = createContext<ResultsContextValue | null>(null)

export function useResults(): ResultsContextValue {
  const ctx = useContext(ResultsContext)
  if (!ctx) throw new Error('useResults måste användas inuti <ResultsProvider>')
  return ctx
}

const emptyCounts = (): Record<Valtyp, number> => ({ RD: 0, RF: 0, KF: 0 })

export function ResultsProvider({ children }: { children: ReactNode }) {
  // Startvy ur URL:en (delbar permalänk), annars Riksdag/Riket.
  const [valtyp, setValtypState] = useState<Valtyp>(() => readViewFromUrl().valtyp)
  const [selectedArea, setSelectedArea] = useState<Area>(() => readViewFromUrl().area)
  // Byt valtyp → nollställ området till den nya valtypens nativa default (ett
  // kommun-val kan inte visa "Riket" osv). Ett valt DISTRIKT behålls dock — samma
  // 8-siffriga kod gäller i alla tre valen, så man kan jämföra distriktets RD/RF/KF.
  const setValtyp = useCallback((v: Valtyp) => {
    setValtypState(v)
    setSelectedArea((prev) => (prev.level === 'distrikt' ? prev : defaultAreaFor(v)))
  }, [])
  // Spegla vald vy i URL:en (delbar). replaceState → ingen historik-skräp; länken
  // pekar alltid på nuvarande valtyp + område.
  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname + viewToSearch(valtyp, selectedArea) + window.location.hash)
  }, [valtyp, selectedArea])
  const [revision, setRevision] = useState(0)
  const [snapshotVersion, setSnapshotVersion] = useState(0)
  const [kommuner, setKommuner] = useState<NamedCode[]>([])
  const [regioner, setRegioner] = useState<NamedCode[]>([])
  const [totalByValtyp, setTotalByValtyp] = useState<Record<Valtyp, number>>(emptyCounts)
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  const [dataset, setDataset] = useState<DatasetMeta | null>(null)

  const storesRef = useRef<Record<Valtyp, ResultStore>>(null!)
  if (!storesRef.current) {
    storesRef.current = { RD: new ResultStore(), RF: new ResultStore(), KF: new ResultStore() }
  }
  // Valdeltagande per valtyp (stabil ref, muteras in-place, byts aldrig — som storesRef). Laddas
  // i ensureValtypLoaded och hålls färsk av samma inkrementella resync som result.
  const turnoutStoresRef = useRef<Record<Valtyp, TurnoutStore>>(null!)
  if (!turnoutStoresRef.current) {
    turnoutStoresRef.current = { RD: new TurnoutStore(), RF: new TurnoutStore(), KF: new TurnoutStore() }
  }
  const partyRef = useRef<Map<string, PartyMeta>>(new Map())
  const metaRef = useRef<Map<string, DistrictMeta>>(new Map())
  const allCodesRef = useRef<string[]>([])
  const groupsRef = useRef<AreaGroups>(buildGroups([]))
  // Uppsamlingsröster per valtyp, hinkade på organ-kod. Läses en gång vid mount (nedan).
  const uppsamlingRef = useRef<Record<Valtyp, Map<string, PartyVotes>>>({ RD: new Map(), RF: new Map(), KF: new Map() })
  // Valkretsindex per valtyp (RD 2-siffrig vk_rd, RF 4-siffrig län-prefixad vk_rf).
  // Byggs en gång ur distriktsmetadatan; KF har ingen valkretsnivå (tomt index).
  const emptyIndex = (): AreaIndex => ({ districtToVk: new Map(), vkToDistricts: new Map(), kommunToVk: new Map() })
  const areaIndexRef = useRef<Record<Valtyp, AreaIndex>>({ RD: emptyIndex(), RF: emptyIndex(), KF: emptyIndex() })
  // Valkretslistor (kod+namn) per valtyp — resolveras till aktiv valtyp i värdet nedan.
  const valkretsListRef = useRef<Record<Valtyp, NamedCode[]>>({ RD: [], RF: [], KF: [] })
  const comparisonRef = useRef<Comparison2022 | null>(null)
  const districtComparisonRef = useRef<Map<string, string>>(new Map())
  const distriktNamnRef = useRef<Map<string, string>>(new Map()) // vd-kod → distriktsnamn (tabellrubrik vid kartklick)
  // 2022 per distrikt, lazy-hämtat på klick (`${valtyp}:${vd}` → löv, eller null om NEJ/inget).
  const district2022Ref = useRef<Map<string, AreaComparison | null>>(new Map())
  // 2022 års vinnarparti per distrikt (vd → parti), batch-hämtat per kommun för drill-listan.
  const districtWinners2022Ref = useRef<Map<string, WinnerParty | null>>(new Map())
  // 2022 års FULLA andel per distrikt (vd → beteckning → andel), samma batch-hämtning —
  // driver per-parti-kolumnerna i "Bryt ner" på distriktsnivå.
  const districtAndel2022Ref = useRef<Map<string, Record<string, number>>>(new Map())
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
        // Full andel per distrikt (beteckning → andel) för per-parti-kolumnerna.
        const full = districtAndel2022Ref.current.get(r.valdistriktskod) ?? districtAndel2022Ref.current.set(r.valdistriktskod, {}).get(r.valdistriktskod)!
        full[r.beteckning] = r.andel
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


  // --- Fas 3: efterfrågestyrd snapshot-laddning per valtyp -------------------------------
  // En vy laddar bara den valtyp den faktiskt visar. Mobil Karta/Resultat visar EN valtyp
  // → ~⅓ av /result-läslasten (och ⅓ av raderna i minnet) på en telefon. Desktop monterar
  // alla tre tavlorna → alla tre laddas ändå, så desktop-beteendet är oförändrat.
  //   loaded  = klar (bumpar snapshotVersion en gång)
  //   loading = pågår → idempotens-vakt mot dubbelladdning (tavla + karta ber samtidigt)
  //   retry   = backoff-räknare vid transient fel (nätverk/PostgREST), kapad till 5 försök
  // aliveRef: pagineringsloopen kan pågå när providern unmountas → sluta då skriva state.
  const loadedValtyperRef = useRef<Set<Valtyp>>(new Set())
  const loadingValtyperRef = useRef<Set<Valtyp>>(new Set())
  const retryRef = useRef<Record<Valtyp, number>>({ RD: 0, RF: 0, KF: 0 })
  const aliveRef = useRef(true)
  // Auto-resync-cursor: högsta `updated_at` klienten sett per valtyp. Sätts av snapshoten och
  // flyttas fram av varje resync → nästa resync hämtar bara deltan (`updated_at >= cursor`).
  const cursorRef = useRef<Record<Valtyp, string>>({ RD: '', RF: '', KF: '' })
  const resyncingRef = useRef<Record<Valtyp, boolean>>({ RD: false, RF: false, KF: false })
  // Egen resync-cursor för turnout (updated_at), skild från result-cursorn. Sätts av turnout-
  // snapshoten och flyttas fram av varje turnout-resync.
  const turnoutCursorRef = useRef<Record<Valtyp, string>>({ RD: '', RF: '', KF: '' })
  const turnoutResyncingRef = useRef<Record<Valtyp, boolean>>({ RD: false, RF: false, KF: false })

  const ensureValtypLoaded = useCallback((vt: Valtyp) => {
    if (loadedValtyperRef.current.has(vt) || loadingValtyperRef.current.has(vt)) return
    loadingValtyperRef.current.add(vt)
    ;(async () => {
      let ok = false
      try {
        // Filtrerad på EN valtyp (eq). rapporteringstid kan saknas i ett kort deploy-fönster
        // → fall tillbaka utan kolumnen EN gång (börja om med de smalare kolumnerna).
        //
        // KEYSET-PAGINERING (inte OFFSET): stega på sista sedda nyckeln (valdistriktskod, partikod)
        // via ett `where (vd, pk) > (sista)`-villkor i stället för `.range(from, …)`. OFFSET N
        // tvingar Postgres att skanna + slänga N rader per sida → hela snapshoten blir O(n²) i
        // radantal (~162k rader ⇒ ~16 sidor, sista sidan skannar förbi ~150k). Dyrast är inte en
        // ensam läsning utan HERDEN: vid valnatt monterar många flikar samtidigt och snapshotar på
        // en gång — 50-flikars-lasttestet mätte 15 s median/läsning mot ~1,7 s solo. Keyset gör
        // varje sida till en index-range-scan (hoppa direkt till nyckeln, läs framåt) → O(n) totalt.
        //
        // STABIL NYCKELORDNING dessutom korrekt under samtidiga skrivningar: (valdistriktskod,
        // partikod) är PK inom valtyp, upsert-vägen byter aldrig nyckel och raderar aldrig → varje
        // sida börjar strikt EFTER förra sidans sista nyckel, så en rad kan varken hoppas över eller
        // dubbleras även när edge re-upsertar mitt i läsningen. Rader som skjuts in BAKOM cursorn
        // mid-scan städas ändå av resyncen (updated_at >= cursor). '' < alla 8-siffriga koder
        // lexikografiskt → tom startnyckel tar första sidan. Stega tills en TOM sida (inte tills
        // sida < PAGE): PostgREST:s max-rows kan kapa sidan under PAGE utan att den är sista.
        const PAGE = 10000
        let cols = 'valtyp,valdistriktskod,partikod,roster,status,rapporteringstid,updated_at'
        let lastVd = ''
        let lastPk = ''
        while (aliveRef.current) {
          let q = supabase
            .from('result')
            .select(cols)
            .eq('valtyp', vt)
            .order('valdistriktskod', { ascending: true })
            .order('partikod', { ascending: true })
            .limit(PAGE)
          if (lastVd !== '') q = q.or(`valdistriktskod.gt.${lastVd},and(valdistriktskod.eq.${lastVd},partikod.gt.${lastPk})`)
          const { data, error } = await q
          if (error) {
            if (cols.includes('rapporteringstid')) { cols = 'valtyp,valdistriktskod,partikod,roster,status,updated_at'; lastVd = ''; lastPk = ''; continue }
            break // annat fel → lämna ok=false → retrybart nedan
          }
          if (!data || data.length === 0) { ok = true; break }
          for (const r of data as unknown as Array<{ valtyp: string; valdistriktskod: string; partikod: string; roster: number; status?: string | null; rapporteringstid?: string | null; updated_at?: string | null }>) {
            storesRef.current[vt]?.set(r.valdistriktskod, r.partikod, r.roster, r.rapporteringstid, r.status)
            if (r.updated_at && r.updated_at > cursorRef.current[vt]) cursorRef.current[vt] = r.updated_at
          }
          const tail = data[data.length - 1] as unknown as { valdistriktskod: string; partikod: string }
          lastVd = tail.valdistriktskod
          lastPk = tail.partikod
        }
        // Valdeltagande-snapshot för samma valtyp — BEST-EFFORT (ett fel här får inte blockera
        // resultatvisningen; resync-ticken fyller på ändå). Keyset på valdistriktskod (turnouts PK
        // är enkel geo-nyckel → enklare än result). Egen cursor (turnoutCursorRef).
        try {
          let tLast = ''
          while (aliveRef.current) {
            let tq = supabase
              .from('turnout')
              .select('valdistriktskod,totalt_antal_roster,antal_rostberattigade,updated_at')
              .eq('valtyp', vt)
              .order('valdistriktskod', { ascending: true })
              .limit(PAGE)
            if (tLast !== '') tq = tq.gt('valdistriktskod', tLast)
            const { data, error } = await tq
            if (error || !data || data.length === 0) break
            for (const r of data as unknown as Array<{ valdistriktskod: string; totalt_antal_roster: number; antal_rostberattigade: number; updated_at?: string | null }>) {
              turnoutStoresRef.current[vt]?.set(r.valdistriktskod, r.totalt_antal_roster, r.antal_rostberattigade)
              if (r.updated_at && r.updated_at > turnoutCursorRef.current[vt]) turnoutCursorRef.current[vt] = r.updated_at
            }
            tLast = data[data.length - 1].valdistriktskod
          }
        } catch { /* turnout best-effort; resync fyller på nästa varv */ }
        if (!aliveRef.current) return // unmountad mitt i laddningen → varken markera klar eller retry
      } finally {
        loadingValtyperRef.current.delete(vt)
      }
      if (ok) {
        loadedValtyperRef.current.add(vt)
        retryRef.current[vt] = 0
        // Bumpa signalkanalerna → tavlorna reseedar, kartan/tabellen räknar om för denna valtyp.
        setSnapshotVersion((v) => v + 1)
        setRevision((r) => r + 1)
      } else if (aliveRef.current && retryRef.current[vt] < 5) {
        retryRef.current[vt]++ // transient fel → bunden backoff (2s, 4s, …, 10s), ger inte upp tyst
        setTimeout(() => ensureValtypLoaded(vt), 2000 * retryRef.current[vt])
      }
    })()
  }, [])

  // --- Auto-resync: självläkning mot Realtime-släpning ----------------------------------
  // Efter första snapshot lever store:n bara på Realtime-event, som TAPPAR stora txns (>~100
  // rader) under bursts → en långöppen flik driver efter DB och läks idag bara av en full
  // sidladdning. Denna resync hämtar deltan (`updated_at >= cursor`) och spelar upp den genom
  // SAMMA per-distrikt-listeners som Realtime → hela appen (karta/tabell/räknare/tavla) kommer
  // ikapp av sig själv. Returnerar antalet genuint nya rader (för DEV-verifiering).
  //   `>=` (inte `>`): now() är txn-tid, en batch delar tidsstämpel och två samtidiga edge-anrop
  //   kan commita på samma mikrosekund — med `>` skulle en rad på exakt cursor-tiden hoppas över
  //   FÖR ALLTID (tyst hål, precis buggen detta ska döda). store.set är idempotent → att läsa om
  //   gränsbatchen kostar inget. Listeners/revision eldas bara för rader som är genuint nyare än
  //   cursorn (updated_at > cursor) så idle-varv (bara gränsbatchen) inte spammar ompaint.
  const resyncValtyp = useCallback(async (vt: Valtyp): Promise<number> => {
    if (!loadedValtyperRef.current.has(vt)) return 0 // cursorn är satt först när snapshoten är klar
    if (resyncingRef.current[vt]) return 0            // ingen överlappning
    resyncingRef.current[vt] = true
    let changed = 0
    try {
      const cols = 'valdistriktskod,partikod,roster,status,rapporteringstid,updated_at'
      const cursor = cursorRef.current[vt]
      const PAGE = 10000
      let from = 0
      let maxTs = cursor
      while (aliveRef.current) {
        const { data, error } = await supabase
          .from('result')
          .select(cols)
          .eq('valtyp', vt)
          .gte('updated_at', cursor)
          .order('updated_at', { ascending: true })
          .order('valdistriktskod', { ascending: true }) // stabila tiebreakers → deterministisk
          .order('partikod', { ascending: true })        // paginering även när deltan spänner flera sidor
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        for (const r of data as unknown as Array<{ valdistriktskod: string; partikod: string; roster: number; status?: string | null; rapporteringstid?: string | null; updated_at?: string | null }>) {
          storesRef.current[vt]?.set(r.valdistriktskod, r.partikod, r.roster, r.rapporteringstid, r.status) // idempotent (även gränsbatchen)
          if (r.updated_at && r.updated_at > cursor) {
            for (const fn of listenersRef.current) fn(r.valdistriktskod, vt) // bara genuint nya → kartan målar om
            changed++
          }
          if (r.updated_at && r.updated_at > maxTs) maxTs = r.updated_at
        }
        from += data.length
        if (data.length < PAGE) break
      }
      cursorRef.current[vt] = maxTs
      if (changed > 0) setRevision((r) => r + 1) // en bump per delta (inte per rad) — tabellen räknar om
    } finally {
      resyncingRef.current[vt] = false
    }
    return changed
  }, [])

  // Valdeltagande-resync: samma inkrementella delta-mönster som result (updated_at >= cursor), men
  // enklare — inga per-distrikt-listeners (valdeltagande matar bara panel-aggregatet, som räknar om
  // på revision). Offset-paginering räcker: deltan är liten (bara ändrade distrikt). Ingen Realtime
  // på turnout → detta (+ snapshoten) är enda live-vägen; körs i 60s-ticken.
  const resyncTurnout = useCallback(async (vt: Valtyp): Promise<number> => {
    if (!loadedValtyperRef.current.has(vt)) return 0 // cursorn sätts först när snapshoten är klar
    if (turnoutResyncingRef.current[vt]) return 0     // ingen överlappning
    turnoutResyncingRef.current[vt] = true
    let changed = 0
    try {
      const cursor = turnoutCursorRef.current[vt]
      const PAGE = 10000
      let from = 0
      let maxTs = cursor
      while (aliveRef.current) {
        const { data, error } = await supabase
          .from('turnout')
          .select('valdistriktskod,totalt_antal_roster,antal_rostberattigade,updated_at')
          .eq('valtyp', vt)
          .gte('updated_at', cursor)
          .order('updated_at', { ascending: true })
          .order('valdistriktskod', { ascending: true }) // stabil tiebreaker → deterministisk paginering
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        for (const r of data as unknown as Array<{ valdistriktskod: string; totalt_antal_roster: number; antal_rostberattigade: number; updated_at?: string | null }>) {
          turnoutStoresRef.current[vt]?.set(r.valdistriktskod, r.totalt_antal_roster, r.antal_rostberattigade) // idempotent
          if (r.updated_at && r.updated_at > cursor) changed++
          if (r.updated_at && r.updated_at > maxTs) maxTs = r.updated_at
        }
        from += data.length
        if (data.length < PAGE) break
      }
      turnoutCursorRef.current[vt] = maxTs
      if (changed > 0) setRevision((r) => r + 1) // en bump per delta → panelen räknar om valdeltagandet
    } finally {
      turnoutResyncingRef.current[vt] = false
    }
    return changed
  }, [])


  // Uppsamling live: laddar om HELA uppsamlings-aggregatet (litet — max ~314 distrikt × parti ×
  // valtyp, oftast 0 rader före onsdag). Anropas vid mount, Realtime-event, periodisk resync och
  // reconnect. Full omladdning (inte cursor-delta som result): tabellen bucketas till organ-hinkar
  // så per-rad-delta går inte att applicera inkrementellt, och den är liten nog att läsa om helt.
  // Edge upsertar uppsamling i 500-radersklungor → Realtime (tappar >~100-rads-txns) missar den
  // ofta, så den PERIODISKA omladdningen är primärmekanismen; Realtime en bonus för små ändringar.
  // Busy/again-vakt koalescerar burst; på fel BEHÅLLS förra aggregatet (ingen tyst nollning live).
  const uppsamlingBusyRef = useRef(false)
  const uppsamlingAgainRef = useRef(false)
  const loadUppsamling = useCallback(async () => {
    if (uppsamlingBusyRef.current) { uppsamlingAgainRef.current = true; return }
    uppsamlingBusyRef.current = true
    try {
      do {
        uppsamlingAgainRef.current = false
        const next: Record<Valtyp, Map<string, PartyVotes>> = { RD: new Map(), RF: new Map(), KF: new Map() }
        const PAGE = 10000
        let from = 0
        let failed = false
        while (aliveRef.current) {
          const { data, error } = await supabase
            .from('uppsamling_result')
            .select('valtyp,kommunkod,lankod,partikod,roster')
            .order('valtyp', { ascending: true }) // PK-ordning (valtyp,kod,partikod) → stabil, ingen överhoppad rad
            .order('kod', { ascending: true })
            .order('partikod', { ascending: true })
            .range(from, from + PAGE - 1)
          if (error) { failed = true; break }
          if (!data || data.length === 0) break
          for (const r of data as unknown as Array<{ valtyp: string; kommunkod: string; lankod: string; partikod: string; roster: number }>) {
            const m = next[r.valtyp as Valtyp]
            if (!m) continue
            // Organ-nyckel: RD → riket (EN hink), RF → länet, KF → kommunen.
            const key = r.valtyp === 'RD' ? '' : r.valtyp === 'RF' ? r.lankod : r.kommunkod
            const bucket = m.get(key) ?? m.set(key, {}).get(key)!
            bucket[r.partikod] = (bucket[r.partikod] ?? 0) + r.roster
          }
          from += data.length
          if (data.length < PAGE) break
        }
        if (!aliveRef.current) return
        // Fel (t.ex. tabell saknas i ett kort deploy-fönster) → behåll förra aggregatet, ingen krasch/nollning.
        if (!failed) { uppsamlingRef.current = next; setRevision((r) => r + 1) }
      } while (uppsamlingAgainRef.current && aliveRef.current)
    } finally {
      uppsamlingBusyRef.current = false
    }
  }, [])

  // Poll-loop — PRIMÄR uppdateringsväg sedan Realtime togs bort. Var 45–90 s (jittrat) hämtar varje
  // LADDAD valtyp sin delta + laddar om uppsamling, men BARA när fliken är synlig (bakgrundsflik
  // ligger tyst → sparar last). Refresh körs DIREKT när fliken blir synlig igen (tab-fokus). "Live"-
  // pulsen tänds när vi pollar synligt, släcks i bakgrund.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const pump = () => {
      for (const vt of VALTYPER) if (loadedValtyperRef.current.has(vt)) { void resyncValtyp(vt); void resyncTurnout(vt) }
      void loadUppsamling()
      setRealtimeConnected(true) // aktiv, synlig pollning → "Live" pulserar
    }
    const schedule = () => {
      timer = setTimeout(() => {
        if (document.visibilityState === 'visible') pump()
        schedule() // jittra nästa varv
      }, RESYNC_MIN_MS + Math.random() * (RESYNC_MAX_MS - RESYNC_MIN_MS))
    }
    if (document.visibilityState === 'visible') setRealtimeConnected(true) // "Live" direkt från mount
    schedule()
    const onVisible = () => {
      if (document.visibilityState === 'visible') pump()      // snappa färskt vid tab-fokus
      else setRealtimeConnected(false)                         // bakgrund → dämpad indikator
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [resyncValtyp, resyncTurnout, loadUppsamling])

  // Nämnare (mount-en gång). Realtime är BORTTAGET → uppdateringar kommer via poll-loopen ovan;
  // snapshoten laddas efterfrågestyrt per valtyp (ensureValtypLoaded), triggad av aktiv valtyp +
  // monterade tavlor.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Per-valtyp nämnare: distrikt som deltar (vk_<valtyp> satt). Kolumnen är TOMSTRÄNG (inte
      // null) där valet inte hålls (t.ex. Gotland saknar regionval → vk_rf='') → exkludera både
      // null OCH '', annars räknas Gotland in i RF.
      const counts = emptyCounts()
      for (const vt of VALTYPER) {
        const { count } = await supabase
          .from('district')
          .select('*', { count: 'exact', head: true })
          .not(VALTYP_VK_COLUMN[vt], 'is', null)
          .neq(VALTYP_VK_COLUMN[vt], '')
        counts[vt] = count ?? 0
      }
      if (!cancelled) setTotalByValtyp(counts)
    })()
    return () => { cancelled = true }
  }, [])

  // Livstidsvakt för pagineringsloopar (ensureValtypLoaded lever över hela providerns liv,
  // inte en enskild effekts cleanup). StrictMode: false vid cleanup, true igen vid remount.
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  // Ladda den AKTIVA valtypens snapshot (och ladda om vid valtyp-byte om den är oladdad).
  // Placerad EFTER Realtime-effekten så kanalen är uppsatt först. Desktop-tavlorna monterar
  // alla tre valtyperna och triggar sina egna ensureValtypLoaded → alla tre laddas där.
  useEffect(() => {
    ensureValtypLoaded(valtyp)
  }, [valtyp, ensureValtypLoaded])

  // DEV-only introspektion för headless-validering av fas 3 (Vite strippar hela grenen ur
  // prod-bygget). Getters läser refar live → alltid färskt utan omregistrering. Read-only.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as { __results?: unknown }).__results = {
      loaded: () => [...loadedValtyperRef.current],
      loading: () => [...loadingValtyperRef.current],
      reported: () => ({
        RD: storesRef.current.RD.reportedCount,
        RF: storesRef.current.RF.reportedCount,
        KF: storesRef.current.KF.reportedCount,
      }),
      // Auto-resync-introspektion (headless-verifiering): läs cursorn, kör en resync manuellt
      // (returnerar antal genuint nya rader), eller spola cursorn bakåt för att FRAMTVINGA en
      // delta mot den live-churnande DB:n (bevisar hämta→applicera→cursor-framflyttning).
      cursor: () => ({ ...cursorRef.current }),
      resync: (vt: Valtyp) => resyncValtyp(vt),
      setCursor: (vt: Valtyp, iso: string) => { cursorRef.current[vt] = iso },
      // Uppsamling-introspektion: antal organ-hinkar + total röster per valtyp, samt manuell
      // omladdning (bevisar att live-vägen plockar upp nyinsatta uppsamlingsrader).
      uppsamling: () => Object.fromEntries((['RD', 'RF', 'KF'] as Valtyp[]).map((vt) => {
        const m = uppsamlingRef.current[vt]
        let roster = 0
        for (const b of m.values()) for (const v of Object.values(b)) roster += v
        return [vt, { buckets: m.size, roster }]
      })),
      reloadUpp: () => loadUppsamling(),
      // Valdeltagande-introspektion: kör en turnout-resync, eller läs aggregatet för en
      // uppsättning distriktskoder (Σtotal/Σröstberättigade → %). tCursor spolar cursorn.
      turnoutCursor: () => ({ ...turnoutCursorRef.current }),
      resyncTurnout: (vt: Valtyp) => resyncTurnout(vt),
      turnout: (vt: Valtyp, codes: string[]) => turnoutStoresRef.current[vt].aggregate(codes),
    }
  }, [resyncValtyp, resyncTurnout, loadUppsamling])

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
      const idxRD: AreaIndex = { districtToVk: new Map(), vkToDistricts: new Map(), kommunToVk: new Map() }
      const idxRF: AreaIndex = { districtToVk: new Map(), vkToDistricts: new Map() }
      const idxKF: AreaIndex = { districtToVk: new Map(), vkToDistricts: new Map() }
      const PAGE = 1000
      for (let from = 0; !cancelled; from += PAGE) {
        const { data, error } = await supabase
          .from('district')
          .select('valdistriktskod,namn,kommun,lan,vk_rd,vk_rf,vk_kf')
          .order('valdistriktskod', { ascending: true }) // stabil ordning → offset kan aldrig hoppa över ett distrikt
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        for (const d of data) {
          const vd = d.valdistriktskod
          codes.push(vd)
          // Normalisera valkretskoder EN gång så de matchar facit-/comparison-koderna
          // — annars faller koder med inledande nolla tyst bort i join:en. vk_rd är
          // opaddat i DB ("1".."29") → 2 siffror; vk_rf är län-prefixat men opaddat
          // ("112") och TOMSTRÄNG för Gotland (inget regionval) → 4 siffror, tomt = null.
          const vkRd = d.vk_rd != null && String(d.vk_rd).trim() !== '' ? String(d.vk_rd).padStart(2, '0') : null
          const vkRf = String(d.vk_rf ?? '').trim() !== '' ? String(d.vk_rf).padStart(4, '0') : null
          const vkKf = String(d.vk_kf ?? '').trim() !== '' ? String(d.vk_kf).padStart(6, '0') : null
          meta.set(vd, { vk_rd: vkRd, vk_rf: vkRf, vk_kf: vkKf })
          namn.set(vd, d.namn ?? vd)
          kommunMap.set(vd.slice(0, 4), d.kommun ?? vd.slice(0, 4))
          lanMap.set(vd.slice(0, 2), d.lan ?? vd.slice(0, 2))
          if (vkRd) {
            idxRD.districtToVk.set(vd, vkRd)
            idxRD.kommunToVk!.set(vd.slice(0, 4), vkRd) // RD: valkrets = hela kommuner (många-till-en)
            ;(idxRD.vkToDistricts.get(vkRd) ?? idxRD.vkToDistricts.set(vkRd, []).get(vkRd)!).push(vd)
          }
          if (vkRf) {
            idxRF.districtToVk.set(vd, vkRf) // RF: distrikt → valkrets (entydigt, kan dela en kommun)
            ;(idxRF.vkToDistricts.get(vkRf) ?? idxRF.vkToDistricts.set(vkRf, []).get(vkRf)!).push(vd)
          }
          if (vkKf) {
            idxKF.districtToVk.set(vd, vkKf) // KF: distrikt → valkrets (alltid inuti kommunen)
            ;(idxKF.vkToDistricts.get(vkKf) ?? idxKF.vkToDistricts.set(vkKf, []).get(vkKf)!).push(vd)
          }
        }
        if (data.length < PAGE) break
      }
      for (let from = 0; !cancelled; from += PAGE) {
        const { data, error } = await supabase
          .from('district_comparison')
          .select('valdistriktskod,jamforbarhet')
          .order('valdistriktskod', { ascending: true }) // stabil ordning → ingen överhoppad rad
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
      areaIndexRef.current = { RD: idxRD, RF: idxRF, KF: idxKF }
      const bySv = (a: NamedCode, b: NamedCode) => a.name.localeCompare(b.name, 'sv')
      setKommuner([...kommunMap.entries()].map(([code, name]) => ({ code, name })).sort(bySv))
      setRegioner([...lanMap.entries()].map(([code, name]) => ({ code, name })).sort(bySv))
      // Valkretslistor per valtyp: koder ur datan, namn ur comparison-2022 (RD/RF/KF).
      const rdNamn = comparisonRef.current?.RD_valkretsNamn ?? {}
      const rfNamn = comparisonRef.current?.RF_valkretsNamn ?? {}
      const kfNamn = comparisonRef.current?.KF_valkretsNamn ?? {}
      valkretsListRef.current = {
        RD: [...idxRD.vkToDistricts.keys()].map((code) => ({ code, name: rdNamn[code] ?? code })).sort(bySv),
        RF: [...idxRF.vkToDistricts.keys()].map((code) => ({ code, name: rfNamn[code] ?? code })).sort(bySv),
        KF: [...idxKF.vkToDistricts.keys()].map((code) => ({ code, name: kfNamn[code] ?? code })).sort(bySv),
      }
      // Metadata redo → kartan får rätt färger (partyRef) och tabellen sitt aggregat.
      setSnapshotVersion((v) => v + 1)
      setRevision((r) => r + 1)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Uppsamlingsröster (sena röster, onsdagsräkningen) → per-valtyp organ-hinkar, invägda i
  // organ-aggregaten (KF-kommun/RF-region/RD-riket) i panelen så presentationen matchar val.se:s
  // totaler. Laddas vid mount OCH live (Realtime + periodisk resync + reconnect, se `loadUppsamling`)
  // så uppsamling som mot förmodan kommer redan på valnatten syns utan sidladdning.
  useEffect(() => {
    void loadUppsamling()
  }, [loadUppsamling])

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

  // Dataset-provenance (genrep/skarpt) för UI-bannern. Hämtas vid mount + när en ny
  // bulkladdning skett (snapshotVersion) så "källa uppdaterad"-tiden hålls färsk.
  useEffect(() => {
    let alive = true
    supabase
      .from('dataset_meta')
      .select('source,valtillfalle,test,rakningstillfalle,kalla_uppdaterad')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (alive && data) setDataset(data as DatasetMeta)
      })
    return () => {
      alive = false
    }
  }, [snapshotVersion])

  const value: ResultsContextValue = {
    turnoutStoresRef,
    valtyp,
    setValtyp,
    selectedArea,
    setSelectedArea,
    storesRef,
    partyRef,
    metaRef,
    allCodesRef,
    groupsRef,
    uppsamlingRef,
    comparisonRef,
    districtComparisonRef,
    distriktNamnRef,
    district2022Ref,
    districtWinners2022Ref,
    districtAndel2022Ref,
    ensureDistrictWinners2022,
    kommuner,
    regioner,
    valkretsar: valkretsListRef.current[valtyp], // resolveras till aktiv valtyp (re-render vid valtyp/snapshot)
    valkretsListRef,
    areaIndexRef,
    totalByValtyp,
    subscribeChanges,
    ensureValtypLoaded,
    revision,
    snapshotVersion,
    realtimeConnected,
    dataset,
  }

  return <ResultsContext.Provider value={value}>{children}</ResultsContext.Provider>
}
