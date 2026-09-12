// Områdesväljarens rena logik — vilka nivåer/prompt-text varje valtyp erbjuder, och
// hur ett <select>-värde mappas till ett Area. Extraherad ur ResultPanel.tsx:46-51,
// 422-433 (oförändrad logik, bara flyttad) så AreaSelect.tsx (Dashboard-vyns egna
// väljarinstanser) och ResultPanel själv kan dela EN källa i stället för att driva
// isär. Se docs/superpowers/specs/2026-09-12-dashboard-vy-design.md.
import type { Level } from '@/lib/aggregate'
import type { Valtyp } from './results'

export type Area = { level: Level; code: string | null }
export const RIKET: Area = { level: 'riket', code: null }

const NATIVE_LEVEL: Record<Valtyp, Level> = { RD: 'riket', RF: 'region', KF: 'kommun' }
const defaultAreaFor = (valtyp: Valtyp): Area => ({ level: NATIVE_LEVEL[valtyp], code: null })

// Nivåer väljaren erbjuder per valtyp: den nativa nivån + geografisk nedbrytning
// UNDER den (aldrig uppåt). RD: riket → VALKRETS (riksdagens nivå) → kommun; RF:
// region → VALKRETS (regionens nivå — Stockholm delas tvärs kommuner) → distrikt;
// KF bara kommun.
export const LEVELS: Record<Valtyp, ('riket' | 'valkrets' | 'region' | 'kommun')[]> = {
  RD: ['riket', 'valkrets', 'kommun'],
  RF: ['region', 'valkrets'],
  KF: ['kommun'],
}
export const PROMPT: Record<Valtyp, string> = { RD: '', RF: 'Välj region…', KF: 'Välj kommun…' }

// Mappar <select>:ens value-attribut (t.ex. "vk:29", "k:1488", "r:01", "riket", "")
// till ett Area. `null` = distrikt-värde ("d:...") — distrikt sätts via kartklick,
// inte listan, samma tidiga return som ResultPanel.tsx:424 gjorde inline.
export function areaFromSelectValue(valtyp: Valtyp, raw: string): Area | null {
  if (raw.startsWith('d:')) return null
  if (raw === '') return defaultAreaFor(valtyp)
  if (raw === 'riket') return RIKET
  if (raw.startsWith('vk:')) return { level: 'valkrets', code: raw.slice(3) }
  return { level: raw.startsWith('r:') ? 'region' : 'kommun', code: raw.slice(2) }
}
