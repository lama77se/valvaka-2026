// Mandat-/röstandelsvisualisering som TVÅ liggande staplar i stället för soffbågen —
// kompaktare och mer läsbar (best practice: spektrumordning, majoritetslinje, färg +
// etikett-där-det-får-plats; exakta siffror finns i tabellen rakt under). Övre stapel =
// röstandel (100 % bred), undre = mandat (bredd = totala mandat, med majoritetslinje).
// 2022 visas ALDRIG som egen huvudstapel — bara som en tunn "spök"-stapel UNDER en levande
// 2026-stapel (då-vs-nu). Saknas 2026 (förvalsperiod / 0 % räknat) renderas inga staplar
// alls (en full 2022-stapel skilde sig bara på årtalet i etiketten → lästes som aktuellt).
import type { ReactNode } from 'react'
import type { OvrigaRow, PartyRow } from '@/lib/aggregate'
import { spectrumRank } from '@/lib/soffa'

const NEUTRAL = '#64748b'

interface Seg { fork: string; farg: string; value: number }

// Läsbar etikettfärg mot segmentets bakgrund: svart på ljusa fyllningar (SD gul, M/MP
// ljusblå/grön), vit på mörka (V vinröd, KD marinblå, S röd, C, L). Perceptuell ljushet.
function labelInk(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length < 6) return 'rgba(255,255,255,0.95)'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return L > 0.6 ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.95)'
}

// En liggande stapel: segment vänster→höger, bredd = value/denom. Förkortning inne i
// varje segment som är brett nog för att rymma den (tröskel lågt satt så även små
// riksdagspartier — V, KD, L, MP — märks ut); resten läses i tabellen under.
//   total satt  → fast nämnare (bredd = value/total); segmenten kan summera till < 100 %
//                 och lämnar ett tomt spår till höger (röstandelsstapeln: bortkastade
//                 röster under spärren). Ej satt → nämnaren är segmentsumman (fyller helt).
function StackedBar({ segs, height, faded = false, labels = false, total, title, valueFmt }: { segs: Seg[]; height: number; faded?: boolean; labels?: boolean; total?: number; title?: string; valueFmt?: (v: number) => string }) {
  const sum = segs.reduce((a, s) => a + s.value, 0)
  const denom = total ?? sum
  if (denom <= 0) return <div className="w-full rounded bg-slate-800/70" style={{ height }} />
  return (
    <div className="flex w-full overflow-hidden rounded bg-slate-800/60" style={{ height, opacity: faded ? 0.5 : 1 }} title={title}>
      {segs.map((s, i) => {
        const pct = (s.value / denom) * 100
        return (
          <div
            key={`${s.fork}-${i}`}
            className="flex items-center justify-center overflow-hidden whitespace-nowrap text-[10px] font-bold leading-none"
            style={{ width: `${pct}%`, background: s.farg, color: labelInk(s.farg) }}
            title={`${s.fork}: ${valueFmt ? valueFmt(s.value) : Number.isInteger(s.value) ? s.value : s.value.toFixed(1)}`}
          >
            {labels && pct >= 3 ? s.fork : ''}
          </div>
        )
      })}
    </div>
  )
}

// Vit lodrät linje vid 50 % — det mest framträdande elementet. På mandatstapeln =
// egen majoritet (176/349 etc.); på röstandelsstapeln = halva väljarkåren (vänster om
// linjen ≈ vänsterblock, höger ≈ högerblock, tack vare spektrumordningen).
function MajorityLine() {
  return <div className="pointer-events-none absolute -top-1.5 bottom-0 left-1/2 w-[2.5px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_3px_rgba(0,0,0,0.6)]" />
}

// Stapelrad med en FAST högermarginal för årsetiketten. Huvudstapel (tom tagg) och
// '22-spökstapel får då exakt samma stapelbredd (flex-1) och samma vänsterkant, så
// segmenten linjerar lodrätt — tidigare stal den inline-satta "’22"-texten bredd bara
// från spökstapeln, som därför blev smalare och hamnade snett.
function BarRow({ tag, children }: { tag?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative flex-1">{children}</div>
      <span className="w-7 shrink-0 text-[11px] leading-none text-slate-400">{tag ?? ''}</span>
    </div>
  )
}

export interface MandatBarsProps {
  shown: PartyRow[]
  ovriga: OvrigaRow | null
  totalMandat: number | null
  giltiga: number // 2026 giltiga röster; 0 → inga staplar (2022 visas aldrig som egen huvudstapel)
  sparr: number // riksspärr (0..1) för valtypen — partier under lämnas ur röstandelsstapeln
  reportPct?: number | null
}

export function MandatBars({ shown, ovriga, totalMandat, giltiga, sparr, reportPct }: MandatBarsProps) {
  const live = giltiga > 0
  const parties = [...shown].sort((a, b) => spectrumRank(a.forkortning) - spectrumRank(b.forkortning))

  // Röstandelsstapeln: BARA partier över spärren för det år som visas; värdet är andelen
  // (0..1 av giltiga). Under-spärr-partier + Övriga utelämnas → segmenten summerar till
  // < 1 och resten ritas som tomt spår (bortkastade röster). Skalas mot total=1 så
  // 50%-linjen (halva väljarkåren) förblir sann trots det tomma spåret.
  const andelSegs = (pick: (p: PartyRow) => number | null | undefined): Seg[] => {
    const s: Seg[] = []
    for (const p of parties) {
      const v = pick(p) ?? 0
      if (v >= sparr) s.push({ fork: p.forkortning ?? '–', farg: p.farg ?? NEUTRAL, value: v })
    }
    return s
  }

  // Mandatstapeln: alla partier med mandat (under-spärr får 0 → faller bort av sig
  // självt) + ev. Övriga-mandat. Fyller hela bredden (nämnare = summan).
  const mandatSegs = (pick: (p: PartyRow) => number | null | undefined, ovr: number | null | undefined): Seg[] => {
    const s: Seg[] = []
    for (const p of parties) {
      const v = pick(p) ?? 0
      if (v > 0) s.push({ fork: p.forkortning ?? '–', farg: p.farg ?? NEUTRAL, value: v })
    }
    if (ovr && ovr > 0) s.push({ fork: 'Övr', farg: NEUTRAL, value: ovr })
    return s
  }

  const andel2026 = andelSegs((p) => p.andel)
  const andel2022 = andelSegs((p) => p.andel2022)
  const mandat2026 = mandatSegs((p) => p.mandat, ovriga?.mandat)
  const mandat2022 = mandatSegs((p) => p.mandat2022, ovriga?.mandat2022)
  const underSparrPct = Math.round((1 - andel2026.reduce((a, s) => a + s.value, 0)) * 100)

  const liveM = totalMandat != null && totalMandat > 0
  const mTotal = totalMandat ?? 0
  const majoritet = Math.floor(mTotal / 2) + 1
  const prognos = live && reportPct != null && reportPct < 100

  const andelShown = andel2026
  const trackTitle = underSparrPct > 0 ? `Tomt spår = ${underSparrPct} % röster under spärren (ger inga mandat)` : undefined

  // Inga 2026-röster → rendera inga staplar. 2022 visas bara som '22-spöke UNDER en levande
  // 2026-stapel (nedan), aldrig som egen huvudstapel. Tomläget förklaras av meddelandet i
  // ResultPanel; wrappern där gate:as på samma villkor så ingen tom ram blir kvar.
  if (!live) return null

  return (
    <div className="space-y-2.5">
      {/* Röstandel — övre stapeln. Bara partier över spärren; tomt spår = bortkastade
          röster. 50%-linjen markerar halva väljarkåren. */}
      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-semibold uppercase tracking-wide text-slate-300">Röstandel 2026</span>
          <div className="flex items-baseline gap-2">
            {prognos && (
              <span className="rounded-full border border-amber-500/60 px-1.5 text-[12px] font-semibold uppercase tracking-wide text-amber-400">
                Prognos · {reportPct} %
              </span>
            )}
            <span className="text-[12px] text-slate-400">50 % av rösterna</span>
          </div>
        </div>
        <BarRow>
          <StackedBar segs={andelShown} height={22} labels total={1} title={trackTitle} valueFmt={(v) => `${(v * 100).toFixed(1)} %`} />
          {andelShown.length > 0 && <MajorityLine />}
        </BarRow>
        {andel2022.length > 0 && (
          <div className="mt-1">
            {/* Spökstapeln fyller hela bredden (som mandatspöket) så den linjerar med
                huvudstapeln — annars blev den kortare av 2022 års bortkastade röster. */}
            <BarRow tag="’22">
              <StackedBar segs={andel2022} height={6} faded valueFmt={(v) => `${(v * 100).toFixed(1)} %`} />
            </BarRow>
          </div>
        )}
      </div>

      {/* Mandat — undre stapeln (bredd = totala mandat) + majoritetslinje */}
      {liveM && (
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[13px] font-semibold uppercase tracking-wide text-slate-300">
              Mandat 2026 · <span className="text-slate-100">{mTotal}</span>
            </span>
            <span className="text-[12px] text-slate-400">{majoritet} för egen majoritet</span>
          </div>
          <BarRow>
            <StackedBar segs={mandat2026} height={22} labels />
            <MajorityLine />
          </BarRow>
          {mandat2022.length > 0 && (
            <div className="mt-1">
              <BarRow tag="’22">
                <StackedBar segs={mandat2022} height={6} faded />
              </BarRow>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
