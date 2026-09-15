// Emelie Gustafsson (M) — halvdold sida, handover 14/15 sep (Lars). Förenklad 15 sep:
// bara personröster, tre EGNA frames (en per valtyp), får plats på EN mobilskärm utan
// scroll. All datahämtning i lib/eg_m.ts (bara en summa per valtyp — se dess docstring
// för varför resultat-/mandatdelen medvetet togs bort).
import { useEffect, useRef, useState } from 'react'
import { fetchEgMData, RESYNC_MAX_MS, RESYNC_MIN_MS, type EgMPersonroster } from '@/lib/eg_m'
import type { Valtyp } from '@/lib/results'

const nf = new Intl.NumberFormat('sv-SE')

export function EgMApp() {
  const [data, setData] = useState<EgMPersonroster[] | null>(null)
  const [failed, setFailed] = useState(false)
  const aliveRef = useRef(true)
  // Nedbrytnings-tabellen (Lars 15 sep: "en liten 'i'-knapp ... visa i vilket(a)
  // distrikt det kom och hur många") — vilket VALTYP-kort som just nu har sin tabell
  // öppen, om något. Ett enda state räcker (bara tre kort, aldrig mer än en öppen
  // åt gången är ett medvetet enkelt val för denna lilla sidan).
  const [openBreakdown, setOpenBreakdown] = useState<Valtyp | null>(null)

  useEffect(() => {
    aliveRef.current = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = () => {
      fetchEgMData()
        .then((d) => { if (aliveRef.current) { setData(d); setFailed(false) } })
        .catch(() => { if (aliveRef.current) setFailed(true) })
        .finally(() => {
          if (!aliveRef.current) return
          // Samma jittrade 30–45 s-takt som huvudsidans resync (se RESYNC_MIN_MS/MAX_MS-
          // kommentaren i lib/eg_m.ts) — självschemaläggande, ingen överlappning.
          timer = setTimeout(load, RESYNC_MIN_MS + Math.random() * (RESYNC_MAX_MS - RESYNC_MIN_MS))
        })
    }
    load()
    return () => { aliveRef.current = false; if (timer) clearTimeout(timer) }
  }, [])

  // TOTAL (handover 15 sep, Lars) — summan av alla tre valtypers personröster, en
  // enda räknare uppe vid namnet i stället för att behöva lägga ihop de tre frames
  // rutorna själv.
  const total = data?.reduce((a, p) => a + p.total, 0) ?? null

  return (
    // `justify-center` (borttaget 15 sep, Lars) höll fint när sidan fick plats på EN
    // mobilskärm (ursprunglig spec), men centrerar hela flex-kolumnen VERTIKALT — så
    // fort innehållet (nu: topp 3 + grannar per frame, mer text än den ursprungliga
    // topp-1-varianten) blir högre än viewporten skjuts headern nedåt i stället för att
    // ligga kvar överst, och man måste scrolla för att ens SE den. `justify-start` +
    // `py-6` (i stället för `py-4`, kompenserar det extra andrummet `justify-center`
    // annars gav upptill/nedtill) ger samma look när allt får plats på en skärm, men
    // headern ligger alltid överst och man scrollar bara nedåt för det som inte får
    // plats — aldrig förbi den.
    <div className="flex min-h-screen flex-col items-center justify-start gap-4 bg-slate-950 px-4 py-6 text-slate-100">
      <header className="flex w-full max-w-sm items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Emelie Gustafsson</h1>
          <p className="text-sm text-slate-400">Moderaterna — personröster 2026</p>
        </div>
        {total != null && (
          <p className="shrink-0 whitespace-nowrap pt-0.5 text-xs font-semibold tabular-nums text-sky-300">TOTAL: {nf.format(total)}</p>
        )}
      </header>

      {failed && !data && (
        <p className="rounded-md border border-rose-900 bg-rose-950/50 px-3 py-2 text-sm text-rose-300">
          Kunde inte hämta data just nu. Försöker igen automatiskt.
        </p>
      )}
      {!data && !failed && <p className="text-sm text-slate-500">Laddar…</p>}

      {data && (
        <div className="flex w-full max-w-sm flex-col gap-4">
          {data.map((p) => (
            <div key={p.valtyp} className="relative rounded-lg border border-slate-800 bg-slate-900/40 px-5 py-4 text-center">
              {/* Sluträkningsgrad (handover 15 sep, Lars) — badge i övre högra hörnet:
                  RD/RF mot Gävleborgs läns totala distriktsantal (samma geografi för
                  båda), KF mot Hudiksvalls kommuns — se lib/eg_m.ts:s fetchSlutligCount/
                  fetchDistrictTotal för nämnarens exakta betydelse ("alla distrikt i
                  området", inte bara redan rapporterade). */}
              <span
                className="absolute right-2 top-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-300"
                title={`${p.slutligDone} av ${p.slutligTotal} distrikt slutgiltigt räknade`}
              >
                {p.slutligPct} %
              </span>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{p.label}</p>
              <p className="mt-2 text-5xl font-bold tabular-nums text-slate-100">{nf.format(p.total)}</p>
              <div className="mt-1 flex items-center justify-center gap-1">
                <p className="text-sm text-slate-500">personröster</p>
                {/* "i"-knapp (Lars 15 sep) — bara synlig när det finns något att visa
                    (breakdown redan filtrerad till antal > 0 i lib/eg_m.ts). Togglar en
                    liten tabell i stället för hover (pekskärm — sidan är byggd mobilfirst,
                    se rot-divens max-w-sm). */}
                {p.breakdown.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOpenBreakdown((v) => (v === p.valtyp ? null : p.valtyp))}
                    aria-label="Visa fördelning per plats"
                    aria-expanded={openBreakdown === p.valtyp}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-600 text-[10px] font-semibold leading-none text-slate-400 hover:border-sky-500 hover:text-sky-300"
                  >
                    i
                  </button>
                )}
              </div>
              {openBreakdown === p.valtyp && p.breakdown.length > 0 && (
                <div className="mt-2 space-y-0.5 border-t border-slate-800 pt-2 text-left">
                  {p.breakdown.map((b, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[11px] tabular-nums text-slate-400">
                      <span className="min-w-0 flex-1 truncate">{b.plats}</span>
                      <span className="shrink-0 text-slate-300">{nf.format(b.antal)}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Plats bland M:s egna kandidater i samma geografi (handover 15 sep,
                  Lars) — döljs helt tills hon (eller någon annan M-kandidat) faktiskt
                  har personröster i området att rangordna mot, se lib/eg_m.ts. */}
              {p.rank != null && (
                <p className="mt-1 text-xs tabular-nums text-sky-300">
                  Plats {p.rank} av {p.rankTotal} (M)
                </p>
              )}
              {/* Topp 3 + grannarna på platsen före/efter henne (handover 15 sep, Lars:
                  "vem som är 1'a ... och vem som är på platsen före/efter henne", plus
                  samma dags uppföljning "topp 3 istället för topp 1 bara"). Max fem
                  rader, redan dedupade i lib/eg_m.ts (t.ex. plats 2 → "plats före" ÄR
                  redan med i topp 3, visas bara en gång). */}
              {p.neighbors.length > 0 && (
                <div className="mt-3 space-y-0.5 border-t border-slate-800 pt-2 text-left">
                  {p.neighbors.map((n) => (
                    <div key={n.rank} className="flex items-center gap-1.5 text-[11px] tabular-nums text-slate-400">
                      <span className="w-4 shrink-0 text-right text-slate-500">{n.rank}.</span>
                      <span className={`min-w-0 flex-1 truncate ${n.rank === p.rank ? 'font-semibold text-sky-300' : ''}`}>{n.namn}</span>
                      <span className="shrink-0 text-slate-300">{nf.format(n.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-center text-[11px] text-slate-600">Data från Valmyndigheten, via valvaka.tech.</p>
    </div>
  )
}
