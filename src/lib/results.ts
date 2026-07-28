// Fas 5 — härledning av distriktsresultat ur `result`-rader (röster per parti per
// distrikt) till vinnare + marginal, för kartfärgning. Ren logik, ingen IO.
//
// En `result`-rad = ett parti i ett distrikt (PK: valtyp, valdistriktskod,
// partikod). Klienten ackumulerar rader per distrikt och räknar om vinnaren när
// nya röster strömmar in via Realtime. Vi låser valtyp till RD hela Fas 5 (RF/KF
// har egna valkretsar/överhäng och kommer senare).
export const RESULT_VALTYP = 'RD'

export interface DistrictOutcome {
  winner: string | null // partikod med flest röster (null = inga röster ännu)
  margin: number // (1:a − 2:a) / totalt, 0..1 — hur säker ledningen är
  total: number // totala giltiga röster i distriktet hittills
}

const EMPTY: DistrictOutcome = { winner: null, margin: 0, total: 0 }

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
    const margin = total > 0 ? (top - Math.max(second, 0)) / total : 0
    return { winner, margin, total }
  }

  districts(): IterableIterator<string> {
    return this.byDistrict.keys()
  }

  get reportedCount(): number {
    return this.byDistrict.size
  }
}
