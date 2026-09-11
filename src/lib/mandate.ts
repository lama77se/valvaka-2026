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
//
// `extraVotes` (valfri): röster som INTE hör till någon specifik valkrets — uppsamlings-
// röster (sena förtids-/utlandsröster) väger in i organets spärr/proportionella mål (steg
// A/C, alltså kvalificering OCH `nationalTarget`/`levelingByParty`) precis som klientens
// `computeMandate`/`uppsamlingForArea` redan gör för den VISADE organtotalen — men kan
// aldrig tilldelas en valkrets, så steg B (fixedByConstituencyParty) rör dem inte.
// Utelämnad (vanligaste fallet, RD-riket där uppsamling redan vägs in annorlunda) = NO-OP.
export function computeAssembly(
  votesByConstituency: ConstituencyVotes,
  config: MandateConfig,
  extraVotes?: PartyVotes,
): MandateResult {
  const geoVotes = sumVotes(votesByConstituency)
  const nationalVotes = { ...geoVotes }
  if (extraVotes) for (const [p, v] of Object.entries(extraVotes)) nationalVotes[p] = (nationalVotes[p] ?? 0) + v
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

// Placerar UTJÄMNINGSMANDAT (steg D:s levelingByParty) på SPECIFIKA valkretsar — den
// jämförelsetal-baserade placeringen (Vallag/val.se "Så fördelas mandaten") som
// computeAssembly medvetet INTE gör (den ger bara VILKET parti, inte VILKEN valkrets).
//
// Metod: samma jämkade uddatalsmetod, körd EN gång till per parti — men nu ETT
// jämförelsetal PER VALKRETS i stället för ett nationellt, som fortsätter räkningen
// från de mandat partiet REDAN har där (fasta + redan tilldelade utjämningsmandat i
// denna omgång). Ett i taget: partiets nästa utjämningsmandat går till valkretsen med
// högst jämförelsetal just nu, tills partiets hela `levelingByParty`-andel är placerad.
//
// ⚠️ EN verifierad specialregel (12 sep, se scripts/verify-mandate-leveling.ts): i en
// valkrets där partiet har NOLL fasta mandat används INTE den jämkade förstadivisorn
// (1,2) för dess första möjliga mandat där — jämförelsetalet är då bara röstetalet
// (divisor 1), sedan vanlig 3, 5, 7 … om fler mandat hamnar där. Utan denna specialregel
// (dvs. samma 1,2:a som annars) gav 10 av 232 kontrollerade (valkrets, parti)-par fel
// mandat mot Valmyndighetens 2022-facit; MED den matchar samtliga 232 exakt.
export function placeLevelingSeats(
  votesByConstituency: ConstituencyVotes,
  fixedByConstituencyParty: Record<string, Record<string, number>>,
  levelingByParty: Record<string, number>,
): Record<string, Record<string, number>> {
  const constituencies = Object.keys(votesByConstituency)
  const placed: Record<string, Record<string, number>> = Object.fromEntries(constituencies.map((vk) => [vk, {}]))
  for (const [party, remaining0] of Object.entries(levelingByParty)) {
    let remaining = remaining0
    if (remaining <= 0) continue
    const current: Record<string, number> = {}
    for (const vk of constituencies) current[vk] = fixedByConstituencyParty[vk]?.[party] ?? 0
    while (remaining > 0) {
      let best: string | null = null
      let bestQ = -Infinity
      for (const vk of constituencies) {
        const votes = votesByConstituency[vk][party] ?? 0
        if (votes === 0) continue
        const n = current[vk]
        const divisor = n === 0 ? 1 : 2 * n + 1 // OBS: 1, inte firstDivisor — se kommentar ovan
        const q = votes / divisor
        if (q > bestQ || (q === bestQ && best !== null && vk < best)) { bestQ = q; best = vk }
      }
      if (best === null) break // inga fler valkretsar med röster på partiet kvar (bör inte hända i praktiken)
      current[best]++
      placed[best][party] = (placed[best][party] ?? 0) + 1
      remaining--
    }
  }
  return placed
}
