// Partilegend — kopplar kartans distriktsfärger till parti. Kartan färgar varje
// distrikt efter vinnande parti (party.color); lokala partier utan märkesfärg blir
// grå och orapporterade mörkgrå. Legenden visar just de färgerna, riksdagspartierna
// i politisk vänster→höger-ordning. Ren presentation ur partyRef — ingen egen data.
//
// ÅTERANVÄND som partiväljare för kartfärgläget "Parti" (choropleth-intensitet, se
// ColorSchemeSelector/ColorScheme i lib/results): varje partiswatch är KLICKBAR —
// klick väljer partiet OCH slår om till colorScheme 'party' i ett steg (handover:
// "återanvänd PartyLegends partilista som klickbara val"). Fungerar oavsett vilket
// färgläge som redan är aktivt — ett naturligt sätt att UPPTÄCKA läget, inte bara
// använda det efteråt.
import { useResults } from '@/components/ResultsProvider'
import { BLOCK_COLOR_A, BLOCK_COLOR_B, REPORTED_NEUTRAL, UNREPORTED_FILL } from '@/components/DistrictMap'
import { partyLegendList, RIKET_BLOCKS } from '@/lib/soffa'

function Swatch({ farg, label, title }: { farg: string; label: string; title?: string }) {
  return (
    <span className="flex items-center gap-1.5" title={title ?? label}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: farg }} />
      <span className="text-[11px] text-slate-300">{label}</span>
    </span>
  )
}

// Samma visuella form som Swatch, men en riktig knapp — ring runt pluppen när det är
// det just nu VALDA partiet i colorScheme 'party' (annars ingen synlig skillnad mot
// en vanlig <Swatch>, så det inte ser klickbart-men-inaktivt ut när "Parti" ej är valt).
function PartySwatchButton({ farg, label, title, active, onClick }: { farg: string; label: string; title?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className="flex items-center gap-1.5 rounded px-0.5 -mx-0.5 transition-colors hover:bg-slate-800"
    >
      <span
        className={`h-2.5 w-2.5 shrink-0 rounded-sm ${active ? 'ring-2 ring-offset-1 ring-offset-slate-900 ring-sky-400' : ''}`}
        style={{ backgroundColor: farg }}
      />
      <span className={`text-[11px] ${active ? 'font-semibold text-slate-100' : 'text-slate-300'}`}>{label}</span>
    </button>
  )
}

export function PartyLegend() {
  const { partyRef, snapshotVersion, colorScheme, setColorScheme, selectedParty, setSelectedParty } = useResults()
  void snapshotVersion // rendera om när partifärgerna laddats

  const uniq = partyLegendList(partyRef.current)
  if (uniq.length === 0) return null

  const isPartyMode = colorScheme === 'party'
  const isBlockMode = colorScheme === 'block'

  return (
    <div className="pointer-events-auto max-w-xs rounded-lg border border-slate-700 bg-slate-900/85 px-3 py-2 shadow-lg backdrop-blur">
      {/* Blocklegenden hör bara ihop med colorScheme 'block' — kartan visar då INTE
          per-parti-vinnare (nedanstående partilista speglar då inte kartfärgerna), så
          en egen, tydlig legend behövs ovanför i stället för att bara utelämnas. */}
      {isBlockMode && (
        <div className="mb-1.5 flex flex-wrap gap-x-3 gap-y-1.5 border-b border-slate-800 pb-1.5">
          <Swatch farg={BLOCK_COLOR_A} label={RIKET_BLOCKS.a.label} title={RIKET_BLOCKS.note} />
          <Swatch farg={BLOCK_COLOR_B} label={RIKET_BLOCKS.b.label} title={RIKET_BLOCKS.note} />
        </div>
      )}
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
        {isPartyMode ? 'Partiintensitet — klicka för att byta parti' : 'Vinnande parti — klicka för intensitetskarta'}
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {uniq.map((p) => (
          <PartySwatchButton
            key={p.forkortning}
            farg={p.farg!}
            label={p.forkortning!}
            title={p.beteckning ?? p.forkortning!}
            active={isPartyMode && selectedParty === p.forkortning}
            onClick={() => {
              setSelectedParty(p.forkortning!)
              setColorScheme('party')
            }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-slate-800 pt-1.5">
        <Swatch farg={REPORTED_NEUTRAL} label="Lokalt parti" title="Rapporterat, vinnare utan märkesfärg (t.ex. lokala partier i region/kommun)" />
        <Swatch farg={UNREPORTED_FILL} label="Ej rapporterat" title="Distriktet har inte rapporterat i vald valtyp än" />
      </div>
      {(isPartyMode || isBlockMode) && (
        <button
          type="button"
          onClick={() => setColorScheme('largest')}
          className="mt-1.5 w-full rounded border-t border-slate-800 pt-1.5 text-left text-[11px] text-sky-300 hover:text-sky-200"
        >
          ← Tillbaka till vinnande parti
        </button>
      )}
    </div>
  )
}
