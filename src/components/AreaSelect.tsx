// Områdesväljarens <select>-markup som egen, återanvändbar komponent. Extraherad ur
// ResultPanel.tsx (samma JSX, oförändrad) så Dashboard-vyns fyra rutor kan ha VARSIN
// instans utan att röra den globala selectedArea. Hämtar referensdata (kommuner/
// regioner/valkretsar) själv via context — bara valtyp/area/areaName/onChange är
// instans-specifika. `areaName` (den redan UPPSLAGNA visningstexten, se
// ResultPanel.tsx:areaName/useAreaView) krävs för de två syntetiska "nuvarande
// värde"-optionerna nedan — de ska visa NAMNET, inte den råa koden.
// Se docs/superpowers/specs/2026-09-12-dashboard-vy-design.md.
import { useMemo } from 'react'
import { useResults, type Area } from '@/components/ResultsProvider'
import { LEVELS, PROMPT, areaFromSelectValue } from '@/lib/areaSelect'
import { SEAT_CONFIG_2026 } from '@/lib/seatConfig2026'
import type { Valtyp } from '@/lib/results'

export function AreaSelect({
  valtyp,
  area,
  areaName,
  onChange,
}: {
  valtyp: Valtyp
  area: Area
  areaName: string
  onChange: (next: Area) => void
}) {
  const { kommuner, regioner, valkretsar } = useResults()
  const levels = LEVELS[valtyp]

  // Regionväljaren (RF) ska bara lista regioner som FAKTISKT har ett regionval — Gotland
  // saknar eget regionfullmäktige (kommunfullmäktige dubblar som region) och står därför
  // inte i SEAT_CONFIG_2026.RF, men finns kvar i `regioner` (byggd ur `district.lan`,
  // som är gemensam för alla valtyper) → utan detta filter ledde valet av Gotland till en
  // permanent tom vy för RF.
  const regionerRF = useMemo(() => regioner.filter((r) => r.code in SEAT_CONFIG_2026.RF), [regioner])
  const regionName = useMemo(() => new Map(regioner.map((r) => [r.code, r.name])), [regioner])
  // Valkretsar i den PLATTA väljaren (bara RD/RF — se levels.includes('valkrets') nedan)
  // sorteras om till den text som FAKTISKT visas: `valkretsar` självt är sorterat på bara
  // valkretsens EGET namn (ResultsProvider.tsx), men RF:s rad skriver ut "Region · Valkrets"
  // — sorterat på suffixet ser då slumpmässigt blandat ut (Jönköping mellan Halland och
  // Kalmar). Sortera i stället på den riktiga visningstexten.
  const valkretsarForSelect = useMemo(() => {
    const label = (v: (typeof valkretsar)[number]) => (valtyp === 'RF' ? `${regionName.get(v.code.slice(0, 2)) ?? ''} · ${v.name}` : v.name)
    return [...valkretsar].sort((a, b) => label(a).localeCompare(label(b), 'sv'))
  }, [valkretsar, valtyp, regionName])

  const isPrompt = area.level !== 'riket' && area.code == null
  const selectValue = isPrompt
    ? ''
    : area.level === 'riket'
      ? 'riket'
      : area.level === 'distrikt'
        ? `d:${area.code}`
        : area.level === 'valkrets'
          ? `vk:${area.code}`
          : `${area.level === 'region' ? 'r' : 'k'}:${area.code}`

  return (
    <select
      className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-100"
      value={selectValue}
      onChange={(e) => {
        const next = areaFromSelectValue(valtyp, e.target.value)
        if (next) onChange(next)
      }}
    >
      {area.level === 'distrikt' && <option value={`d:${area.code}`}>Distrikt: {areaName}</option>}
      {area.level === 'valkrets' && !levels.includes('valkrets') && (
        // KF-valkrets når man via drill (kommun→valkrets), inte i den platta listan
        // (~313 st, mest 1-per-kommun) → syntetisk nuvarande-option så select:en inte tappar värdet.
        <option value={`vk:${area.code}`}>Valkrets: {areaName}</option>
      )}
      {levels.includes('riket') ? <option value="riket">Riket</option> : <option value="">{PROMPT[valtyp]}</option>}
      {/* Grupperna i hierarkiordning (förälder först): RF region → valkrets; RD valkrets →
          kommun (ingen region). */}
      {levels.includes('region') && (
        <optgroup label="Region / län">
          {regionerRF.map((r) => (
            <option key={r.code} value={`r:${r.code}`}>
              {r.name}
            </option>
          ))}
        </optgroup>
      )}
      {levels.includes('valkrets') && (
        <optgroup label="Valkrets">
          {valkretsarForSelect.map((v) => (
            // RF-valkretsnamn ("Nordväst") är region-lokala → prefixa med regionen i
            // den platta listan; i breadcrumb/drill räcker namnet (regionen är förälder).
            <option key={v.code} value={`vk:${v.code}`}>
              {valtyp === 'RF' ? `${regionName.get(v.code.slice(0, 2)) ?? ''} · ${v.name}` : v.name}
            </option>
          ))}
        </optgroup>
      )}
      {levels.includes('kommun') && (
        <optgroup label="Kommun">
          {kommuner.map((k) => (
            <option key={k.code} value={`k:${k.code}`}>
              {k.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  )
}
