// Riksdagssoffan — mandatprojektionen som en halvcirkel (parliament-arc), en prick
// per mandat, färgad per parti och ordnad vänster→höger på politisk skala. Ren
// presentation av mandaten som redan räknats (computeMandate, facit-verifierat) —
// ingen egen data. Visas där ett organ faktiskt fördelas (RD@riket, RF@region,
// KF@kommun); dold på aggregat-/distriktsnivå. Geometrin ligger i lib/soffa.ts.
import { rowsFor, seatPositions, spectrumRank, SOFFA_INNER, SOFFA_OUTER } from '@/lib/soffa'

const NEUTRAL = '#64748b'
const RPX = 185
const PAD = 8

export interface SoffaSeat {
  forkortning: string | null
  farg: string | null
  mandat: number
}

export interface MandatSoffaProps {
  seats: SoffaSeat[]
  total: number
  caption?: string
}

export function MandatSoffa({ seats, total, caption }: MandatSoffaProps) {
  if (total <= 0) return null
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
      <svg
        viewBox={`${-RPX - PAD} ${-RPX - PAD} ${2 * (RPX + PAD)} ${RPX + 2 * PAD}`}
        className="w-full"
        role="img"
        aria-label={`Mandatfördelning, ${total} mandat`}
      >
        {positions.map((p, i) => (
          <circle key={i} cx={p.x * RPX} cy={-p.y * RPX} r={dotR} fill={seatColor[i] ?? NEUTRAL} />
        ))}
        <text x={0} y={-6} textAnchor="middle" className="fill-slate-100" style={{ fontSize: 34, fontWeight: 700 }}>
          {total}
        </text>
        <text x={0} y={16} textAnchor="middle" className="fill-slate-400" style={{ fontSize: 12 }}>
          mandat
        </text>
      </svg>
      <p className="-mt-1 text-xs text-slate-400">{caption ?? `${majoritet} för egen majoritet`}</p>
    </div>
  )
}
