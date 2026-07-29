// Resultattabell — ren presentation. Driver alla nivåer (rike/region/kommun/
// valkrets); bara props skiljer. Standardlayout: Parti · Röster · Andel · ±2022 ·
// Mandat · ±. Ej wirade fält (null) renderas som "–".
import { Fragment } from 'react'
import type { DisplayRows } from '@/lib/aggregate'

const NEUTRAL = '#64748b'
const nf = new Intl.NumberFormat('sv-SE')
const pct = (a: number) => `${(a * 100).toFixed(1).replace('.', ',')} %`
const delta = (d: number | null) =>
  d == null ? '–' : `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(1).replace('.', ',')}`
const dInt = (d: number | null) => (d == null ? '–' : d === 0 ? '±0' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`)
const deltaColor = (d: number | null) =>
  d == null || d === 0 ? 'text-slate-500' : d > 0 ? 'text-emerald-400' : 'text-rose-400'

export interface ResultTableProps {
  title: string
  subtitle?: string
  status?: string
  display: DisplayRows
  giltiga: number
  sparr: number
  blanka?: number | null
  totalMandat?: number | null
}

export function ResultTable({ title, subtitle, status, display, giltiga, sparr, blanka, totalMandat }: ResultTableProps) {
  const { shown, ovriga, sparrIndex } = display
  const sparrLabel = `${(sparr * 100).toFixed(0)} %-spärr`

  const SparrLine = () => (
    <tr aria-hidden>
      <td colSpan={6} className="py-1">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
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

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-700 text-[11px] uppercase tracking-wide text-slate-400">
            <th className="py-1 pr-2 text-left font-medium">Parti</th>
            <th className="py-1 px-1 text-right font-medium">Röster</th>
            <th className="py-1 px-1 text-right font-medium">Andel</th>
            <th className="py-1 px-1 text-right font-medium">±</th>
            <th className="py-1 px-1 text-right font-medium">Mandat</th>
            <th className="py-1 pl-1 text-right font-medium">±</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {shown.map((r, i) => (
            <Fragment key={r.partikod}>
              {i === sparrIndex && <SparrLine />}
              <tr className="border-b border-slate-800/60">
                <td className="py-1 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: r.farg ?? NEUTRAL }} />
                    <span className="font-semibold">{r.forkortning ?? '—'}</span>
                  </div>
                </td>
                <td className="py-1 px-1 text-right text-slate-300">{nf.format(r.roster)}</td>
                <td className="py-1 px-1 text-right font-medium">{pct(r.andel)}</td>
                <td className={`py-1 px-1 text-right ${deltaColor(r.deltaAndel)}`}>{delta(r.deltaAndel)}</td>
                <td className="py-1 px-1 text-right font-semibold">{r.mandat ?? '–'}</td>
                <td className={`py-1 pl-1 text-right ${deltaColor(r.deltaMandat)}`}>{dInt(r.deltaMandat)}</td>
              </tr>
            </Fragment>
          ))}
          {sparrIndex >= shown.length && <SparrLine />}
          {ovriga && (
            <tr className="border-b border-slate-800/60 text-slate-400">
              <td className="py-1 pr-2 italic">Övriga partier ({ovriga.count} st)</td>
              <td className="py-1 px-1 text-right">{nf.format(ovriga.roster)}</td>
              <td className="py-1 px-1 text-right">{pct(ovriga.andel)}</td>
              <td className="py-1 px-1 text-right text-slate-500">–</td>
              <td className="py-1 px-1 text-right">{ovriga.mandat ?? '–'}</td>
              <td className="py-1 pl-1 text-right text-slate-500">–</td>
            </tr>
          )}
        </tbody>
        <tfoot className="text-xs text-slate-400">
          <tr>
            <td className="pt-2">Giltiga röster</td>
            <td className="pt-2 px-1 text-right tabular-nums">{nf.format(giltiga)}</td>
            <td className="pt-2 px-1 text-right">100 %</td>
            <td />
            <td className="pt-2 px-1 text-right font-semibold text-slate-300">{totalMandat ?? '–'}</td>
            <td />
          </tr>
          {blanka != null && (
            <tr>
              <td className="pt-1">Blanka / ogiltiga</td>
              <td className="pt-1 px-1 text-right tabular-nums">{nf.format(blanka)}</td>
              <td colSpan={4} />
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  )
}
