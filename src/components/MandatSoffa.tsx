// Riksdagssoffan — mandatprojektionen som en halvcirkel (parliament-arc), en prick
// per mandat, färgad per parti och ordnad vänster→höger på politisk skala. Ren
// presentation av mandaten som redan räknats (computeMandate, facit-verifierat) —
// ingen egen data. Visas där ett organ faktiskt fördelas (RD@riket, RF@region,
// KF@kommun); dold på aggregat-/distriktsnivå. Geometrin ligger i lib/soffa.ts.
import { rowsFor, seatPositions, spectrumRank, SOFFA_INNER, SOFFA_OUTER } from '@/lib/soffa'

const NEUTRAL = '#64748b'
const RPX = 185
const PAD = 8
const TOPPAD = 22 // extra topmarginal för 50 %-etiketten ovanför valvet

export interface SoffaSeat {
  forkortning: string | null
  farg: string | null
  mandat: number
}

export interface MandatSoffaProps {
  seats: SoffaSeat[]
  total: number
  caption?: string
  // Ungefärlig procent-soffa (ej fördelade mandat): ihåliga ringar, ingen
  // majoritetsmarkör, tydlig "≈"-etikett — så den aldrig förväxlas med räknade mandat.
  approx?: boolean
  // Etikett-pill överst (t.ex. "2022" för jämförelse-baslinjen). Faller tillbaka på
  // "≈ Ungefärlig · röstandel" när approx utan egen badge.
  badge?: string
  // Rapporteringsgrad (% räknade distrikt) för LIVE-soffan. < 100 → amber
  // "Prognos · X % räknat" så tidiga, volatila projektioner (runt spärren) inte
  // läses som facit. Utelämnas för 2022-baslinjen (alltid slutresultat).
  reportPct?: number | null
}

export function MandatSoffa({ seats, total, caption, approx = false, badge, reportPct }: MandatSoffaProps) {
  if (total <= 0) return null
  const pill = badge ?? (approx ? '≈ Ungefärlig · röstandel' : null)
  const prognos = reportPct != null && reportPct < 100 ? `Prognos · ${reportPct} % räknat` : null
  const ordered = [...seats]
    .filter((s) => s.mandat > 0)
    .sort((a, b) => spectrumRank(a.forkortning) - spectrumRank(b.forkortning) || b.mandat - a.mandat)

  // Platta ut till en färg per plats (parti upprepat `mandat` gånger), vänster→höger.
  const seatColor: string[] = []
  for (const p of ordered) for (let i = 0; i < p.mandat; i++) seatColor.push(p.farg ?? NEUTRAL)

  const positions = seatPositions(total)
  const dotR = Math.max(2, ((SOFFA_OUTER - SOFFA_INNER) * RPX) / (rowsFor(total) * 2.2))
  const majoritet = Math.floor(total / 2) + 1

  return (
    <div className="flex flex-col items-center">
      {(pill || prognos) && (
        <div className="mb-1 flex flex-col items-center gap-0.5">
          {pill && (
            <span className="rounded-full border border-slate-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {pill}
            </span>
          )}
          {prognos && (
            <span className="rounded-full border border-amber-500/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
              {prognos}
            </span>
          )}
        </div>
      )}
      <svg
        viewBox={`${-RPX - PAD} ${-RPX - TOPPAD} ${2 * (RPX + PAD)} ${RPX + TOPPAD + PAD}`}
        className="w-full"
        role="img"
        aria-label={approx ? `Ungefärlig fördelning efter röstandel, ${total} platser` : `Mandatfördelning, ${total} mandat`}
      >
        {positions.map((p, i) => {
          const c = seatColor[i] ?? NEUTRAL
          return approx ? (
            <circle
              key={i}
              cx={p.x * RPX}
              cy={-p.y * RPX}
              r={dotR}
              fill="none"
              stroke={c}
              strokeWidth={Math.max(1.25, dotR * 0.55)}
              opacity={0.85}
            />
          ) : (
            <circle key={i} cx={p.x * RPX} cy={-p.y * RPX} r={dotR} fill={c} />
          )
        })}
        {/* 50 %-linjen: valvet är symmetriskt och platserna ordnade runt bågen, så
            mitten (x=0) är exakt halva mandaten — majoritet nås när ena sidan fyller
            förbi den. Streckad linje + etikett så användaren ser var det skär. */}
        <line x1={0} y1={-(RPX + 4)} x2={0} y2={-SOFFA_INNER * RPX * 0.6} stroke="#cbd5e1" strokeWidth={1.5} strokeDasharray="3 3" />
        <text x={0} y={-(RPX + TOPPAD) + 11} textAnchor="middle" className="fill-slate-300" style={{ fontSize: 10, fontWeight: 600 }}>
          50 %
        </text>
        <text x={0} y={-6} textAnchor="middle" className="fill-slate-100" style={{ fontSize: 34, fontWeight: 700 }}>
          {approx ? `~${total}` : total}
        </text>
        <text x={0} y={16} textAnchor="middle" className="fill-slate-400" style={{ fontSize: 12 }}>
          {approx ? 'procent' : 'mandat'}
        </text>
      </svg>
      <p className="-mt-1 text-xs text-slate-400">
        {caption ?? (approx ? 'baserad på röstandel — ej fördelade mandat' : `${majoritet} för egen majoritet`)}
      </p>
    </div>
  )
}
