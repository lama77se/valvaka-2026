// Marginalmandatet — kompakta, färgade partichips i stället för en löptextmening
// (handover 15 sep, Lars: "samma information, bara skannbar i stället för läsbar som
// en mening"). Ersätter formatMarginalSeat (borttagen, ingen annan anropare kvar) på
// BÅDA ställen den användes: AreaSummary.tsx (Dashboard-rutor) och ResultPanel.tsx
// (results frame) — samma delade-komponent-mönster som SlutligBar redan har mellan
// flera ytor, ingen anledning att duplicera renderingslogiken.
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
      className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded px-1 py-0.5 text-[10px] font-bold leading-none"
      style={{ color: onDark(farg), backgroundColor: `${farg}${emphasize ? '33' : '1a'}` }}
      title={meta?.beteckning ?? kod}
    >
      {meta?.forkortning ?? kod}
      {suffix && <span className="font-normal opacity-80">{suffix}</span>}
    </span>
  )
}

export function MarginalSeatChips({
  info,
  totalMandat,
  party,
  compact = false,
}: {
  info: MarginalSeatInfo
  totalMandat: number | null
  party: Map<string, PartyMeta>
  compact?: boolean
}) {
  // Samma "kräver minst en utmanare"-gate som formatMarginalSeat hade — marginalSeatInfo
  // garanterar redan ≥2 kvalificerade partier (se dess docstring), så detta bör inte
  // hända i praktiken, men skydda ändå mot en tom lista.
  const [top, second, third] = info.challengers
  if (!top) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
      <span className="shrink-0">
        Sista mandatet{!compact && totalMandat != null ? ` (#${totalMandat})` : ''}:
      </span>
      <Chip kod={info.marginalParty} party={party} emphasize />
      <span className="shrink-0 text-slate-600">·</span>
      <Chip kod={top.party} party={party} suffix={`−${nf(top.votesNeeded)}`} />
      {second && <Chip kod={second.party} party={party} suffix={`−${nf(second.votesNeeded)}`} />}
      {third && <Chip kod={third.party} party={party} suffix={`−${nf(third.votesNeeded)}`} />}
    </div>
  )
}
