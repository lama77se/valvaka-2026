// Resultattabell — ren presentation. Driver alla nivåer (rike/region/kommun/
// valkrets); bara props skiljer. Kolumner: Parti · Röster · Andel(2026·2022·±) ·
// Mandat(2026·2022·±). 2022 visas ALLTID i egna kolumner (ingen switch) — även
// innan 2026 kommit in — med ±-differens bredvid. Ej wirade fält (null) → "–".
import { Fragment } from 'react'
import type { DisplayRows } from '@/lib/aggregate'

const NEUTRAL = '#64748b'
const nf = new Intl.NumberFormat('sv-SE')
const pct = (a: number | null) => (a == null ? '–' : `${(a * 100).toFixed(1).replace('.', ',')} %`)
const delta = (d: number | null) =>
  d == null ? '–' : `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(1).replace('.', ',')}`
const dInt = (d: number | null) => (d == null ? '–' : d === 0 ? '±0' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`)
const deltaColor = (d: number | null) =>
  d == null || d === 0 ? 'text-slate-500' : d > 0 ? 'text-emerald-400' : 'text-rose-400'

const COLS = 8

export interface ResultTableProps {
  title: string
  subtitle?: string
  status?: string
  display: DisplayRows
  giltiga: number
  sparr: number
  blanka?: number | null
  totalMandat?: number | null
  totalMandat2022?: number | null
  showSparr?: boolean // spärr-linjen är en församlingsvid bestämning → dölj på distriktsnivå
}

export function ResultTable({ title, subtitle, status, display, giltiga, sparr, blanka, totalMandat, totalMandat2022, showSparr = true }: ResultTableProps) {
  const { shown, ovriga, sparrIndex } = display
  const sparrLabel = `${(sparr * 100).toFixed(0)} %-spärr`

  const SparrLine = () => (
    <tr aria-hidden>
      <td colSpan={COLS} className="py-1">
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
        {status && <span className="whitespace-nowrap text-xs text-sky-300">{status}</span>}
      </div>
      {subtitle && <p className="mb-2 text-xs text-slate-400">{subtitle}</p>}

      {/* Smala telefoner: 8-kolumnstabellen får hellre scrolla i sidled än tryckas ihop
          (min-w tvingar bredd så overflow-x-auto biter). Desktop-panelen är bredare → ingen scroll. */}
      <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[460px] border-collapse text-sm tabular-nums">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-slate-500">
            <th rowSpan={2} className="pr-2 text-left align-bottom font-medium">Parti</th>
            <th rowSpan={2} className="px-1 text-right align-bottom font-medium">Röster</th>
            <th colSpan={3} className="border-l border-slate-800 pb-0.5 text-center font-semibold text-slate-300">Andel</th>
            <th colSpan={3} className="border-l border-slate-800 pb-0.5 text-center font-semibold text-slate-300">Mandat</th>
          </tr>
          <tr className="border-b border-slate-700 text-[11px] uppercase tracking-wide text-slate-400">
            <th className="py-1 px-1 text-right font-medium border-l border-slate-800">2026</th>
            <th className="py-1 px-1 text-right font-medium">2022</th>
            <th className="py-1 px-1 text-right font-medium">±</th>
            <th className="py-1 px-1 text-right font-medium border-l border-slate-800">2026</th>
            <th className="py-1 px-1 text-right font-medium">2022</th>
            <th className="py-1 pl-1 text-right font-medium">±</th>
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
                <td className="py-1 px-1 text-right font-semibold border-l border-slate-800">{r.mandat ?? '–'}</td>
                <td className="py-1 px-1 text-right text-slate-400">{r.mandat2022 ?? '–'}</td>
                <td className={`py-1 pl-1 text-right ${r.ny ? 'text-amber-400' : deltaColor(r.deltaMandat)}`}>
                  {r.ny ? 'ny' : dInt(r.deltaMandat)}
                </td>
              </tr>
            </Fragment>
          ))}
          {showSparr && sparrIndex >= shown.length && <SparrLine />}
          {ovriga && (
            <tr className="border-b border-slate-800/60 text-slate-400">
              <td className="py-1 pr-2 italic">Övriga partier ({ovriga.count} st)</td>
              <td className="py-1 px-1 text-right">{nf.format(ovriga.roster)}</td>
              <td className="py-1 px-1 text-right border-l border-slate-800">{pct(ovriga.andel)}</td>
              <td className="py-1 px-1 text-right">{pct(ovriga.andel2022)}</td>
              <td className="py-1 px-1 text-right text-slate-500">–</td>
              <td className="py-1 px-1 text-right border-l border-slate-800">{ovriga.mandat ?? '–'}</td>
              <td className="py-1 px-1 text-right">{ovriga.mandat2022 ?? '–'}</td>
              <td className="py-1 pl-1 text-right text-slate-500">–</td>
            </tr>
          )}
        </tbody>
        <tfoot className="text-xs text-slate-400">
          <tr>
            <td className="pt-2">Giltiga röster</td>
            <td className="pt-2 px-1 text-right">{nf.format(giltiga)}</td>
            <td className="pt-2 px-1 text-right border-l border-slate-800">100 %</td>
            <td className="pt-2 px-1 text-right">{totalMandat2022 != null ? '100 %' : ''}</td>
            <td className="pt-2 px-1 text-right" />
            <td className="pt-2 px-1 text-right font-semibold text-slate-300 border-l border-slate-800">{totalMandat ?? '–'}</td>
            <td className="pt-2 px-1 text-right font-semibold text-slate-400">{totalMandat2022 ?? '–'}</td>
            <td className="pt-2 pl-1 text-right" />
          </tr>
          {blanka != null && (
            <tr>
              <td className="pt-1">Blanka / ogiltiga</td>
              <td className="pt-1 px-1 text-right">{nf.format(blanka)}</td>
              <td colSpan={6} />
            </tr>
          )}
        </tfoot>
      </table>
      </div>
    </div>
  )
}
