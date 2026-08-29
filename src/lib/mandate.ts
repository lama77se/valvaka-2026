// Mandatberäkning — jämkade uddatalsmetoden (modifierad Sainte-Laguë).
//
// REN funktion: röster in → mandat ut. Ingen DB/IO. Samma modul kör på 2022
// stand-in (regressionstest) nu och 2026 live sen, och på ALLA tre valtyperna
// (riksdag/region/kommun) — bara config skiljer. Spärrar/divisor/fasta mandat
// per valkrets är CONFIG, inte hårdkodat (arkitektur.md §5).
//
// ⚠️ Verifieras steg för steg mot Valmyndighetens 2022-facit (scripts/
// verify-mandate.ts): röstaggregat → spärrset → fasta mandat per valkrets
// (diskriminerande: exakt match på "rena" valkretsar utan utjämningsmandat) →
// 349 mot Riket-facit. Region/kommun nivellerar FULLSTÄNDIGT (Vallag 14 kap., inget
// överskott) → `config.fullyLevels`, verifierat mot RF/KF-facit i verify-overhang.ts
// (RF 20/20, KF 290/290). Riksdagens överskottsgren (39 FASTA utjämningsmandat →
// överskottsmandat kan behållas) triggas inte av RD 2022 och täcks av ett syntetiskt
// handräknat fall. Lott-brytning är deterministisk på partikod — facit, inte minnet.

export type PartyVotes = Record<string, number> // partikod -> röster
export type ConstituencyVotes = Record<string, PartyVotes> // valkretskod -> {partikod -> röster}

export interface MandateConfig {
  totalSeats: number // 349 för riksdagen
  firstDivisor: number // 1.2 (jämkning) — används i den församlingsvida proportionella fördelningen
  nationalThreshold: number // 0.04
  constituencyThreshold: number // 0.12 (klarar spärr om ≥ i EN valkrets)
  fixedSeatsByConstituency: Record<string, number> // valkretskod -> fasta mandat (summa = totalSeats - utjämning)
  // Region/kommun (Vallag 14 kap.): utjämningsmandaten är INTE fixerade till ett antal
  // utan nivellerar FULLSTÄNDIGT → slutfördelningen blir proportionell mot hela
  // valområdet, inget överskott behålls. Riksdagen (default) har 39 FASTA
  // utjämningsmandat och kan därför lämna överskottsmandat (överhängsgrenen nedan).
  fullyLevels?: boolean
}

export interface MandateResult {
  qualified: string[] // partikoder över spärren
  nationalVotes: PartyVotes
  seatsByParty: Record<string, number> // slutligt per parti (fasta + utjämning)
  nationalTarget: Record<string, number> // proportionell 349-fördelning (steg C)
  fixedByParty: Record<string, number> // summa fasta mandat per parti (steg B)
  fixedByConstituencyParty: Record<string, Record<string, number>> // valkrets -> parti -> fasta
  levelingByParty: Record<string, number> // utjämning per parti (target - fasta, ≥0)
  overhangParties: string[] // partier med fler fasta än proportionellt (sätts åt sidan)
}

// Fördela `seats` mandat bland `votes` med modifierad Sainte-Laguë (första
// divisor `firstDivisor`, sedan 3, 5, 7, ...). Högsta-jämförelsetal, ett i taget.
export function modifiedSainteLague(
  votes: PartyVotes,
  seats: number,
  firstDivisor: number,
): Record<string, number> {
  const parties = Object.keys(votes)
  const awarded: Record<string, number> = Object.fromEntries(parties.map((p) => [p, 0]))
  const quotient = (p: string) => {
    const n = awarded[p]
    const divisor = n === 0 ? firstDivisor : 2 * n + 1
    return votes[p] / divisor
  }
  for (let s = 0; s < seats; s++) {
    let best: string | null = null
    let bestQ = -Infinity
    for (const p of parties) {
      const q = quotient(p)
      // Lika jämförelsetal ska avgöras med lott; här: deterministisk tie-break
      // på partikod (ersätts om facit kräver äkta lott — se stage-test).
      if (q > bestQ || (q === bestQ && best !== null && p < best)) {
        bestQ = q
        best = p
      }
    }
    if (best === null) break
    awarded[best]++
  }
  return awarded
}

function sumVotes(cv: ConstituencyVotes): PartyVotes {
  const total: PartyVotes = {}
  for (const party of Object.values(cv))
    for (const [p, v] of Object.entries(party)) total[p] = (total[p] ?? 0) + v
  return total
}

// Generisk: samma jämkade uddatalsmetod driver riksdag, region OCH kommun — bara
// config skiljer (platser, spärr, valkretsar, fasta mandat). För riksdag: spärr
// 4 % riks ELLER 12 % i en valkrets. För region/kommun: ingen 12 %-regel → sätt
// constituencyThreshold till Infinity så bara den församlingsvida spärren gäller.
export function computeAssembly(
  votesByConstituency: ConstituencyVotes,
  config: MandateConfig,
): MandateResult {
  const nationalVotes = sumVotes(votesByConstituency)
  const nationalTotal = Object.values(nationalVotes).reduce((a, b) => a + b, 0)

  // Steg A — spärr: ≥4% i riket ELLER ≥12% i en valkrets.
  const clearsNational = (p: string) => nationalVotes[p] / nationalTotal >= config.nationalThreshold
  const clearsConstituency = (p: string) =>
    Object.values(votesByConstituency).some((cv) => {
      const tot = Object.values(cv).reduce((a, b) => a + b, 0)
      return tot > 0 && (cv[p] ?? 0) / tot >= config.constituencyThreshold
    })
  const qualified = Object.keys(nationalVotes).filter((p) => clearsNational(p) || clearsConstituency(p))

  const keepQualified = (v: PartyVotes): PartyVotes =>
    Object.fromEntries(qualified.map((p) => [p, v[p] ?? 0]))

  // Steg B — fasta valkretsmandat: modifierad S-L per valkrets bland kvalificerade.
  const fixedByConstituencyParty: Record<string, Record<string, number>> = {}
  const fixedByParty: Record<string, number> = Object.fromEntries(qualified.map((p) => [p, 0]))
  for (const [vk, cv] of Object.entries(votesByConstituency)) {
    const seats = config.fixedSeatsByConstituency[vk] ?? 0
    const alloc = modifiedSainteLague(keepQualified(cv), seats, config.firstDivisor)
    fixedByConstituencyParty[vk] = alloc
    for (const [p, n] of Object.entries(alloc)) fixedByParty[p] += n
  }

  // Steg C — proportionell 349-fördelning i riket (hela landet som en valkrets).
  const nationalTarget = modifiedSainteLague(
    keepQualified(nationalVotes),
    config.totalSeats,
    config.firstDivisor,
  )

  // Region/kommun: fullständig utjämning → totalen ÄR den proportionella (nationalTarget),
  // inget överskott behålls (Vallag 14 kap.). Fasta valkretsmandaten avgör bara VAR
  // mandaten sitter, inte partitotalen. Verifierat mot 2022-facit (RF 20/20, KF 290/290)
  // i scripts/verify-overhang.ts. Utan detta ger riksdagens överhängsgren fel RF/KF-totaler.
  if (config.fullyLevels) {
    const levelingByParty: Record<string, number> = {}
    for (const p of qualified) levelingByParty[p] = Math.max(0, nationalTarget[p] - fixedByParty[p])
    return { qualified, nationalVotes, seatsByParty: { ...nationalTarget }, nationalTarget, fixedByParty, fixedByConstituencyParty, levelingByParty, overhangParties: [] }
  }

  // Steg D (riksdag) — utjämning: target − fasta per parti. Överhäng (fasta > target)
  // hanteras genom att sätta partiet åt sidan med sina fasta och räkna om resten
  // proportionellt bland övriga (Vallag 14 kap. 3 §, riksdagens 39 fasta utjämnings-
  // mandat kan lämna överskottsmandat). Iterera tills stabilt.
  const overhangParties: string[] = []
  let target = nationalTarget
  for (;;) {
    const newOverhang = qualified.filter(
      (p) => !overhangParties.includes(p) && fixedByParty[p] > target[p],
    )
    if (newOverhang.length === 0) break
    overhangParties.push(...newOverhang)
    const remainingSeats =
      config.totalSeats - overhangParties.reduce((a, p) => a + fixedByParty[p], 0)
    const others = qualified.filter((p) => !overhangParties.includes(p))
    const othersVotes = Object.fromEntries(others.map((p) => [p, nationalVotes[p]]))
    const realloc = modifiedSainteLague(othersVotes, remainingSeats, config.firstDivisor)
    target = { ...Object.fromEntries(overhangParties.map((p) => [p, fixedByParty[p]])), ...realloc }
  }

  const levelingByParty: Record<string, number> = {}
  const seatsByParty: Record<string, number> = {}
  for (const p of qualified) {
    const leveling = Math.max(0, target[p] - fixedByParty[p])
    levelingByParty[p] = leveling
    seatsByParty[p] = fixedByParty[p] + leveling
  }

  return {
    qualified,
    nationalVotes,
    seatsByParty,
    nationalTarget: target,
    fixedByParty,
    fixedByConstituencyParty,
    levelingByParty,
    overhangParties,
  }
}
