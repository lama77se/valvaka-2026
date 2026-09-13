import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'

// maplibre-gl v6 beräknar sin worker-URL i RUNTIME (import.meta.url + en villkorlig
// filsträng) i stället för ett statiskt `new URL('./literal.mjs', import.meta.url)`
// som Rollup kan analysera → workern buntas ALDRIG in i produktionsbygget, och kartan
// blir tyst tom (se PR #111/#112). Filnamnet self är statiskt ("maplibre-gl-worker.mjs"
// utanför -dev-läge) — bara katalogen varierar med var vår egen bunt hamnar. Kopiera
// därför workern till samma katalog som våra JS-tillgångar SÅ ATT den runtime-beräknade
// URL:en (samma katalog som den körande bundlen, sibling-fil) faktiskt träffar en fil.
//
// Workerfilen har i sin tur en EGEN statisk import `from "./maplibre-gl-shared.mjs"`
// (delad kod mellan huvudtråd och worker). Huvudtrådens maplibre-gl.mjs importerar
// samma fil men den bakas in i vår Rollup-bunt (statisk import, syns av bundlern) —
// workerfilen kopieras dock RÅ (oprocesserad) och behåller sin relativa import, som
// webbläsarens ES-modul-loader löser mot en RIKTIG fil bredvid workern. Utan den
// fångar `vite preview`s SPA-fallback (allt okänt → index.html, 200) upp anropet och
// workern kraschar tyst på att parsa HTML som JS (upptäckt via en Worker-proxy som
// loggade error-events — annars syns INGET fel i huvudtrådens konsol).
function copyMaplibreWorker(): Plugin {
  return {
    name: 'copy-maplibre-worker',
    apply: 'build',
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist', 'assets')
      mkdirSync(outDir, { recursive: true })
      for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
        copyFileSync(
          path.resolve(__dirname, 'node_modules/maplibre-gl/dist', file),
          path.join(outDir, file),
        )
      }
    },
  }
}

// Klientdetektering av ny deploy (VersionWatcher.tsx) — INTE PWA/service worker
// (medvetet valbort: onödig komplexitet/offline-cachingrisk för ett rent "ny version →
// ladda om"-behov). Skriver en liten dist/version.json vid VARJE build; klienten sparar
// sitt EGET `v`-värde vid mount och pollar filen — vid mismatch, ladda om (jittrat,
// synlighets-gated, se VersionWatcher.tsx). VERCEL_GIT_COMMIT_SHA finns automatiskt i
// Vercels byggmiljö (unikt per deploy) — Date.now() som lokal-build-fallback (samma fil
// byggd två gånger i rad ska ändå skilja sig).
function writeVersionFile(): Plugin {
  return {
    name: 'write-version-file',
    apply: 'build',
    closeBundle() {
      const v = process.env.VERCEL_GIT_COMMIT_SHA ?? String(Date.now())
      mkdirSync(path.resolve(__dirname, 'dist'), { recursive: true })
      writeFileSync(path.resolve(__dirname, 'dist', 'version.json'), JSON.stringify({ v }))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), copyMaplibreWorker(), writeVersionFile()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Fast egen port så dev-servern aldrig krockar med andra projekt under c:\dev.
    // strictPort => faila hellre högt än att glida över på en annan ledig port.
    port: 5926,
    strictPort: true,
  },
  optimizeDeps: {
    // Samma dynamiska worker-URL (se copyMaplibreWorker ovan) gör att Vites dev-
    // dep-optimizer inte hittar workern om paketet pre-buntas (404 på
    // .vite/deps/maplibre-gl-worker.mjs) — undanta det så dev-servern serverar
    // maplibre-gl orört och relativa worker-fetchen träffar den riktiga filen.
    exclude: ['maplibre-gl'],
  },
})
