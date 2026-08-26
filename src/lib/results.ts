// Fas 5 — härledning av distriktsresultat ur `result`-rader (röster per parti per
// distrikt) till vinnare + marginal, för kartfärgning. Ren logik, ingen IO.
//
// En `result`-rad = ett parti i ett distrikt (PK: valtyp, valdistriktskod,
// partikod). Klienten ackumulerar rader per distrikt och räknar om vinnaren när
// nya röster strömmar in via Realtime.
//
// Fas 6: tre val på samma geometri. Distrikten är desamma; bara resultatlagret
// skiljer per valtyp. Klienten håller en ResultStore per valtyp och färgar från
// den valda (valtyp-väljare) — inte tre kartor.
export const VALTYPER = ['RD', 'RF', 'KF'] as const
export type Valtyp = (typeof VALTYPER)[number]

export const VALTYP_LABEL: Record<Valtyp, string> = {
  RD: 'Riksdag',
  RF: 'Region',
  KF: 'Kommun',
}

// Slutresultat-läge per valtyp: preliminärt (valnatt) → sluträknas (onsdagsräkningen
// pågår, distrikt för distrikt) → slutgiltigt (alla distrikt slutligt räknade).
export type SlutligState = 'preliminar' | 'slutraknas' | 'slutlig'

// district-kolumnen som avgör om ett distrikt deltar i valtypen (→ HUD-nämnare).
export const VALTYP_VK_COLUMN: Record<Valtyp, 'vk_rd' | 'vk_rf' | 'vk_kf'> = {
  RD: 'vk_rd',
  RF: 'vk_rf',
  KF: 'vk_kf',
}

export interface DistrictOutcome {
  winner: string | null // partikod med flest röster (null = inga röster ännu)
  share: number // vinnarens andel av rösterna, 0..1
  margin: number // (1:a − 2:a) / totalt, 0..1 — hur säker ledningen är
  total: number // totala giltiga röster i distriktet hittills
}

const EMPTY: DistrictOutcome = { winner: null, share: 0, margin: 0, total: 0 }

// Ackumulerar result-rader och räknar om vinnaren per distrikt on demand.
export class ResultStore {
  private byDistrict = new Map<string, Map<string, number>>()
  // val.se:s rapporteringstid per distrikt (naiv svensk lokaltid-sträng), för
  // avgångstavlan. Sätts från valfri result-rad för distriktet (samma på alla partier).
  private reportTimes = new Map<string, string>()
  // Distrikt som fått minst EN rad med status 'slutlig' (monoton — slutlig nedgraderas
  // aldrig, se result_no_status_downgrade-triggern). Driver slutresultat-taggen PER valtyp.
  private slutligDistrikt = new Set<string>()

  set(valdistriktskod: string, partikod: string, roster: number, rapporteringstid?: string | null, status?: string | null): void {
    let parties = this.byDistrict.get(valdistriktskod)
    if (!parties) {
      parties = new Map()
      this.byDistrict.set(valdistriktskod, parties)
    }
    parties.set(partikod, roster)
    if (rapporteringstid) this.reportTimes.set(valdistriktskod, rapporteringstid)
    if (status === 'slutlig') this.slutligDistrikt.add(valdistriktskod)
  }

  // Rapporteringstid (rå ISO-sträng "YYYY-MM-DDTHH:MM:SS") eller null om okänd.
  reportTime(valdistriktskod: string): string | null {
    return this.reportTimes.get(valdistriktskod) ?? null
  }

  // Slutresultat-progress för valtypen: 'preliminar' (inga slutliga distrikt än),
  // 'slutraknas' (en del slutligt räknade — siffrorna kan ännu ändras) eller 'slutlig'
  // (ALLA rapporterade distrikt slutligt räknade → siffrorna låsta). Sluträkningen kommer
  // distrikt för distrikt över flera dagar, därav mellanläget med andel (pct).
  slutligProgress(): { state: SlutligState; pct: number } {
    const total = this.byDistrict.size
    const done = this.slutligDistrikt.size
    if (total === 0 || done === 0) return { state: 'preliminar', pct: 0 }
    if (done >= total) return { state: 'slutlig', pct: 100 }
    return { state: 'slutraknas', pct: Math.round((done / total) * 100) }
  }

  outcome(valdistriktskod: string): DistrictOutcome {
    const parties = this.byDistrict.get(valdistriktskod)
    if (!parties || parties.size === 0) return EMPTY
    let total = 0
    let top = -1
    let second = -1
    let winner: string | null = null
    for (const [p, v] of parties) {
      total += v
      if (v > top) {
        second = top
        top = v
        winner = p
      } else if (v > second) {
        second = v
      }
    }
    const share = total > 0 ? top / total : 0
    const margin = total > 0 ? (top - Math.max(second, 0)) / total : 0
    return { winner, share, margin, total }
  }

  districts(): IterableIterator<string> {
    return this.byDistrict.keys()
  }

  has(valdistriktskod: string): boolean {
    return this.byDistrict.has(valdistriktskod)
  }

  // Summera röster per parti över en uppsättning distrikt (område-aggregat).
  aggregate(codes: Iterable<string>): Record<string, number> {
    const total: Record<string, number> = {}
    for (const vd of codes) {
      const parties = this.byDistrict.get(vd)
      if (!parties) continue
      for (const [p, v] of parties) total[p] = (total[p] ?? 0) + v
    }
    return total
  }

  get reportedCount(): number {
    return this.byDistrict.size
  }
}
