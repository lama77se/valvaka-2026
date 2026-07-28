// Fas 3 — poll-ingestion av deltagande-partier.csv (Deno edge function).
//
// Kadens (pg_cron/pg_net): 1×/timme i förvalsperioden. Conditional GET via
// If-Modified-Since (val.se honorerar Last-Modified men INTE ETag → 304 bara på
// IMS). 304 => hoppa parsning helt. Idempotent upsert av `party` (rör inte
// `color`, som är editoriell Fas 2-mappning).
//
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY auto-injiceras i edge-runtime — ingen
// secret att sätta.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CSV_URL = 'https://data.val.se/filer/val2026/parti/deltagande-partier.csv'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // 1. Senaste conditional-GET-state för filen.
  const { data: state } = await supabase
    .from('ingest_state')
    .select('last_modified')
    .eq('file_path', CSV_URL)
    .maybeSingle()

  // 2. Conditional GET (If-Modified-Since driver skip; ETag honoreras inte).
  const headers: Record<string, string> = {}
  if (state?.last_modified) headers['If-Modified-Since'] = state.last_modified
  const res = await fetch(CSV_URL, { headers })

  const touchState = (patch: Record<string, unknown>) =>
    supabase
      .from('ingest_state')
      .upsert({ file_path: CSV_URL, last_ok: new Date().toISOString(), ...patch }, {
        onConflict: 'file_path',
      })

  if (res.status === 304) {
    await touchState({ last_status: 304 })
    return json({ skipped: true, status: 304 })
  }
  if (!res.ok) {
    await touchState({ last_status: res.status })
    return json({ error: `fetch ${res.status}` }, 502)
  }

  // 3. Husstil: strippa BOM, avgränsare ';', versala nycklar, koder som string.
  let text = await res.text()
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const lines = text.split(/\r?\n/).filter(Boolean)
  const H = lines[0].split(';')
  const iKod = H.indexOf('PARTIKOD')
  const iBet = H.indexOf('PARTIBETECKNING')
  const iFor = H.indexOf('PARTIFÖRKORTNING')
  if (iKod < 0 || iBet < 0) {
    return json({ error: 'oväntade kolumner i CSV-header' }, 500)
  }

  // 4. Dedupe per partikod (parti × valområde × valtyp → distinkt parti).
  const byKod = new Map<string, Record<string, unknown>>()
  for (const line of lines.slice(1)) {
    const c = line.split(';')
    const partikod = c[iKod]?.trim()
    if (!partikod || byKod.has(partikod)) continue
    byKod.set(partikod, {
      partikod,
      beteckning: c[iBet]?.trim() ?? '',
      forkortning: c[iFor]?.trim() || null,
      // color utelämnas medvetet — editoriell mappning (Fas 2). on-conflict lämnar den orörd.
    })
  }
  const parties = [...byKod.values()]

  // 5. Idempotent upsert (ingen körning duplicerar rader).
  const { error } = await supabase.from('party').upsert(parties, { onConflict: 'partikod' })
  if (error) return json({ error: error.message }, 500)

  // 6. Spara ny conditional-GET-state.
  await touchState({
    last_modified: res.headers.get('Last-Modified'),
    etag: res.headers.get('ETag'),
    last_status: 200,
  })

  return json({ ok: true, upserted: parties.length })
})
