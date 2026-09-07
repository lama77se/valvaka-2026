// Mandat-/röstandelsvisualisering som TVÅ liggande staplar i stället för soffbågen —
// kompaktare och mer läsbar (best practice: spektrumordning, majoritetslinje, färg +
// etikett-där-det-får-plats; exakta siffror finns i tabellen rakt under). Övre stapel =
// röstandel (100 % bred), undre = mandat (bredd = totala mandat, med majoritetslinje).
// 2022 visas ALDRIG som egen huvudstapel — bara som en tunn "spök"-stapel UNDER en levande
// 2026-stapel (då-vs-nu). Saknas 2026 (förvalsperiod / 0 % räknat) renderas inga staplar
// alls (en full 2022-stapel skilde sig bara på årtalet i etiketten → lästes som aktuellt).
import type { ReactNode } from 'react'
import type { OvrigaRow, PartyRow } from '@/lib/aggregate'
import { spectrumRank, type BlockConfig } from '@/lib/soffa'

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
  blocks?: BlockConfig // tvåblocksvyn under staplarna (riksblock ELLER regionstyre-vs-opposition — se soffa.ts/regionBlocks.ts)
  compact?: boolean // mobil: kortare siffror/etiketter i blockrutorna, se nedan
}

export function MandatBars({ shown, ovriga, totalMandat, giltiga, sparr, reportPct, blocks, compact }: MandatBarsProps) {
  const live = giltiga > 0
  const parties = [...shown].sort((a, b) => spectrumRank(a.forkortning) - spectrumRank(b.forkortning))

  // Blocksummor: andel = summa partiandelar (0..1 av giltiga), mandat = summa mandat.
  // Markör vid majoritet (>50 % / ≥ majoritet-mandat) — `blocks` avgör VILKA partier som
  // hör till vardera sidan (riksblock: två uttryckliga listor; region: styret är
  // uttryckligt, oppositionen är `'rest'` = totalen minus styret, se soffa.ts). `'rest'`
  // räknas ur ALLA partier + Övriga (inte bara `shown`) så t.ex. L/MP inte "försvinner"
  // bara för att de inte står i regionens styre-lista.
  const blockSum = (labels: string[]) =>
    parties.reduce((a, p) => (p.forkortning && labels.includes(p.forkortning) ? { andel: a.andel + p.andel, mandat: a.mandat + (p.mandat ?? 0), roster: a.roster + p.roster } : a), { andel: 0, mandat: 0, roster: 0 })
  const totalSum = () =>
    parties.reduce((a, p) => ({ andel: a.andel + p.andel, mandat: a.mandat + (p.mandat ?? 0), roster: a.roster + p.roster }), { andel: ovriga?.andel ?? 0, mandat: ovriga?.mandat ?? 0, roster: ovriga?.roster ?? 0 })
  const rest = (other: { andel: number; mandat: number; roster: number }) => {
    const t = totalSum()
    return { andel: t.andel - other.andel, mandat: t.mandat - other.mandat, roster: t.roster - other.roster }
  }
  let blockA = blocks && blocks.a.parties !== 'rest' ? blockSum(blocks.a.parties) : null
  let blockB = blocks && blocks.b.parties !== 'rest' ? blockSum(blocks.b.parties) : null
  if (blocks?.a.parties === 'rest' && blockB) blockA = rest(blockB)
  if (blocks?.b.parties === 'rest' && blockA) blockB = rest(blockA)

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

      {/* Tvåblocksvyn (riksblock ELLER regionstyre-vs-opposition, se `blocks`-configen som
          skickas in): andel + mandat, markör vid majoritet (✓ >50 % röster, ✓ + grön ram
          vid ≥ majoritet-mandat — ingen egen textrad, bocken + ramen räcker som signal).
          Två rutor i halva panelbredden är det trängsta i hela vyn: på mobil är varje ruta
          ~155 px och raden "50,369 % ✓ 175 mand. ✓" sprack mitt i talen. `compact` kortar
          därför ner allt som kostar bredd — två decimaler i stället för tre, "mdt" i
          stället för "mand.", en snäppet mindre grad och smalare luft. `whitespace-nowrap`
          gör dessutom att ett tal ALDRIG kan brytas internt: blir det ändå för trångt
          (extremt smal skärm, stor systemtextstorlek) wrappar flex hela mandat-chippet till
          egen rad, vilket är läsbart — "50,369" / "% ✓" är det inte. */}
      {blocks && blockA && blockB && (
        <div className="pt-0.5">
          <div className="grid grid-cols-2 gap-1.5 text-slate-100">
            {/* SD till höger, V till vänster — samma spalter som riksblocken (V+S+MP+C /
                L+KD+M+SD) — oavsett vilken ordning configen (soffa.ts/regionBlocks.ts) råkar
                lista a/b i. SD har företräde om reglerna skulle peka åt olika håll (osannolikt
                att V och SD delar block). Ingen regel slår in (t.ex. "S+M" mot en lokallista)
                → behåll configens egen a/b-ordning. */}
            {(() => {
              // Explicit typvakt (inte bara .includes på unionen) — 'rest' är en sentinel,
              // inte en partilista, och ska aldrig av misstag matcha 'SD'/'V' som substräng.
              const has = (block: typeof blocks.a, code: string) => Array.isArray(block.parties) && block.parties.includes(code)

              // Etiketten för en 'rest'-sida listar VILKA partier som faktiskt räknas dit just
              // nu (mandat > 0, inte med i det andra blocket) — beräknat live, ALDRIG en
              // hårdkodad gissning i configen. En statisk "(S+C+V)" blir fel så fort ett parti
              // som historiskt haft 0 mandat oväntat får ett (t.ex. L/MP i en genrep-körning).
              const labelFor = (block: typeof blocks.a, other: typeof blocks.a) => {
                const otherParties = other.parties
                if (block.parties !== 'rest' || !Array.isArray(otherParties)) return block.label
                const names = parties
                  .filter((p) => p.forkortning && !otherParties.includes(p.forkortning) && (p.mandat ?? 0) > 0)
                  .sort((x, y) => (y.mandat ?? 0) - (x.mandat ?? 0))
                  .map((p) => p.forkortning as string)
                if (ovriga && (ovriga.mandat ?? 0) > 0) names.push('Övr')
                return names.length ? `${block.label} (${names.join('+')})` : block.label
              }
              const labelA = labelFor(blocks.a, blocks.b)
              const labelB = labelFor(blocks.b, blocks.a)

              const aRight = has(blocks.a, 'SD') && !has(blocks.b, 'SD')
              const bLeft = !aRight && has(blocks.b, 'V') && !has(blocks.a, 'V')
              const swap = aRight || bLeft
              return swap
                ? ([[labelB, blockB, false], [labelA, blockA, true]] as const)
                : ([[labelA, blockA, false], [labelB, blockB, true]] as const)
            })().map(([label, b, right]) => {
              const voteMaj = b.andel > 0.5
              const seatMaj = liveM && b.mandat >= majoritet
              return (
                <div key={label} className={['rounded py-1', compact ? 'px-1.5' : 'px-2', seatMaj ? 'bg-emerald-500/15 ring-1 ring-emerald-500/50' : 'bg-slate-800/40', right ? 'text-right' : 'text-left'].join(' ')}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">{label}</div>
                  <div className={`mt-0.5 flex flex-wrap items-baseline leading-none ${compact ? 'gap-x-1 gap-y-0.5' : 'gap-1.5'} ${right ? 'justify-end' : ''}`}>
                    <span className={`whitespace-nowrap font-bold tabular-nums ${compact ? 'text-[13px]' : 'text-sm'} ${voteMaj ? 'text-emerald-300' : 'text-slate-100'}`}>
                      {(b.andel * 100).toFixed(compact ? 2 : 3).replace('.', ',')} %{voteMaj ? ' ✓' : ''}
                    </span>
                    {liveM && (
                      <span className={`whitespace-nowrap tabular-nums ${compact ? 'text-[11px]' : 'text-[12px]'} ${seatMaj ? 'font-bold text-emerald-300' : 'text-slate-400'}`}>
                        {b.mandat} {compact ? 'mdt' : 'mand.'}{seatMaj ? ' ✓' : ''}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="pt-1.5 text-center text-[13px] text-slate-400">
            <span className="font-bold tabular-nums text-slate-100">{Math.abs(blockB.roster - blockA.roster).toLocaleString('sv-SE')}</span> röster skiljer{' '}
            <span className="cursor-help text-slate-500" title={blocks.note}>(*)</span>
          </div>
        </div>
      )}
    </div>
  )
}
