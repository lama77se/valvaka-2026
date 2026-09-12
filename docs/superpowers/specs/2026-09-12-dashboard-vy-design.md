# Dashboard-vy: fyra oberoende resultatrutor (desktop only)

Handover från Val ANALYSIS-sessionen, 2026-09-12. Storlek: stor (flera dagars arbete
enligt handover). Ingen ny data-infrastruktur — all data är redan globalt laddad
(alla tre valtypers snapshots är alltid mounted via de tre avgångstavlorna i
`DesktopApp`).

## Hårt krav (icke förhandlingsbart)

**NOLL regression i den befintliga karta+panel-vyn.** Den ska fungera EXAKT som idag
efter denna ändring: samma URL-beteende för en-vy-läget, samma `ResultPanel`-
rendering (inkl. Ogiltiga röster + Bryt ner), samma `ValtypSelector`/globala
`selectedArea`. Dashboard är strikt ADDITIVT — ett nytt läge bredvid det gamla, inte
en ombyggnad av det gamla. Verifieras manuellt (Playwright) EFTER implementation:
valtyp-byten, områdesbyten, Bryt ner-tabellen, Ogiltiga röster-blocket,
mandat-visning, URL-delning — allt ska se ut och bete sig identiskt mot `main`.

## Vad

Ett nytt visningsläge, alternativ till dagens karta+panel-yta, BARA på desktop
(`DesktopApp`, `App.tsx`). Ett rutnät med FYRA rutor, var och en helt oberoende:
egen valtyp (Riksdag/Region/Kommun) + eget område, fritt kombinerbara (t.ex. ruta 1
= Riksdag–Riket, ruta 2 = Riksdag–Gävleborg, ruta 3 = Regionval–Gävleborg, ruta 4 =
Kommunval–Hudiksvall).

Varje rutas innehåll = "toppen" av dagens `ResultPanel`, avskuret vid Summa-raden:
valtyp-väljare + områdesväljare (egen instans, rör inte global state) + MandatBars
+ ResultTable utan `invalidVotes`-prop (stannar automatiskt vid Summa,
`ResultTable.tsx` oförändrad). **Ingen breadcrumb, ingen "Bryt ner"-sektion** — varje
ruta har redan en flat områdesväljare för att hoppa vart som helst, och Bryt ner är
explicit utanför scope.

Ett vy-växlare (Karta / Dashboard) är synlig i BÅDA lägena; kartläget är default.

## Utanför scope

Ingen mobilvariant. Rör inte den globala `selectedArea`/`valtyp` som
karta/vanlig panel/highlight-i-tavlorna/"kom ihåg senaste område per
valtyp"-funktionerna använder — dashboardens fyra rutor har sin EGEN,
helt separat state.

## Arkitektur

### Extraktion ur `ResultPanel.tsx` (delas mellan karta-panelen och dashboard-rutorna)

Beslut (godkänt av Lars, se alternativ nedan): **extrahera en delad hook**, inte
duplicera logiken. `ResultPanel.tsx` ändras mekaniskt (samma beteende, verifieras
manuellt) för att anropa den nya hooken/komponenten i stället för sin inline-kod.
Alternativet (duplicera ~90 rader mandat/uppsamlings-logik i en fristående
`AreaSummary`, noll ändrade rader i `ResultPanel.tsx`) övervägdes men avfärdades:
en delad källa förhindrar att en framtida mandat-bugfix av misstag bara träffar
den ena vyn.

Nya/ändrade filer:

1. **`src/lib/areaSelect.ts`** (ny) — flyttar ut `LEVELS`, `PROMPT` (idag
   `ResultPanel.tsx:46-51`) samt en ren funktion `areaFromSelectValue(valtyp, raw):
   Area | null` extraherad ur `<select>`:ens `onChange` (idag inline,
   `ResultPanel.tsx:422-433`; `null` = "distrikt-värde, ignorera" — samma tidiga
   `return` som idag). Ingen beteendeändring, bara flytt.

2. **`src/components/AreaSelect.tsx`** (ny) — wrapper runt `<select>`-JSX:en
   (idag `ResultPanel.tsx:419-476`), prop-signatur `{ valtyp, area, onChange }`.
   Hämtar `kommuner`/`regioner`/`valkretsar`/`areaIndexRef` m.fl. själv via
   `useResults()` (global referensdata, samma för alla instanser — bara
   `valtyp`/`area`/`onChange` är instans-specifikt). Innehåller även
   `regionerRF`-filtret och `valkretsarForSelect`-sorteringen (idag
   `ResultPanel.tsx:233, 245-248`).

3. **`src/components/useAreaView.ts`** (ny hook) — `useAreaView(valtyp, area)`
   returnerar `{ display, giltiga, totalMandat, totalMandat2022, has2022,
   reported, total, turnout, turnoutTitle, invalidVotes, blocks, showMandat,
   areaName, pct, statusTag }`. Kroppen = dagens `view`-useMemo
   (`ResultPanel.tsx:151-224`) + `blocks`/`showMandat`/`areaName`/`pct`/
   `statusTag`-beräkningarna (95-96, 128-149, 226), parametriserad på
   `valtyp`/`area` i stället för att läsa `valtyp`/`selectedArea` direkt ur
   context. Övriga beroenden (`storesRef`, `allCodesRef`, `metaRef`,
   `uppsamlingRef`, `groupsRef`, `areaIndexRef`, `partyRef`, `district2022Ref`,
   `comparisonRef`, `turnoutStoresRef`, `revision`, `kommuner`, `regioner`,
   `valkretsar`, `distriktNamnRef`) är globala och hämtas via `useResults()`
   inuti hooken precis som idag.

4. **`ResultPanel.tsx`** — byter ut sin inline `view`-useMemo + `blocks`/
   `showMandat`/`areaName`/`pct`/`statusTag`-block mot ETT anrop:
   `const av = useAreaView(valtyp, selectedArea)`, och sin `<select>`-JSX mot
   `<AreaSelect valtyp={valtyp} area={selectedArea} onChange={setSelectedArea} />`.
   Breadcrumb, "Bryt ner", RD-riksnivå-noten, `isPrompt`-grenen: OFÖRÄNDRADE
   (läser bara `av.*` i stället för lokala variabler).

5. **`ValtypSelector.tsx`** — lägg till valfria `value`/`onChange`-props:
   `{ className, fill, showColorMode, value, onChange }`. När `value`/`onChange`
   utelämnas (de två BEFINTLIGA anropsplatserna, `DistrictMap.tsx:861` och
   `MobileChrome.tsx:178`): identiskt beteende, fallback till
   `useResults().valtyp`/`setValtyp`. `showColorMode` används INTE av
   dashboard-rutorna (ingen karta där → ingen färgläges-relevans).

6. **`src/components/AreaSummary.tsx`** (ny) — en rutas fulla innehåll:
   `ValtypSelector` (med lokala `value`/`onChange`) + `AreaSelect` + `useAreaView`
   + `MandatBars` (`compact`, smalare kolumn i rutnätet) + `ResultTable` (INGEN
   `invalidVotes`-prop) + RD-riksnivå-noten + `isPrompt`-meddelandet. Props:
   `{ valtyp, area, onValtypChange, onAreaChange }` — helt kontrollerad
   (state bor i `ResultsProvider`, se nedan).

7. **`src/components/DashboardGrid.tsx`** (ny) — responsivt 2×2-rutnät, en
   `AreaSummary` per ruta, läser/skriver dashboardens fyra-rutors-state via
   `useResults()`.

8. **`ResultsProvider.tsx`** — ny delad state (samma mönster som
   `valtyp`/`selectedArea`, `ResultsProvider.tsx:192-193`):
   - `dashboardBoxes: [{ valtyp: Valtyp; area: Area }, ...]` (fast längd 4) +
     `setDashboardBox(i, patch)`.
   - `view: 'karta' | 'dashboard'` + `setView`.
   - Initieras ur URL (se nedan) i samma `useState(() => readViewFromUrl()...)`-
     mönster; skrivs tillbaka i samma `useEffect` som redan kör
     `window.history.replaceState` (`ResultsProvider.tsx:206-210`), utökad att
     även bygga dashboard-query-strängen.

9. **App.tsx (`DesktopApp`)** — ny alltid-synlig smal header-bar (`top-0 right-0`,
   bredd `--panel-w`, ~44px hög) med Karta/Dashboard-togglen (samma pill-stil som
   `ValtypSelector`). Kartläget: `<aside>` flyttas ner samma höjd
   (`top-11 h-[calc(100%-2.75rem)]` i stället för `top-0 h-full`) — `ResultPanel`
   själv rörs inte. Dashboard-läget: `<DistrictMap/>` + `<aside>` ersätts av
   `<DashboardGrid/>`, som fyller ytan under headern.

### URL-schema (additivt, `ResultsProvider.tsx:82-110`)

- `?vy=dashboard` — närvarande BARA i dashboard-läge; frånvarande (default) =
  kartläge, exakt som idag (`val=`/`omrade=` oförändrade, alltid skrivna precis
  som nu).
- `p1=RD&a1=riket&p2=RD&a2=region:21&p3=RF&a3=region:21&p4=KF&a4=kommun:2104` —
  bara skrivna när `vy=dashboard`; samma `level:code`-format som `omrade=`
  (återanvänder `parseAreaParam`/motsvarande skrivlogik). Saknas ett `pN`/`aN`-
  par (t.ex. första besöket) → den rutan defaultar till RD/Riket.
- Existerande en-vy-URL:er (`?val=KF&omrade=kommun:1488`) fortsätter fungera
  identiskt oavsett `vy=` — de styr fortfarande bara den GLOBALA
  `valtyp`/`selectedArea` som kartläget (och avgångstavlornas highlight, och
  "kom ihåg senaste område"-funktionen) använder.

### Default dashboard-state (första besöket, inga `pN`/`aN`-parametrar)

Alla fyra rutor → RD/Riket. Enklast, minst överraskande; användaren anpassar från
där, sedan tar sessionminnet + URL:en över (samma `[]`-state-i-`ResultsProvider`-
mönster som gör att en full omladdning av sidan återställer exakt samma fyra
rutor via URL:en).

## Testplan

1. **Regression, kartläge** (Playwright, samma mönster som tidigare features i
   denna session): valtyp-byten RD/RF/KF, områdesbyten (kommun/region/valkrets/
   distrikt), Bryt ner-tabellen (klick, sortering), Ogiltiga röster-blocket,
   mandat-visning (MandatBars + soffa-block), URL-delning
   (`readViewFromUrl`/`viewToSearch` runt-trip) — jämförs mot beteendet på
   `main` FÖRE ändringen (samma test-sekvens körd på båda, diffa resultatet).
2. **Dashboard, ny funktionalitet**: fyra rutor oberoende valtyp+område,
   sessionminne (toggla Karta→Dashboard→Karta ska inte nollställa något i
   någotdera läget), URL round-trip för `vy=dashboard&p1..a4`, tom-ruta-läge
   (RF/KF utan valt organ), ResultTable stannar vid Summa (inga Ogiltiga
   röster/Bryt ner i rutorna).
3. `tsc --noEmit`, `npm run lint`, `npm run build` gröna.
4. Visuell koll vid brytpunktens ytterlägen (1280×700, 1536×750) i båda lägena.

## Leveransplan (två PR:ar, för att hålla risken låg)

Givet det hårda nollregression-kravet levereras detta som TVÅ separata PR:ar
i stället för en enda stor:

1. **PR 1 — ren refaktor, inget nytt synligt beteende.** Punkterna 1-5 ovan
   (`areaSelect.ts`, `AreaSelect.tsx`, `useAreaView.ts`, `ResultPanel.tsx`
   omskriven att använda dem, `ValtypSelector.tsx`s nya valfria props). Testplan
   = enbart punkt 1 (regression) ovan. Mergas och verifieras i prod FÖRE PR 2
   påbörjas — minsta möjliga diff att felsöka om något går fel.
2. **PR 2 — själva Dashboard-featuren.** Punkterna 6-9 + URL-schemat, byggd
   ovanpå det redan mergade och verifierade PR 1. Testplan = punkt 2-4 ovan.

## Dokumentation

`CLAUDE.md` och `README.md` uppdateras som en del av leveransen (inte en
eftertanke) så de träffande beskriver den nya strukturen/featuren när PR:en är
klar: nya filer under "Kärnprincip"/arkitektur-avsnitten om relevant,
Dashboard-vyn nämnd i README:ns funktionslista/skärmdumpsbeskrivning om en sådan
finns. Ingen ny fristående doc behövs utöver detta spec-dokument (arkitekturen
i sig hör hemma här, inte upprepad i CLAUDE.md).

## Öppna, medvetna antaganden (flaggade för Lars, inte blockerande)

- Ingen breadcrumb i dashboard-rutorna (se "Vad" ovan).
- MandatBars körs alltid med `compact` i dashboard-rutorna (smalare kolumn än
  hela panelen).
- Vy-växlaren ligger i en ny, alltid synlig header-bar ovanför både karta-asiden
  och dashboard-rutnätet, i stället för instansierad separat i vardera läget.
