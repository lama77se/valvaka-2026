// Marginalmandatet — kompakta, färgade partichips i stället för en löptextmening
// (handover 15 sep, Lars: "samma information, bara skannbar i stället för läsbar som
// en mening"). Ersätter formatMarginalSeat (borttagen, ingen annan anropare kvar) på
// BÅDA ställen den användes: AreaSummary.tsx (Dashboard-rutor) och ResultPanel.tsx
// (results frame) — samma delade-komponent-mönster som SlutligBar redan har mellan
// flera ytor, ingen anledning att duplicera renderingslogiken.
//
// Ingen egen `compact`-variant (till skillnad från den gamla formatMarginalSeat) —
// Lars uppföljning samma kväll: mandatnumret ("#349") ska alltid synas (tydlighet),
// och chipparna är redan kompakta nog att inte behöva en ytterligare förkortning.
//
// Lars uppföljning #3: bara siffror+färger räckte inte, "det måste till någon text"
// som förklarar VAD talen betyder (ung. "Det krävs M ~1 845 ... fler röster än
// [ledande]") — chipparna ensamma (bara "−1 845" utan sammanhang) var för kryptiska.
// "Röster som saknas:" mellan ledarchippen och utmanarchipparna gör kopplingen
// explicit: DE HÄR talen är hur många fler röster var och en skulle behöva för att gå
// om ledaren och ta mandatet — utan att tappa kompaktheten (fortfarande en rad text,
// inte en hel mening per utmanare som den gamla formatMarginalSeat hade).
//
// Lars uppföljning #4: fem utmanare i stället för tre — datan (MarginalSeatInfo.
// challengers, mandate.ts:s marginalSeatInfo) hade redan ALLA kvalificerade partier,
// sorterade närmast först; begränsningen till tre fanns bara i den gamla
// formatMarginalSeat-textens tre namngivna variabler (top/second/third), inte i
// datan själv — en ren .slice(0, 5) räcker, ingen ändring i mandate.ts behövs.
//
// Ren PRESENTATION — matar ALDRIG tillbaka in i mandatsiffrorna (samma "visningsendast"-
// princip som MarginalSeatInfo/marginalSeatInfo i mandate.ts självt redan dokumenterar).
// Datan (MarginalSeatInfo: marginalParty + challengers, redan sorterade NÄRMAST FÖRST)
// är oförändrad — bara hur den renderas.
import { onDark } from '@/lib/colors'
import type { PartyMeta } from '@/lib/aggregate'
import type { MarginalSeatInfo } from '@/lib/mandate'

const nf = (n: number) => n.toLocaleString('sv-SE')

function Chip({ kod, party, suffix, emphasize }: { kod: string; party: Map<string, PartyMeta>; suffix?: string; emphasize?: boolean }) {
  const meta = party.get(kod)
  const farg = meta?.farg ?? '#94a3b8'
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-bold leading-none"
      style={{ color: onDark(farg), backgroundColor: `${farg}${emphasize ? '33' : '1a'}` }}
      title={meta?.beteckning ?? kod}
    >
      {meta?.forkortning ?? kod}
      {suffix && <span className="font-normal opacity-90">{suffix}</span>}
    </span>
  )
}

export function MarginalSeatChips({
  info,
  totalMandat,
  party,
}: {
  info: MarginalSeatInfo
  totalMandat: number | null
  party: Map<string, PartyMeta>
}) {
  // Samma "kräver minst en utmanare"-gate som formatMarginalSeat hade — marginalSeatInfo
  // garanterar redan ≥2 kvalificerade partier (se dess docstring), så detta bör inte
  // hända i praktiken, men skydda ändå mot en tom lista. Fem närmaste (Lars, se ovan) —
  // fler än så blev för brett/rörigt för en enda rad, fem täcker gott och väl de
  // realistiska scenarierna (sällan fler än en handfull partier nära marginalen alls).
  const challengers = info.challengers.slice(0, 5)
  if (challengers.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-slate-400">
      <span className="shrink-0">
        Sista mandatet{totalMandat != null ? ` (#${totalMandat})` : ''}:
      </span>
      <Chip kod={info.marginalParty} party={party} emphasize />
      <span className="shrink-0">— röster som saknas:</span>
      {challengers.map((c) => (
        <Chip key={c.party} kod={c.party} party={party} suffix={`−${nf(c.votesNeeded)}`} />
      ))}
    </div>
  )
}
