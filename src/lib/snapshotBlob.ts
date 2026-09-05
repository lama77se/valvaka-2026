// Snapshot-blob från CDN (docs/valnatt-lastkapacitet.md, "CDN-cache-contingency" — byggd 5 sep).
//
// Vid mount seedar klienten sina stores från EN förgenererad JSON-blob per valtyp (Supabase
// Storage bakom Cloudflare, samma cache som geometrin) i stället för ~30 PostgREST-sidor. Mount-
// herden (alla öppnar 20:00) blir då CDN-trafik, inte Postgres-CPU: 50 desktop-flikar mätte
// 236 000 rader / 34 requests per flik och satte Small på 100 %.
//
// Bloben genereras av Postgres (RPC snapshot_json) och laddas upp av ingest-result efter varje
// körning som ändrade något (+ 5-min-cron). Klienten sätter cursorn till blobens `hwm` → delta-
// pollen tar gapet sedan generering. Korrektheten beror INTE på färskheten; en gammal blob ger
// bara en större första delta. Äldre än MAX_AGE_MS → ignorera (fall tillbaka på keyset-vägen) så
// en trasig generator inte ger en jättedelta per flik.
import type { Valtyp } from '@/lib/results'

export interface SnapshotBlob {
  v: number
  valtyp: string
  generated_at: string
  hwm: string
  turnout_hwm: string
  result: Array<[string, string, number, string | null, string | null]> // vd, pk, roster, status, rapporteringstid
  turnout: Array<[string, number, number]> // vd, totalt_antal_roster, antal_rostberattigade
}

const MAX_AGE_MS = 15 * 60_000
const TIMEOUT_MS = 30_000

export function snapshotBlobUrl(vt: Valtyp): string | null {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined
  return base ? `${base.replace(/\/+$/, '')}/storage/v1/object/public/snapshots/${vt}.json` : null
}

// null = ingen användbar blob (saknas, nätfel, fel form, för gammal) → anroparen tar keyset-vägen.
export async function fetchSnapshotBlob(vt: Valtyp): Promise<SnapshotBlob | null> {
  const url = snapshotBlobUrl(vt)
  if (!url) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    const blob = (await res.json()) as Partial<SnapshotBlob>
    if (
      blob.v !== 1 || blob.valtyp !== vt ||
      typeof blob.hwm !== 'string' || typeof blob.turnout_hwm !== 'string' || typeof blob.generated_at !== 'string' ||
      !Array.isArray(blob.result) || !Array.isArray(blob.turnout)
    ) return null
    const age = Date.now() - Date.parse(blob.generated_at)
    if (!Number.isFinite(age) || age > MAX_AGE_MS) return null
    return blob as SnapshotBlob
  } catch {
    return null
  }
}
