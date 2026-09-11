// Resultattabell — ren presentation. Driver alla nivåer (rike/region/kommun/
// valkrets/distrikt); bara props skiljer. Kolumner: Parti · Röster · Andel(2026·2022·±) ·
// Mandat(2026·2022·±) — Mandat-kolumnerna döljs helt när mandat inte är meningsfullt på
// den här nivån (distrikt, och för RD även kommun) i stället för att visa tre kolumner
// med bara "–" (val.se visar inte mandat där heller). 2022 visas ALLTID i egna kolumner
// (ingen switch) — även innan 2026 kommit in — med ±-differens bredvid. Ej wirade fält
// (null) → "–".
import { Fragment } from 'react'
import type { DisplayRows } from '@/lib/aggregate'
import { deltaColor, formatDelta as delta, formatDeltaInt as dInt } from '@/lib/delta'

const NEUTRAL = '#64748b'
const nf = new Intl.NumberFormat('sv-SE')
const pct = (a: number | null) => (a == null ? '–' : `${(a * 100).toFixed(1).replace('.', ',')} %`)

export interface ResultTableProps {
  title: string
  subtitle?: string
  reportPct?: number // 0..100 → fyller progress-baren bakom undertexten (inrapporterat)
  statusTag?: { tone: string; label: string; title: string } // slutresultat-fas (`slutligTag`), egen badge — SKILT från reportPct
  turnoutLabel?: string // t.ex. "Valdeltagande 84,5 %" — sitter i tabellhuvudets annars tomma yta ovanför Parti/Röster
  display: DisplayRows
  giltiga: number
  sparr: number
  blanka?: number | null
  totalMandat?: number | null
  totalMandat2022?: number | null
  showSparr?: boolean // spärr-linjen är en församlingsvid bestämning → dölj på distriktsnivå
  showMandat?: boolean // mandat är bara meningsfullt på organ-/valkretsnivå → dölj kolumnerna annars
}

export function ResultTable({ title, subtitle, reportPct, statusTag, turnoutLabel, display, giltiga, sparr, blanka, totalMandat, totalMandat2022, showSparr = true, showMandat = true }: ResultTableProps) {
  const { shown, ovriga, sparrIndex } = display
  const sparrLabel = `${(sparr * 100).toFixed(0)} %-spärr`
  const cols = showMandat ? 8 : 5

  const SparrLine = () => (
    <tr aria-hidden>
      <td colSpan={cols} className="py-1">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-500">
          <span className="h-px flex-1 border-t border-dashed border-slate-600" />
          {sparrLabel}
          <span className="h-px flex-1 border-t border-dashed border-slate-600" />
        </div>
      </td>
    </tr>
  )

  return (
    <div className="text-slate-100">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        {statusTag && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${statusTag.tone}`}
            title={statusTag.title}
          >
            {statusTag.label}
          </span>
        )}
      </div>
      {subtitle &&
        (reportPct == null ? (
          <p className="mb-2 text-xs text-slate-400">{subtitle}</p>
        ) : (
          // Undertexten som progress-bar: fylld (grön) andel = inrapporterat, resten dimmad.
          <div className="relative mb-2 overflow-hidden rounded border border-slate-800 bg-slate-800/40">
            <div
              className="absolute inset-y-0 left-0 bg-emerald-500/35 transition-[width] duration-500"
              style={{ width: `${Math.min(100, Math.max(0, reportPct))}%` }}
              aria-hidden
            />
            <p className="relative px-2 py-1 text-xs text-slate-300">{subtitle}</p>
          </div>
        ))}

      {/* min-w = golv mot ihoptryckning på riktigt smala telefoner; satt nära det
          NATURLIGA innehållet (~360px med de korta mobil-etiketterna) så tabellen ryms i
          en vanlig telefon UTAN sidledsscroll och Parti-kolumnen inte suger upp slack.
          overflow-x-auto biter först på riktigt smala skärmar. Desktop fyller via w-full. */}
      <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[360px] border-collapse text-sm tabular-nums">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-slate-500">
            {/* Parti/Röster har ingen egen rad-1-etikett (de är inte grupperade som Andel/
                Mandat) — den ytan används i stället till valdeltagandet i valt område. */}
            <th colSpan={2} className="pb-0.5 text-left font-medium">{turnoutLabel}</th>
            <th colSpan={3} className="border-l border-slate-800 pb-0.5 text-center font-semibold text-slate-300">Andel</th>
            {showMandat && <th colSpan={3} className="border-l border-slate-800 pb-0.5 text-center font-semibold text-slate-300">Mandat</th>}
          </tr>
          <tr className="border-b border-slate-700 text-[11px] uppercase tracking-wide text-slate-400">
            <th className="py-1 pr-2 text-left font-medium">Parti</th>
            <th className="py-1 px-1 text-right font-medium">Röster</th>
            <th className="py-1 px-1 text-right font-medium border-l border-slate-800">2026</th>
            <th className="py-1 px-1 text-right font-medium">2022</th>
            <th className="py-1 px-1 text-right font-medium">±</th>
            {showMandat && (
              <>
                <th className="py-1 px-1 text-right font-medium border-l border-slate-800">2026</th>
                <th className="py-1 px-1 text-right font-medium">2022</th>
                <th className="py-1 pl-1 text-right font-medium">±</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <Fragment key={r.partikod}>
              {showSparr && i === sparrIndex && <SparrLine />}
              <tr className="border-b border-slate-800/60">
                <td className="py-1 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: r.farg ?? NEUTRAL }} />
                    <span className="font-semibold">{r.forkortning ?? '—'}</span>
                  </div>
                </td>
                <td className="py-1 px-1 text-right text-slate-300">{nf.format(r.roster)}</td>
                <td className="py-1 px-1 text-right font-medium border-l border-slate-800">{pct(r.andel)}</td>
                <td className="py-1 px-1 text-right text-slate-400">{pct(r.andel2022)}</td>
                <td className={`py-1 px-1 text-right ${r.ny ? 'text-amber-400' : deltaColor(r.deltaAndel)}`}>
                  {r.ny ? 'ny' : delta(r.deltaAndel)}
                </td>
                {showMandat && (
                  <>
                    <td className="py-1 px-1 text-right font-semibold border-l border-slate-800">{r.mandat ?? '–'}</td>
                    <td className="py-1 px-1 text-right text-slate-400">{r.mandat2022 ?? '–'}</td>
                    <td className={`py-1 pl-1 text-right ${r.ny ? 'text-amber-400' : deltaColor(r.deltaMandat)}`}>
                      {r.ny ? 'ny' : dInt(r.deltaMandat)}
                    </td>
                  </>
                )}
              </tr>
            </Fragment>
          ))}
          {showSparr && sparrIndex >= shown.length && <SparrLine />}
          {ovriga && (
            <tr className="border-b border-slate-800/60 text-slate-400">
              {/* Mobil: bara "Övriga" (annars tvingar den långa strängen Parti-kolumnen bred
                  → Mandat trycks ut ur vyn). Desktop har plats → full text + antal. */}
              <td className="py-1 pr-2 italic whitespace-nowrap">Övriga<span className="hidden sm:inline"> partier ({ovriga.count} st)</span></td>
              <td className="py-1 px-1 text-right">{nf.format(ovriga.roster)}</td>
              <td className="py-1 px-1 text-right border-l border-slate-800">{pct(ovriga.andel)}</td>
              <td className="py-1 px-1 text-right">{pct(ovriga.andel2022)}</td>
              <td className="py-1 px-1 text-right text-slate-500">–</td>
              {showMandat && (
                <>
                  <td className="py-1 px-1 text-right border-l border-slate-800">{ovriga.mandat ?? '–'}</td>
                  <td className="py-1 px-1 text-right">{ovriga.mandat2022 ?? '–'}</td>
                  <td className="py-1 pl-1 text-right text-slate-500">–</td>
                </>
              )}
            </tr>
          )}
        </tbody>
        <tfoot className="text-xs text-slate-400">
          <tr>
            <td className="pt-2">Summa</td>
            <td className="pt-2 px-1 text-right">{nf.format(giltiga)}</td>
            <td className="pt-2 px-1 text-right border-l border-slate-800">100 %</td>
            <td className="pt-2 px-1 text-right">{totalMandat2022 != null ? '100 %' : ''}</td>
            <td className="pt-2 px-1 text-right" />
            {showMandat && (
              <>
                <td className="pt-2 px-1 text-right font-semibold text-slate-300 border-l border-slate-800">{totalMandat ?? '–'}</td>
                <td className="pt-2 px-1 text-right font-semibold text-slate-400">{totalMandat2022 ?? '–'}</td>
                <td className="pt-2 pl-1 text-right" />
              </>
            )}
          </tr>
          {blanka != null && (
            <tr>
              <td className="pt-1">Blanka / ogiltiga</td>
              <td className="pt-1 px-1 text-right">{nf.format(blanka)}</td>
              <td colSpan={showMandat ? 6 : 3} />
            </tr>
          )}
        </tfoot>
      </table>
      </div>
    </div>
  )
}
