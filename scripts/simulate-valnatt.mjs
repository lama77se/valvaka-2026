// Fas 5–6 — simulerad valnatt: upsertar resultat i klungor så kartklienten kan
// visa realtidsfärgning. INTE riktig data — bara för att bevisa Realtime→kart-paint
// tills 2026-filerna finns. Fas 7 gör riktig 2022-replay via result_snapshot.
//
//   node --env-file=.env.local scripts/simulate-valnatt.mjs [--districts N] [--batch N] [--delay ms] [--valtyp RD|RF|KF|alla]
//
// --valtyp alla (default) fyller alla tre valen med olika brus per valtyp, så
// valtyp-väljaren visar olika vinnare. Demogräns: använder de 8 färgade riksdags-
// partierna även för RF/KF (lokala partier saknar färg och skulle bli grå).
//
// Kräver service-role (kringgår RLS, skriver result). Städa efteråt med
// scripts/reset-results.mjs så demodata inte ligger kvar och ser skarpt ut.
import ws from 'ws'
import { createClient } from '@supabase/supabase-js'

globalThis.WebSocket ??= ws

const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Saknar VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (kör med --env-file=.env.local).')
  process.exit(1)
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } })

const arg = (name, def) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : def
}
const LIMIT = Number(arg('--districts', '400'))
const BATCH = Number(arg('--batch', '20'))
const DELAY = Number(arg('--delay', '400'))
const VALTYP_ARG = String(arg('--valtyp', 'alla')).toUpperCase()
const VALTYPER = VALTYP_ARG === 'ALLA' ? ['RD', 'RF', 'KF'] : [VALTYP_ARG]
const log = (m) => console.log(`[simulate] ${m}`)

// Bara riksdagspartier har märkesfärg → färgas på kartan. Basnivåer ~ 2022 så
// vinnaren varierar realistiskt mellan distrikt (S/SD/M oftast leder).
const BASE = { S: 300, SD: 260, M: 200, V: 80, C: 80, KD: 70, MP: 60, L: 55 }

const { data: parties, error: pErr } = await db
  .from('party')
  .select('partikod,forkortning')
  .not('color', 'is', null)
if (pErr) throw new Error(`party: ${pErr.message}`)

const { data: districts, error: dErr } = await db
  .from('district')
  .select('valdistriktskod')
  .limit(LIMIT)
if (dErr) throw new Error(`district: ${dErr.message}`)

log(`valtyper ${VALTYPER.join('/')}, ${parties.length} färgade partier, ${districts.length} distrikt, batch ${BATCH}, delay ${DELAY} ms`)

for (const valtyp of VALTYPER) {
  let done = 0
  for (let i = 0; i < districts.length; i += BATCH) {
    const rows = []
    for (const d of districts.slice(i, i + BATCH)) {
      // Slumpa ett distrikts profil: skala varje partis bas med brus. Bruset
      // skiljer per valtyp → olika vinnare, så valtyp-väljaren visar skillnad.
      for (const p of parties) {
        const base = BASE[p.forkortning] ?? 40
        const roster = Math.max(0, Math.round(base * (0.4 + Math.random() * 1.4)))
        rows.push({
          valtyp,
          valdistriktskod: d.valdistriktskod,
          partikod: p.partikod,
          roster,
          status: 'preliminar',
        })
      }
    }
    const { error } = await db
      .from('result')
      .upsert(rows, { onConflict: 'valtyp,valdistriktskod,partikod' })
    if (error) throw new Error(`upsert: ${error.message}`)
    done += Math.min(BATCH, districts.length - i)
    log(`${valtyp}: ${done}/${districts.length} distrikt inrapporterade`)
    if (i + BATCH < districts.length) await new Promise((r) => setTimeout(r, DELAY))
  }
}
log('KLART.')
process.exit(0)
