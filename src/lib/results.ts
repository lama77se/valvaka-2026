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

  set(valdistriktskod: string, partikod: string, roster: number): void {
    let parties = this.byDistrict.get(valdistriktskod)
    if (!parties) {
      parties = new Map()
      this.byDistrict.set(valdistriktskod, parties)
    }
    parties.set(partikod, roster)
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

  get reportedCount(): number {
    return this.byDistrict.size
  }
}
