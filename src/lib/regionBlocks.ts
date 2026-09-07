// Sittande regionstyre mot opposition, PER REGION — till skillnad från riksblocken
// (soffa.ts) är detta INTE ideologiskt symmetriskt: flera regioner styrs av kombinationer
// som inte finns nationellt (t.ex. S+M tillsammans), och styret är ibland en minoritet.
// Manuellt curerad — val.se ger bara röster/mandat, aldrig vem som styr. Nycklas på
// länskod (regionens `selectedArea.code`, samma 2 siffror som valdistriktskodens prefix).
// Gotland ("09") saknas MEDVETET — Region Gotland har inget eget regionval
// (kommunfullmäktige dubblar som regionfullmäktige), så RF/region-vyn finns aldrig dit.
//
// Bas-källa: svenska Wikipedias "Lista över kommun- och regionstyren i Sverige 2022–2026".
// ⚠️ EN FÖRSTA BULK-EXTRAKTION UR DEN SIDAN (via ett automatiskt sammanfattningssteg)
// VISADE SIG OPÅLITLIG — minst 4 av de först nedtecknade styrena var rena felaktigheter
// (fabricerade partikombinationer, t.ex. "S+M" för regioner där S/M inte ens satt i
// styret), upptäckt bara genom att användaren själv kontrollerade enskilda rader mot
// källan. Status 2026-09-07: SAMTLIGA 20 regioner nu kors-verifierade — antingen mot en
// OBEROENDE källa (SVT/lokalpress/partisajt) eller mot användarens egen direktläsning av
// wikipedia-tabellen (inte en sammanfattning; se kommentar per rad). De sista sex
// (Stockholm, Dalarna, Gävleborg, Västernorrland, Västerbotten, Norrbotten) stod kvar
// från den opålitliga första bulk-extraktionen ända till nu — och två av dem (Västernorrland,
// Västerbotten) visade sig FAKTISKT vara fel (samma extraktionsfel som Östergötland/VGR/
// Örebro/Västmanland tidigare), korrigerade 2026-09-07. Detta bekräftar att den ursprungliga
// varningen var befogad hela vägen — anta ALDRIG att en outnyttjad post från det första
// passet är korrekt bara för att den "ser rimlig ut".
// Alla lokala partiers `forkortning` är dessutom verifierade mot den skarpa `party`-
// tabellen (Wikipedias förkortning matchar inte alltid stavning/gemener/versaler där).
// Styret kan dessutom bytas UNDER mandatperioden (Blekinge, Kronoberg, Uppsala och Örebro
// har redan gjort det minst en gång sedan valet 2022) — dubbelkolla ALLA rader nära valet
// 2026, och lägg bara till en ny region här när styret är entydigt (annars: utelämna →
// blockvyn visas helt enkelt inte för den regionen).
//
// "NUV.STYRE"/"NUV.OPPOSITION" ("nuvarande") markerar tydligt att indelningen gäller
// DAGSLÄGET (2022–2026), inte ett resultat av eller en prognos för 2026 års val.
// Oppositionens "(X+Y+Z)"-lista får sitt innehåll LIVE i MandatBars (partier med
// mandat > 0 som inte är med i styret) — INTE hårdkodad här. En statisk gissning
// (t.ex. "(S+C+V)") skulle bli fel så fort ett parti som historiskt haft 0 mandat i
// regionen oväntat får ett.
import { STYRE_NOTE, rest, styre, type BlockConfig } from './soffa'

const NOTE = STYRE_NOTE

export const REGION_STYRE_BLOCKS: Record<string, BlockConfig> = {
  '01': { // Stockholm: S+C+MP, minoritet (65/149) — VERIFIERAD mot direkt läsning av
    // wikipedia-tabellen (bekräftat av användaren 2026-09-07).
    a: styre('S+C+MP', ['S', 'C', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '03': { // Uppsala: M+KD+C+L (minoritet) t.o.m. 24 jan 2024 → S+V+C+MP (majoritet) fr.o.m.
    a: styre('S+V+C+MP', ['S', 'V', 'C', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '04': { // Sörmland: M+VåfP+KD+C, minoritet (34/79) — VåfP = Vård för Pengarna, partikod 1122
    a: styre('M+VåfP+KD+C', ['M', 'VåfP', 'KD', 'C']),
    b: rest(),
    note: NOTE,
  },
  '05': { // Östergötland: M+KD+L (35/101) MED STÖD av SD (inte formell medlem) → 51/101 i
    // förtroendeomröstningar, samma mönster som Skåne. S+C+V+MP = uttrycklig opposition.
    // KORRIGERAD 2026-09-07 — ursprunglig research-passets "S+M" var FEL (upptäckt vid
    // användarens egen kontroll); verifierad mot Läkartidningen + SVT (två oberoende
    // artiklar om just detta styre). 2022: S 32, M 22, SD 16, V 9, KD 8, C 6, L 5, MP 3.
    a: styre('M+KD+L', ['M', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '06': { // Jönköping: S+M+VD, majoritet (44/81). VD = Vårddemokraterna, partikod 1355 —
    // bytte namn från "Bevara Akutsjukhusen" (BA) inför 2026, samma parti/politik/plats
    // i styret. Källa: SVT + partiets egen sajt (varddemokraterna.se).
    a: styre('S+M+VD', ['S', 'M', 'VD']),
    b: rest(),
    note: NOTE,
  },
  '07': { // Kronoberg: M+KD+C+L (minoritet) t.o.m. 8 apr 2024 → S+M (majoritet) fr.o.m.
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '08': { // Kalmar: S+C+V, majoritet
    a: styre('S+C+V', ['S', 'C', 'V']),
    b: rest(),
    note: NOTE,
  },
  '10': { // Blekinge: S+KD+C (minoritet, 28/57) t.o.m. 24 maj 2023 → KD bytte sida →
    // SD+M+KD (majoritet, 30/57) fr.o.m. 20 juni 2023. Inga lokala partier i länet.
    // Fullt verifierad mandatfördelning 2022 (SVT + val.se-protokoll): S 21, C 3, V 3.
    a: styre('SD+M+KD', ['SD', 'M', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '12': { // Skåne: M+KD+L, minoritet (50/149) — C avstod medvetet p.g.a. SD:s budgetstöd åt styret.
    a: styre('M+KD+L', ['M', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '13': { // Halland: M+C+KD+L, minoritet
    a: styre('M+C+KD+L', ['M', 'C', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '14': { // Västra Götaland: S+V+MP (minoritet, 68/149) — M INGÅR INTE, sitter i opposition
    // med KD/C/L/SD. KORRIGERAD 2026-09-07 (ursprungligt "S+M" var FEL, samma
    // extraktionsfel som Östergötland). Verifierad mot GP/SVT/VGR:s egen sajt.
    a: styre('S+V+MP', ['S', 'V', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '17': { // Värmland: S+C+V, majoritet
    a: styre('S+C+V', ['S', 'C', 'V']),
    b: rest(),
    note: NOTE,
  },
  '18': { // Örebro: S+KD+C (minoritet, 34/71) t.o.m. dec 2024 → V gick med →
    // S+KD+C+V (majoritet, 40/71) fr.o.m. dec 2024. KORRIGERAD 2026-09-07 (ursprungligt
    // "S+C, majoritet" saknade både KD och V). Källa: sv.wikipedia.org-tabellen, läst
    // direkt (radens egna två källhänvisningar, inte en sammanfattning).
    a: styre('S+KD+C+V', ['S', 'KD', 'C', 'V']),
    b: rest(),
    note: NOTE,
  },
  '19': { // Västmanland: M+KD+L (26/77) MED teknisk valsamverkan med SD (14) → 40/77.
    // KORRIGERAD 2026-09-07 — ursprungligt "S+M" var HELT FEL (S är INTE med i styret;
    // S sitter i opposition med 26 mandat). Verifierad mot Läkartidningen + SVT.
    a: styre('M+KD+L', ['M', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '20': { // Dalarna: S+C+KD+DSP, majoritet (47/83) — VERIFIERAD mot direkt läsning av
    // wikipedia-tabellen (bekräftat av användaren 2026-09-07). DSP = Dalarnas
    // Sjukvårdsparti, partikod 0472, OBS gemener i skarpa datan ("dsp"), inte versaler.
    a: styre('S+C+KD+DSP', ['S', 'C', 'KD', 'dsp']),
    b: rest(),
    note: NOTE,
  },
  '21': { // Gävleborg: M+SD+KD+SJPG, majoritet (38/75) — VERIFIERAD mot direkt läsning av
    // wikipedia-tabellen (bekräftat av användaren 2026-09-07). SJPG = Sjukvårdspartiet
    // Gävleborg, partikod 0249
    a: styre('M+SD+KD+SJPG', ['M', 'SD', 'KD', 'SJPG']),
    b: rest(),
    note: NOTE,
  },
  '22': { // Västernorrland: S+M+C, majoritet (39/71) — KORRIGERAD 2026-09-07 (ursprungligt
    // "S+C" saknade M) mot direkt läsning av wikipedia-tabellen, bekräftat av användaren.
    a: styre('S+M+C', ['S', 'M', 'C']),
    b: rest(),
    note: NOTE,
  },
  '23': { // Jämtland Härjedalen: S+KD+V, majoritet
    a: styre('S+KD+V', ['S', 'KD', 'V']),
    b: rest(),
    note: NOTE,
  },
  '24': { // Västerbotten: S+V+MP, majoritet (39/71) — KORRIGERAD 2026-09-07 (ursprungligt
    // "S+C" var HELT FEL — C är inte ens med, V+MP är de riktiga partnerna) mot direkt
    // läsning av wikipedia-tabellen, bekräftat av användaren.
    a: styre('S+V+MP', ['S', 'V', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '25': { // Norrbotten: S+V+C, majoritet (42/71) — VERIFIERAD mot direkt läsning av
    // wikipedia-tabellen (bekräftat av användaren 2026-09-07).
    a: styre('S+V+C', ['S', 'V', 'C']),
    b: rest(),
    note: NOTE,
  },
}
