// Källhänvisning saknar annars plats på mobil (desktopens info-kort finns bara i
// vänsterspalten) — Valmyndighetens villkor kräver att källan syns oavsett viewport.
// Enkel knapp + overlay-popover, samma text som desktop via <AttributionInfo>.
//
// Delad mellan mobil (MobileChrome) och desktop Dashboard-läge (App.tsx) — extraherad
// härifrån (ursprungligen mobil-lokal) i samband med finalgranskningens fix-våg.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AttributionInfo } from '@/components/AttributionInfo'

export function InfoButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Om källa och mandatberäkning"
        title="Om källa och mandatberäkning"
        className="flex shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-900/90 p-2 text-slate-300"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
      </button>
      {open &&
        createPortal(
          // Portal till document.body: headern har backdrop-blur, vilket skapar ett nytt
          // "containing block" för position:fixed-barn (samma effekt som transform/filter)
          // — utan portalen kapas overlayn till headerns egen ruta och hamnar under kartan.
          <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-16"
            onClick={() => setOpen(false)}
          >
            <div
              role="dialog"
              aria-label="Om källa och mandatberäkning"
              className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <AttributionInfo />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Stäng"
                  className="shrink-0 rounded text-slate-400 hover:text-slate-100"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
