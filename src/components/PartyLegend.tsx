// Partilegend — kopplar kartans distriktsfärger till parti. Kartan färgar varje
// distrikt efter vinnande parti (party.color); lokala partier utan märkesfärg blir
// grå och orapporterade mörkgrå. Legenden visar just de färgerna, riksdagspartierna
// i politisk vänster→höger-ordning. Ren presentation ur partyRef — ingen egen data.
import { useResults } from '@/components/ResultsProvider'
import { REPORTED_NEUTRAL, UNREPORTED_FILL } from '@/components/DistrictMap'
import { spectrumRank } from '@/lib/soffa'

function Swatch({ farg, label, title }: { farg: string; label: string; title?: string }) {
  return (
    <span className="flex items-center gap-1.5" title={title ?? label}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: farg }} />
      <span className="text-[11px] text-slate-300">{label}</span>
    </span>
  )
}

export function PartyLegend() {
  const { partyRef, snapshotVersion } = useResults()
  void snapshotVersion // rendera om när partifärgerna laddats

  // Bara partier med märkesfärg (de 8 riksdagspartierna), i politisk ordning.
  const parties = [...partyRef.current.values()]
    .filter((p) => p.farg && p.forkortning)
    .sort((a, b) => spectrumRank(a.forkortning) - spectrumRank(b.forkortning))
  // Dedup på förkortning (samma parti kan ha flera partikoder över valtyper).
  const seen = new Set<string>()
  const uniq = parties.filter((p) => (seen.has(p.forkortning!) ? false : (seen.add(p.forkortning!), true)))

  if (uniq.length === 0) return null

  return (
    <div className="pointer-events-auto max-w-xs rounded-lg border border-slate-700 bg-slate-900/85 px-3 py-2 shadow-lg backdrop-blur">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Vinnande parti</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {uniq.map((p) => (
          <Swatch key={p.forkortning} farg={p.farg!} label={p.forkortning!} title={p.beteckning ?? p.forkortning!} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-slate-800 pt-1.5">
        <Swatch farg={REPORTED_NEUTRAL} label="Lokalt parti" title="Rapporterat, vinnare utan märkesfärg (t.ex. lokala partier i region/kommun)" />
        <Swatch farg={UNREPORTED_FILL} label="Ej rapporterat" title="Distriktet har inte rapporterat i vald valtyp än" />
      </div>
    </div>
  )
}
