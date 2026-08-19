// Fas 7 — RESULTAT-ingestion (valnatt). Den skarpa vägen "2026-resultat flödar in":
// pollar Valmyndighetens resultatfiler, packar upp röstfördelnings-JSON och upsertar
// `result` (→ Realtime → kart-paint). Speglar ingest-parti (Deno edge + pg_cron +
// ingest_state), men för röster i stället för partiregister.
//
// KÄLLA — just nu GENERALREPET (`genrep2026`): Valmyndighetens generalrepetition är
// en LIVE, kontinuerligt uppdaterad test-feed (`test: true`) med exakt samma format
// som skarpa valnatten. Vi kör mot den NU för att verifiera hela kedjan. På valnatten
// 13 sep 2026: byt RESULT_BASE_DEFAULT till `.../val2026` (samma kod, ny katalog) och
// deploya om. Provenance skrivs till `dataset_meta` → UI:t visar en "generalrep/test"-
// banner så testdata aldrig förväxlas med skarpa resultat.
//
// FORMAT (verifierat mot genrep 2026-08-18):
//   resultat.val.se/resultatfiler/<base>/index.md5  = manifest: "<md5>␠␠./p/<vt>/<fil>.zip"
//   En zip per organ (RD riket=00, RF per region, KF per kommun) → innehåller
//   ..._rostfordelning_<kod>_<VT>.json (+ mandat + sha256). JSON, EJ husstil-CSV.
//   Röster som räknas = rostfordelning.rosterPaverkaMandat.partiRoster[].antalRoster.
//
// FALLGROPAR: (a) uppsamlingsdistrikt har KORT kod (len 6, t.ex. "011400") → FK mot
// district (8-siffrig) skulle brista → filtreras bort. (b) partikod har inledande
// nollor ("0001"). (c) result_snapshot skrivs INTE här (genrep uppdateras oavbrutet →
// append-only skulle svälla); replay/audit är en separat Fas 7-väg.
//
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY auto-injiceras i edge-runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { unzipSync } from 'https://esm.sh/fflate@0.8.2'

// Generalrepet nu → byt till 'https://resultat.val.se/resultatfiler/val2026' på valnatten.
const RESULT_BASE_DEFAULT = 'https://resultat.val.se/resultatfiler/genrep2026'
// Organ-filer per körning; pg_cron plockar resten nästa varv (håller körningen inom
// edge-runtimens minnes-/CPU-tak). Lågt satt eftersom en enskild organ-fil kan vara
// tung (preliminär RD ~2 MB / ~30 MB uppackad); pg_cron kör ofta nog för att hinna ikapp.
const MAX_FILES_DEFAULT = 10

// STORLEKSVAKT: en organ-zip större än detta packas INTE upp — den skippas (men
// markeras done). Edge-runtimen har 256 MB minne (EJ höjbart, inte ens på Pro) → en
// ~9 MB slutlig RD-zip (~130 MB uppackad) spränger taket och dödar HELA invokeringen.
// Det är INTE fångbart (try/catch räddar inte) → med äldst-först-ordningen skulle en
// sådan fil krascha varje varv och svälta resten. ~2 MB preliminär RD ryms; tröskeln
// lämnar marginal. Stor/slutlig RD kräver streaming-parse eller en Node-worker (docs).
const MAX_ZIP_BYTES = 4_000_000

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({})) as { base?: string; max?: number }
  const base = (body.base ?? RESULT_BASE_DEFAULT).replace(/\/+$/, '')
  const max = Number(body.max ?? MAX_FILES_DEFAULT)
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // 1. Manifest → organ-zip-poster (md5 + full URL). Bara röstfördelnings-organzip.
  const idxRes = await fetch(`${base}/index.md5`)
  if (!idxRes.ok) return json({ error: `manifest ${idxRes.status}`, base }, 502)
  const files = (await idxRes.text())
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => { const p = l.split(/\s+/); return { md5: p[0], rel: p[p.length - 1] } })
    // Bara PRELIMINÄRA organ-zip (`./p/…`). Slutliga (`./s/…`) hoppas över: genrepets
    // slutliga RD-fil är ~9 MB (~130 MB uppackad) → spränger edge-runtimens minne
    // (WORKER_RESOURCE_LIMIT). Stor/slutlig RD kräver streaming-parse eller mer minne
    // — se valnatt-checklistan i docs/resultat-ingest-genrep.md.
    .filter((e) => /_(RD|RF|KF)\.zip$/i.test(e.rel) && e.rel.includes('/p/'))
    .map((e) => ({ ...e, url: base + e.rel.replace(/^\./, '') }))
  if (files.length === 0) return json({ error: 'inga organ-zip i manifestet', base }, 502)

  // 2. Ändrade sedan sist? Manifest-md5 lagras i ingest_state.etag (val.se-ETag
  //    honoreras ändå inte — se ingest_state-migrationen). Läs staten med ETT
  //    prefix-filter på base — ALDRIG .in() med alla ~314 URL:er: det ger en överlång
  //    request-URI → tom träff → funktionen "ser" aldrig sitt state och kör om samma
  //    första 25 filer i evighet (RF/RD/övriga KF svälts). Ordna dessutom äldst/osedd
  //    först så manifestets svans inte svälts när källan uppdateras kontinuerligt.
  const { data: states } = await supabase
    .from('ingest_state')
    .select('file_path,etag,last_ok')
    .like('file_path', `${base}/%`)
  const seen = new Map((states ?? []).map((s) => [s.file_path, s.etag]))
  const lastOk = new Map((states ?? []).map((s) => [s.file_path, s.last_ok as string | null]))
  const allChanged = files
    .filter((f) => seen.get(f.url) !== f.md5)
    .sort((a, b) => (Date.parse(lastOk.get(a.url) ?? '') || 0) - (Date.parse(lastOk.get(b.url) ?? '') || 0))
  const changed = allChanged.slice(0, max)
  if (changed.length === 0) return json({ ok: true, changed: 0, total: files.length })

  // 3. Giltiga koder (FK-krav result→district / result→party). Laddas en gång.
  const districtSet = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('district').select('valdistriktskod').range(from, from + 999)
    if (!data || data.length === 0) break
    for (const d of data) districtSet.add(d.valdistriktskod)
    if (data.length < 1000) break
  }
  const { data: parties } = await supabase.from('party').select('partikod')
  const partySet = new Set((parties ?? []).map((p) => p.partikod))

  // 4. Per ändrad organ-fil: hämta → (storleksvakt) → unzip → parsa → upsert result.
  let upserted = 0
  let skipped = 0
  let meta: { valtillfalle?: string; test?: boolean; rakningstillfalle?: string; senasteUppdateringstid?: string } | null = null
  for (const f of changed) {
    const zres = await fetch(f.url)
    if (!zres.ok) continue // transient → försök igen nästa varv (markera INTE done)
    const buf = new Uint8Array(await zres.arrayBuffer())
    let lastStatus = 200
    if (buf.byteLength > MAX_ZIP_BYTES) {
      // För stor → hoppa uppackningen (annars OOM → död invokering → svält). Markeras
      // done nedan (413) så äldst-först inte fastnar och kraschar på den varje varv.
      skipped++
      lastStatus = 413
    } else {
      try {
        const unz = unzipSync(buf)
        const name = Object.keys(unz).find((n) => /rostfordelning.*\.json$/i.test(n))
        if (name) {
          const j = JSON.parse(new TextDecoder().decode(unz[name]))
          meta = j
          const rakstatus = String(j.rakningstillfalle ?? '').startsWith('prelimin') ? 'preliminar' : 'slutlig'
          const rows: Record<string, unknown>[] = []
          for (const vd of j.valdistrikt ?? []) {
            const kod = vd.valdistriktskod
            if (typeof kod !== 'string' || kod.length !== 8 || !districtSet.has(kod)) continue // uppsamling/okänd
            for (const p of vd.rostfordelning?.rosterPaverkaMandat?.partiRoster ?? []) {
              if (!partySet.has(p.partikod)) continue
              rows.push({ valtyp: j.valtyp, valdistriktskod: kod, partikod: p.partikod, roster: p.antalRoster, status: rakstatus })
            }
          }
          // Små transaktioner (≤100 rader/upsert): Realtime tappar HELT ändringar från
          // stora txns (>~100 rader) → live-kartan skulle inte målas om. Fler round-trips,
          // men RD (~500 upserts, ~40 s) ryms väl inom väggtiden (150 s free / 400 s paid).
          for (let i = 0; i < rows.length; i += 100) {
            const { error } = await supabase.from('result').upsert(rows.slice(i, i + 100), { onConflict: 'valtyp,valdistriktskod,partikod' })
            if (error) break // blockera inte hela pipelinen på ett fel — filen markeras ändå done nedan
            upserted += Math.min(100, rows.length - i)
          }
        }
        // Markera filen behandlad ÄVEN utan röstfördelning / med 0 rader (t.ex. OS-/
        // utlandsfiler) — annars väljs den om och om igen (äldst-först) och blockerar svansen.
      } catch { lastStatus = 422 /* korrupt/oväntad fil för denna md5 → markera done ändå */ }
    }
    await supabase.from('ingest_state').upsert({ file_path: f.url, etag: f.md5, last_ok: new Date().toISOString(), last_status: lastStatus }, { onConflict: 'file_path' })
  }

  // 5. Provenance för UI-badgen (best-effort — funkar även innan dataset_meta-migrationen).
  if (meta) {
    await supabase.from('dataset_meta').upsert({
      id: 1,
      source: base.includes('genrep') ? 'genrep2026' : 'val2026',
      valtillfalle: meta.valtillfalle ?? null,
      test: !!meta.test,
      rakningstillfalle: meta.rakningstillfalle ?? null,
      kalla_uppdaterad: meta.senasteUppdateringstid ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
  }

  return json({ ok: true, source: base.includes('genrep') ? 'genrep2026' : 'val2026', changed: changed.length, upserted, skipped, remaining: allChanged.length - changed.length })
})
