// Sittande kommunstyre mot opposition, PER KOMMUN — samma mönster som regionBlocks.ts
// (styre är en explicit partilista, oppositionen är `'rest'` = allt annat, beräknat LIVE
// i MandatBars). KLART 2026-09-07: SAMTLIGA 290 kommuner ifyllda (ett per land, se
// per-läns "Status"-block nedan för källa/verifiering per kommun). Byggdes upp länsvis
// EN KOMMUN I TAGET i stället för en bulk-extraktion av hela Wikipedia-sidan på en gång
// — en första bulk-extraktion på regionsidan (se ⚠️-varningen överst i regionBlocks.ts)
// hade ~40 % fel, och samma misstag hade upprepats i mycket större skala över 290
// kommuner. Varje kommun är kors-verifierad mot minst en oberoende källa
// (SVT/lokalpress/kommunens egen sajt) eller en direkt läsning av wikipedia-tabellens
// rad (inte en sammanfattning) innan den lades till. Kommunstyren kan ändå ändras UNDER
// resten av mandatperioden fram till valet 2026 — dubbelkolla nära valet om något
// verkar inaktuellt.
//
// Bas-källa (samma sida som regionerna): svenska Wikipedias "Lista över kommun- och
// regionstyren i Sverige 2022–2026". Nycklas på kommunkod (`selectedArea.code` på KF:s
// `kommun`-nivå, 4 siffror — samma kod som `district.kommun`/valdistriktskodens
// mittersta fyra siffror).
//
// Kommuner har ÄNNU FLER lokala engångspartier än regioner (varje kommun kan ha sitt
// eget unika "X-partiet") — verifiera alltid ett lokalt partis exakta `forkortning` mot
// den skarpa `party`-tabellen innan det läggs in här (Wikipedias förkortning matchar
// inte alltid stavning/gemener/versaler där, se t.ex. Dalarnas "dsp" i regionBlocks.ts).
// Kommunstyren byts dessutom minst lika ofta som regionstyren under mandatperioden —
// dubbelkolla nära valet 2026, och lägg bara till en kommun när styret är entydigt
// (annars: utelämna → blockvyn visas helt enkelt inte för den kommunen).
//
// Status 2026-09-07 — Blekinge län, KLART (5/5 kommuner):
//   Kors-verifierade mot oberoende källa (SVT/lokalpress/kommunens egen sajt), stabila
//   sedan 2022 (inga rapporterade maktskiften): Olofström (1060), Karlskrona (1080),
//   Karlshamn (1082), Sölvesborg (1083).
//   Ronneby (1081): M bröt med SD/KD/L och bildade tillfälligt styre med S i april 2024,
//   men Kammarrätten i Jönköping ogiltigförklarade det maktskiftet → det URSPRUNGLIGA
//   styret ("Samling för Ronneby", M+L+KD+SD) gäller.
//
// Status 2026-09-07 — Dalarnas län, KLART (15/15 kommuner). Kommunkod-namn hämtade
// DIREKT ur `district`-tabellen (inte gissade SCB-koder — de stämde INTE, t.ex. är 2080
// Falun och inte Avesta). Alla kors-verifierade mot oberoende källa. Två har ett mid-
// mandatperiod-byte: Hedemora (S+M+MP 2022 → sprack aug 2024 → S+C+KLH+V sep 2025) och
// Mora (Moraalliansen C+M+KD+Morapartiet 2022 → Morapartiet kastades ut apr 2024 →
// C+M+KD, nu MINORITET). Se kommentar per rad för mandattal.
//
// Status 2026-09-07 — Gotland (0980): den ENDA kommun som inte finns i REGION_STYRE_
// BLOCKS (Region Gotlands fullmäktige ÄR kommunfullmäktige, se regionBlocks.ts) hör
// hemma här i stället. Kors-verifierad mot flera oberoende källor.
//
// Status 2026-09-07 — Gävleborgs län, KLART (10/10 kommuner). Två har haft flera
// styresbyten på kort tid, båda bekräftade av användaren mot senaste läget:
//   Hofors (2104): S+C+L (2022) → S+L+V+KD (juni 2024) → KD lämnade (juni 2026) →
//     S+V+L. Mandattal för den nuvarande kombinationen INTE bekräftat — majoritet/
//     minoritet avgörs av den faktiska 2026-summan. Hoforspartiet (HOP, partikod 1215,
//     verifierat) är INTE med i styret.
//   Ljusdal (2161): S+M+L+KD (2022) → "Framtid Ljusdal" M+SD+KD+LjP+L (utan S) →
//     sprack över skolfrågan → S+M+V+KD (2025). LjP (Ljusdalsbygdens parti, partikod
//     0535, forkortning "LjP") är INTE med i det nuvarande styret.
//
// Status 2026-09-07 — Hallands län, KLART (6/6 kommuner). Hylte: "Framtid Hylte"
// S+L+V+KV, MINORITET (19/41) — KV = Kommunens Väl, partikod 0040, forkortning "KV"
// (skarp data, bekräftat).
//
// Status 2026-09-07 — Jämtlands län, KLART (8/8 kommuner). Åre: VV = Västjämtlands Väl
// (partikod 0982, forkortning "VV", verifierat) är med i styret. Ragunda: S+C (apr 2024,
// majoritet) → spruckit igen över skolfrågan → S ENSAMT i minoritet (bekräftat av
// användaren jan 2026) — AfR (Allt för Ragunda, partikod 0497, forkortning "AfR",
// verifierat) är INTE med i styret. Krokom: samma S+M+KD som 2022, men numera MINORITET
// sedan en ledamot blev politisk vilde (bekräftat av användaren) — partisammansättningen
// i styret är oförändrad, bara mandatläget.
//
// Status 2026-09-07 — Jönköpings län, KLART (13/13 kommuner). Två lokala partier
// verifierade mot skarp data: Gislaved WeP (Westbopartiet, partikod 1335) och Vetlanda VF
// (Vetlanda framåtanda, partikod 0993 — obs att en ANNAN lokal "Vår Framtid" på annan ort
// delar samma forkortning "VF"; ofarligt eftersom matchningen sker inom respektive
// kommuns eget district-scope). Tre kommuner har stödpartier UTANFÖR styret som krävs
// för praktisk majoritet men inte räknas som medlemmar: Jönköping (MP+V stödjer S+C+L),
// Nässjö (SAFE+MP stödjer S+KD+C+V) och Tranås (SD stödjer M+KD+L) — alla tre visas
// alltså korrekt som MINORITET i appen trots att de "styr".
//
// Status 2026-09-07 — Kalmar län, KLART (12/12 kommuner). Västerviks lokala parti hette i
// SVT:s EGEN artikeltext "VDM" men har forkortning "WP" (Westerwikspartiet, partikod
// 0027) i den skarpa `party`-tabellen — "VDM" hade INTE matchat något; ett konkret exempel
// på varför varje lokalt parti verifieras mot skarp data i stället för mot en nyhetsartikels
// eget informella förkortning. Torsås S+C+M+V är en riktig, ovanlig fyrpartikombination
// (bekräftad av användaren). Mörbylånga bytte S+V+C → S+M vid årsskiftet 2023/2024
// (bekräftat av användaren). Emmaboda är ett special­fall: C+M+KD styr genom en
// "borgfredsuppgörelse" trots att de bara har 17 av 41 mandat (lika många som S+V+MP) —
// visas alltså korrekt som MINORITET.
//
// Status 2026-09-07 — Kronobergs län, KLART (8/8 kommuner). Uppvidinge: SD+C+KD+LPo
// (2022, minoritet) → LPo lämnade jan 2024 → maktskifte sep 2024 → S+M+V+LPo (bekräftat
// av användaren) — LPo = Landsbygdspartiet Oberoende, partikod 1011, forkortning "LPo"
// (verifierat), samma parti i båda konstellationerna. Tre kommuner (Alvesta, Älmhult,
// Växjö) har V eller C som teknisk valsamverkan-stödpartner UTANFÖR styret, inte medlem.
//
// Status 2026-09-07 — Norrbottens län, KLART (14/14 kommuner). "NS" (Boden, Haparanda,
// Pajala) är det GAMLA namnet/förkortningen för "Norrbottens sjukvårdsparti" — partiet
// bytte namn till bara "Sjukvårdspartiet" 2017 och heter så i den skarpa `party`-tabellen
// (partikod 0193, forkortning "SJV"). "NS" hade INTE matchat — ett tydligt exempel på
// varför lokala partiers kod alltid verifieras mot skarp data, inte mot ett historiskt/
// vardagligt smeknamn. Jokkmokks SV (Samernas Väl, 0080) och Kirunas SL (Sámelistu,
// 1073) är olika partier trots liknande syfte. Kirunas FI (Feministiskt initiativ)
// saknas helt i party-tabellen eftersom de BEKRÄFTAT inte ställer upp i Kirunas 2026-val
// (två ledande lokala företrädare gick över till S) — inkluderad ändå i configen som en
// beskrivning av det SITTANDE styret 2022–2026, bidrar bara med 0 mandat i praktiken.
// Älvsbyalliansen (M+SD+KD+L, INTE C trots namnet) är en minoritet (12/31).
//
// Status 2026-09-07 — Skåne län, KLART (33/33 kommuner). Lokala partier verifierade mot
// skarp data: Svedala BAP (BARAPARTIET, 1310), Perstorp PF (Perstorps Framtid, 0971),
// Klippan VF (Vår Framtid i Klippan, 1393 — inte samma "VF" som Jönköpings Vetlanda-
// parti, disambiguerat på district-scope). Hässleholm: SD (2022) → S+M (maj 2023,
// bekräftat av användaren) → MINORITET (L uteslöts apr 2025). Osby: C+M+KD (2022) → C
// ENSAMT i minoritet (bekräftat av användaren). Klippan är SÄRSKILT FRAGIL — KD+VF (plus
// två individuella moderater som INTE räknas som M-partiet, enligt användarens
// instruktion) tappade sin mandatmajoritet till oppositionen hösten 2024 (17 mot 18) —
// dubbelkolla nära valet 2026, situationen kan ha ändrats ytterligare. Flest minoritets-
// styren av alla län hittills (10 av 33) — SD ingår i styret i 9 kommuner.
//
// Status 2026-09-07 — Södermanlands län, KLART (9/9 kommuner). Inga lokala partier i
// något styre denna gång — bara de 8 riksdagspartierna, ingen party-tabell-verifiering
// behövdes. Eskilstuna är extra färsk (M-avhopp mars 2026, ny majoritet strax därefter)
// — dubbelkolla nära valet 2026.
//
// Status 2026-09-07 — Uppsala län, KLART (8/8 kommuner). Tierp bekräftad av användaren
// (C+M+KD+L) efter att inget oberoende sökpass kunde fastställa det. Lokala partier
// verifierade mot skarp data: Håbos "Samverkan Håbo" (M+S+C+KD, fr.o.m. nov 2024,
// kommunens första majoritet på tio år), Knivsta KNU (Knivsta.Nu, 0303), Östhammar BoA
// (Lokalpartiet BoA — blandad versalisering, INTE "Boa", 0667). Enköping: den
// ursprungliga 2022-alliansen M+NE+C+KD+MP+L (NE = Nystart Enköping, 1143) tappade NE 27
// jan 2025 — nuvarande styre M+C+KD+MP+L är MINORITET utan NE:s mandat. Älvkarlebys KV
// (Kommunens Väl, 0040) delar partikod med Hyltes likanamnade lista i Hallands län —
// ofarligt (district-scopat), men värt att känna till.
//
// Status 2026-09-07 — Stockholms län, KLART (26/26 kommuner). Efter att ett research-
// pass tog slut på sökbudget och föll tillbaka på en opålitlig WebFetch-extraktion,
// klargjorde användaren de flesta återstående kommunerna genom att klistra in RÅA rader
// (med källhänvisningsnummer) direkt ur wikipedia-tabellen — mest tillförlitliga metoden
// hittills, bättre än både sammanfattad WebFetch och enskild WebSearch-syntes. Fyra
// lokala partiers kod skilde sig från den tryckta wikipedia-förkortningen/användarens
// gissning, alla verifierade mot skarp data: Salem "RP" → egentligen "R"
// (Rönningepartiet, 1080); Sigtuna "SfS" → egentligen "SFS" (versaler, Sigtunapartiet
// Samling för Sigtuna, 0009). TuP (Tullingepartiet, 0711), VB (Väsbys Bästa, 1154), HP
// (Huddingepartiet, 0028 — flera andra "HP"-lokalpartier finns nationellt men district-
// scopet gör matchningen säker), LP (Lidingöpartiet, 0019) och NP (Nykvarnspartiet, 0123)
// matchade exakt som skrivna. Flera kommuner (Upplands-Bro, Österåker) har ett annat
// sätestal i 2022 års wikipedia-tabell än i SEAT_CONFIG_2026 — normal periodisk
// mandatomräkning, påverkar inte partisammansättningen som lagras här.
// Status 2026-09-07 — Värmlands län, KLART (16/16 kommuner). Hela tabellen kom direkt från
// användarens klistrade wikipedia-rader (med källhänvisningsnummer) — samma tillförlitliga
// metod som gav Stockholms län. Tre lokala partier verifierade mot skarp data, alla
// matchade exakt som skrivna: HEL (Hela Edas Lista, 0160), OR (Oberoende Realister, 1305 —
// Hagfors styrs HELT av detta enda lokala parti, inget riksdagsparti alls), HS (Hela
// Sunne, 1113). Arvika och Storfors bekräftade av användaren som nyligen bytta
// (Arvika: C lämnade apr 2026; Storfors: S tog över ensamt dec 2022).
// Status 2026-09-07 — Västerbottens län, KLART (15/15 kommuner). Hela tabellen kom direkt
// från användarens klistrade wikipedia-rader. Två lokala partier verifierade: ML
// (Malålistan, partikod 0525) matchade exakt. ÅP (Åsele) matchade INTE något Åsele-parti
// — "ÅP" råkar vara en annan kommuns lokala parti (Åstorpspartiet i Skåne). Rätt parti är
// Åselepartiet, forkortning "ÅSP" (partikod 0185), bekräftat mot både skarp data och en
// oberoende wikipedia-artikel (WebSearch-budgeten var slut, WebFetch användes i stället).
// Status 2026-09-07 — Västernorrlands län, KLART (7/7 kommuner). Härnösand bekräftad
// (S+MP+KD, V lämnade 2023). VSKB (Sollefteå) = Västra Initiativet, partikod 1002,
// forkortning "VSKB" (skarp data, verifierat).
// Status 2026-09-07 — Västmanlands län, KLART (10/10 kommuner). Inga lokala partier.
// Arboga (M+SD+L+KD → S+V+C+MP dec 2025) och Skinnskatteberg (SD ensamt → SD+L+C mars
// 2023) båda bekräftade av användaren mot direkt wikipedia-läsning.
// Status 2026-09-07 — Västra Götalands län, KLART (49/49 kommuner). Sveriges största län
// till antal kommuner. Hela tabellen kom direkt från användarens klistrade wikipedia-rader
// (med källhänvisningsnummer) — samma tillförlitliga metod som Stockholm/Värmland/
// Västerbotten/Västernorrland. Fem lokala partier verifierade mot skarp data, två
// KORRIGERADE mot wikipedians tryckta förkortning: Götene "GF" → egentligen "GÖF"
// (Götenes framtid, 0094); Mellerud "KIM" → egentligen "KiM" (gemener, KommunPartiet
// Mellerud, 0593). Ale FiA (Framtid i Ale, 1158), Svenljunga LPo (Landsbygdspartiet
// Oberoende, 1011 — samma partikod som Kronobergs Uppvidinge, en riksregistrerad lista på
// flera orter), Tidaholm VT (Vi Tidaholm, 1474) och Uddevalla UddP (Uddevallapartiet,
// 1076) matchade exakt som skrivna. Härrydas "SPP" och "KomP" hittar INGEN motsvarighet i
// skarp data — varken som två separata partier eller som det närmast liknande registrerade
// "SPORT- OCH KOMMUNPARTIET" (SOKP, 0546, noll röster i hela riket i denna datamängd) —
// inkluderade ändå (samma princip som Kirunas FI i Norrbotten) eftersom de beskriver det
// SITTANDE styret; bidrar i praktiken med 0 mandat. Åtta kommuner har bytt styre under
// mandatperioden, alla satta till sitt SENASTE läge enligt tabellen: Bengtsfors (→M+C+KD
// sep 2024), Färgelanda (bytt två gånger, → SD+KD sep 2025, S helt ute), Lidköping
// (→S+C+V+MP mars 2025, helt ny konstellation), Lilla Edet (→ +V juni 2023), Lysekil
// (bytt tre gånger, → S+V+MP jan 2026, Lysekilspartiet/LP INTE längre med), Mariestad
// (→M+KD+SD juli 2024, C ersattes av SD), Svenljunga (→M+KD+LPo nov 2023, SD lämnade) och
// Tanum (→M+C+KD sep 2023, L lämnade). Några kommuner (Tanum, Färgelanda, Grästorp, Vara,
// Götene) har ett annat sätestal i 2022 års wikipedia-tabell än i SEAT_CONFIG_2026 —
// normal periodisk mandatomräkning, påverkar inte partisammansättningen som lagras här.
// Status 2026-09-07 — Örebro län, KLART (12/12 kommuner). Två lokala partier verifierade
// mot skarp data, matchade exakt som skrivna: Hällefors GL (Grythyttelistan, partikod
// 1069) och Lekeberg FL (Framtidspartiet i Lekeberg, partikod 0997). Två kommuner har
// bytt styre under mandatperioden: Degerfors (V+M → V+S+M maj 2024 → V+S jan 2026, M
// helt ute nu, bekräftat av användaren) och Lindesberg (M+SD+KD+LPo+L → M+SD+KD+L maj
// 2024, LPo lämnade — LPo har samma partikod 1011 som Kronobergs Uppvidinge och Västra
// Götalands Svenljunga). Hällefors har ett annat sätestal i 2022 års wikipedia-tabell än
// i SEAT_CONFIG_2026 — normal periodisk mandatomräkning.
// Status 2026-09-07 — Östergötlands län, KLART (13/13 kommuner). OBS: `district`-
// tabellens `kommunkod`-fält saknar här den inledande nollan (t.ex. "581" för Norrköping,
// inte "0581") — konfigens nycklar är ändå 4-siffriga med nolla, samma konvention som
// resten av filen och SEAT_CONFIG_2026.KF. Ett lokalt parti verifierat mot skarp data:
// Valdemarsviks LPo (Landsbygdspartiet Oberoende, partikod 1011 — samma parti/kod som
// Kronobergs Uppvidinge, Västra Götalands Svenljunga och Örebros Lindesberg). Norrköping
// bytte helt konstellation i dec 2024 (M+KD+L → S+KD+C+L, bekräftat av användaren).
import { rest, styre, STYRE_NOTE, type BlockConfig } from './soffa'

const NOTE = STYRE_NOTE

export const KOMMUN_STYRE_BLOCKS: Record<string, BlockConfig> = {
  '0980': { // Gotland: S+M, majoritet (36/71) — historiskt första gången S+M styr
    // tillsammans på Gotland ("rödblå majoritet"). Samma unika S+M-kombination som
    // Jönköping (regionBlocks.ts).
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '1060': { // Olofström: S+C, majoritet (25/49)
    a: styre('S+C', ['S', 'C']),
    b: rest(),
    note: NOTE,
  },
  '1080': { // Karlskrona: "Karlskrona-alliansen" SD+M+KD+L, majoritet (41/75)
    a: styre('SD+M+KD+L', ['SD', 'M', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1081': { // Ronneby: "Samling för Ronneby" M+L+KD+SD, majoritet (26/49). M:s tillfälliga
    // maktskifte med S (apr 2024) ogiltigförklarades av Kammarrätten i Jönköping —
    // ursprungsstyret gäller.
    a: styre('M+L+KD+SD', ['M', 'L', 'KD', 'SD']),
    b: rest(),
    note: NOTE,
  },
  '1082': { // Karlshamn: "Karlshamnslaget" M+KD+SD, majoritet (26/51)
    a: styre('M+KD+SD', ['M', 'KD', 'SD']),
    b: rest(),
    note: NOTE,
  },
  '1083': { // Sölvesborg: "Framtid Sölvesborg" S+M+C+SoL, majoritet (24/49) — SoL =
    // SoL-partiet Sölvesborg och Lister, partikod 1257, forkortning "SoL" (skarp data).
    a: styre('S+M+C+SoL', ['S', 'M', 'C', 'SoL']),
    b: rest(),
    note: NOTE,
  },
  '2021': { // Vansbro: S+M, MINORITET (14/31) — V släpper fram styret utan att ingå i det.
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '2023': { // Malung-Sälen: S+M, majoritet (24/39)
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '2026': { // Gagnef: C+S+M, majoritet (21/35)
    a: styre('C+S+M', ['C', 'S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '2029': { // Leksand: M+S+L+C, MINORITET (av 41) — fyrpartistyre utan egen majoritet.
    a: styre('M+S+L+C', ['M', 'S', 'L', 'C']),
    b: rest(),
    note: NOTE,
  },
  '2031': { // Rättvik: C+M+KD, majoritet (av 39)
    a: styre('C+M+KD', ['C', 'M', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '2034': { // Orsa: C+S, majoritet (18/31)
    a: styre('C+S', ['C', 'S']),
    b: rest(),
    note: NOTE,
  },
  '2039': { // Älvdalen: S+C, majoritet (20/35)
    a: styre('S+C', ['S', 'C']),
    b: rest(),
    note: NOTE,
  },
  '2061': { // Smedjebacken: S+V, majoritet (S har egen majoritet på 20/35 men väljer att
    // styra tillsammans med V ändå).
    a: styre('S+V', ['S', 'V']),
    b: rest(),
    note: NOTE,
  },
  '2062': { // Mora: "Moraalliansen" C+M+KD+Morapartiet (2022) → Morapartiet kastades ut
    // april 2024 → C+M+KD, nu MINORITET (16/41). KORRIGERAD/nyanserad efter
    // användarens kommentar — bekräftad mot SVT/kommunens egen sajt.
    a: styre('C+M+KD', ['C', 'M', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '2080': { // Falun: S+M, majoritet (32/61)
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '2081': { // Borlänge: S+M, majoritet (32/61) — historiskt första gången S+M styr
    // tillsammans i Borlänge. Oförändrat sedan 2022 (en äldre S+MP+C+L-rubrik som dök upp
    // vid research gällde föregående mandatperiod 2019–2022, inte denna).
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '2082': { // Säter: S+C+KD, majoritet (av 35)
    a: styre('S+C+KD', ['S', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '2083': { // Hedemora: S+M+MP (2022) → sprack aug 2024 → NY majoritet 16 sep 2025:
    // S+C+KLH+V, 19/35. KLH = Kommunlistan (Hedemora), partikod 0747, forkortning "KLH"
    // (skarp data — obs att flera olika "Kommunlistan"-lokalpartier finns i olika
    // kommuner, disambiguerade på forkortning).
    a: styre('S+C+KLH+V', ['S', 'C', 'KLH', 'V']),
    b: rest(),
    note: NOTE,
  },
  '2084': { // Avesta: S+C, majoritet
    a: styre('S+C', ['S', 'C']),
    b: rest(),
    note: NOTE,
  },
  '2085': { // Ludvika: S+M+KD, majoritet (26/45)
    a: styre('S+M+KD', ['S', 'M', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '2101': { // Ockelbo: S+C, majoritet (av 31)
    a: styre('S+C', ['S', 'C']),
    b: rest(),
    note: NOTE,
  },
  '2121': { // Ovanåker: S+C, MINORITET — V släpper fram styret utan att ingå i det.
    a: styre('S+C', ['S', 'C']),
    b: rest(),
    note: NOTE,
  },
  '2132': { // Nordanstig: S+M+L, majoritet (16/31)
    a: styre('S+M+L', ['S', 'M', 'L']),
    b: rest(),
    note: NOTE,
  },
  '2180': { // Gävle: S+MP+L+KD+C, majoritet (av 65) — L "vågmästare". Fr.o.m. 1 jan 2023.
    a: styre('S+MP+L+KD+C', ['S', 'MP', 'L', 'KD', 'C']),
    b: rest(),
    note: NOTE,
  },
  '2181': { // Sandviken: S+C+L, majoritet (26/51)
    a: styre('S+C+L', ['S', 'C', 'L']),
    b: rest(),
    note: NOTE,
  },
  '2182': { // Söderhamn: "Alliansen" C+M+KD+L, MINORITET (20/49)
    a: styre('C+M+KD+L', ['C', 'M', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '2183': { // Bollnäs: S+M+C, majoritet (24/45)
    a: styre('S+M+C', ['S', 'M', 'C']),
    b: rest(),
    note: NOTE,
  },
  '2104': { // Hofors: S+C+L (2022, C+V stöd utanför) → S+L+V+KD (juni 2024, "ovanlig
    // konstellation") → S+V+L (KD lämnade, bekräftat av användaren juni 2026). Mandattal
    // för den nuvarande kombinationen INTE bekräftat (flera styresbyten på kort tid) —
    // majoritet/minoritet avgörs alltså av den faktiska 2026-mandatsumman, inte antaget
    // här. Hoforspartiet (HOP, partikod 1215, verifierat) är INTE med i styret.
    a: styre('S+V+L', ['S', 'V', 'L']),
    b: rest(),
    note: NOTE,
  },
  '2184': { // Hudiksvall: S+M+MP, majoritet (av 51)
    a: styre('S+M+MP', ['S', 'M', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '2161': { // Ljusdal: S+M+L+KD (2022, 23/41) → "Framtid Ljusdal" M+SD+KD+LjP+L (utan S)
    // → sprack över skolfrågan → S+M+V+KD (2025, bekräftat av användaren). LjP
    // (Ljusdalsbygdens parti, partikod 0535, forkortning "LjP") är INTE med i det
    // nuvarande styret — hamnar i oppositionen om de har mandat.
    a: styre('S+M+V+KD', ['S', 'M', 'V', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1315': { // Hylte: "Framtid Hylte" S+L+V+KV, MINORITET (19/41). KV = Kommunens Väl,
    // partikod 0040, forkortning "KV" (skarp data, verifierat).
    a: styre('S+L+V+KV', ['S', 'L', 'V', 'KV']),
    b: rest(),
    note: NOTE,
  },
  '1380': { // Halmstad: S+M+KD, majoritet (40/71)
    a: styre('S+M+KD', ['S', 'M', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1381': { // Laholm: C+KD+L+M+S ("blocköverskridande femklöver"), majoritet (av 41)
    a: styre('C+KD+L+M+S', ['C', 'KD', 'L', 'M', 'S']),
    b: rest(),
    note: NOTE,
  },
  '1382': { // Falkenberg: "Framtid Falkenberg" S+KD+L+MP, MINORITET (missade majoritet
    // med en mandat efter omräkning) (av 61)
    a: styre('S+KD+L+MP', ['S', 'KD', 'L', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1383': { // Varberg: "Varberg-alliansen" M+SD+KD+L, majoritet (31/61) — samarbetsavtal
    // med lokala Varbergspartiet (VP) för vissa frågor (t.ex. budget), men VP är INTE
    // en formell styrmedlem (alliansen har egen majoritet utan dem).
    a: styre('M+SD+KD+L', ['M', 'SD', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1384': { // Kungsbacka: "Alliansen" M+C+KD+L, majoritet (av 61) — SD (3:e största
    // partiet) INTE del av styret.
    a: styre('M+C+KD+L', ['M', 'C', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '2305': { // Bräcke: S+C, majoritet (av 27)
    a: styre('S+C', ['S', 'C']),
    b: rest(),
    note: NOTE,
  },
  '2313': { // Strömsund: S+C, majoritet (18/35)
    a: styre('S+C', ['S', 'C']),
    b: rest(),
    note: NOTE,
  },
  '2321': { // Åre: S+V+VV, majoritet (19/37) — VV = Västjämtlands Väl, partikod 0982,
    // forkortning "VV" (skarp data, verifierat).
    a: styre('S+V+VV', ['S', 'V', 'VV']),
    b: rest(),
    note: NOTE,
  },
  '2326': { // Berg: S+C, majoritet (17/31)
    a: styre('S+C', ['S', 'C']),
    b: rest(),
    note: NOTE,
  },
  '2361': { // Härjedalen: S+M+C (blocköverskridande), majoritet (21/31)
    a: styre('S+M+C', ['S', 'M', 'C']),
    b: rest(),
    note: NOTE,
  },
  '2380': { // Östersund: S+C (blocköverskridande), majoritet (32/61)
    a: styre('S+C', ['S', 'C']),
    b: rest(),
    note: NOTE,
  },
  '2303': { // Ragunda: S+C (apr 2024, majoritet) → spruckit igen (skolfrågan) → S ENSAMT,
    // MINORITET (av 25) — bekräftat av användaren jan 2026. AfR (Allt för Ragunda,
    // partikod 0497, forkortning "AfR", verifierat) är INTE med i styret.
    a: styre('S', ['S']),
    b: rest(),
    note: NOTE,
  },
  '2309': { // Krokom: S+M+KD (2022, majoritet) — samma partier gäller fortfarande, men nu
    // MINORITET sedan en ledamot lämnade sitt parti och blev politisk vilde (bekräftat
    // av användaren). Mandattal opåverkat av partisammansättningen (samma tre partier).
    a: styre('S+M+KD', ['S', 'M', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0604': { // Aneby: S+C+KD, majoritet (19/35)
    a: styre('S+C+KD', ['S', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0617': { // Gnosjö: M+KD+C, majoritet (19/35)
    a: styre('M+KD+C', ['M', 'KD', 'C']),
    b: rest(),
    note: NOTE,
  },
  '0642': { // Mullsjö: S+KD+C+L (ovanlig S+KD-kombination), majoritet (16/31)
    a: styre('S+KD+C+L', ['S', 'KD', 'C', 'L']),
    b: rest(),
    note: NOTE,
  },
  '0643': { // Habo: M+KD+C+L, majoritet (av 35) — bekräftat direkt från kommunens egen sajt.
    a: styre('M+KD+C+L', ['M', 'KD', 'C', 'L']),
    b: rest(),
    note: NOTE,
  },
  '0662': { // Gislaved: S+M+WeP+C+L, majoritet (29/49) — WeP = Westbopartiet, partikod
    // 1335, forkortning "WeP" (skarp data, verifierat).
    a: styre('S+M+WeP+C+L', ['S', 'M', 'WeP', 'C', 'L']),
    b: rest(),
    note: NOTE,
  },
  '0665': { // Vaggeryd: S+M, majoritet (av 41)
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '0680': { // Jönköping: S+C+L (blocköverskridande kärna), MINORITET (34/81) — MP+V är
    // stödpartier utanför styret, inte medlemmar (tillsammans 42/81).
    a: styre('S+C+L', ['S', 'C', 'L']),
    b: rest(),
    note: NOTE,
  },
  '0682': { // Nässjö: S+KD+C+V, MINORITET — SAFE (lokalt parti) + MP stödjer utanför
    // styret (tillsammans 31/57).
    a: styre('S+KD+C+V', ['S', 'KD', 'C', 'V']),
    b: rest(),
    note: NOTE,
  },
  '0683': { // Värnamo: "Alliansen" M+C+KD+L, majoritet (26/51) — M störst för första
    // gången, MP åkte ut ur alliansen.
    a: styre('M+C+KD+L', ['M', 'C', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '0684': { // Sävsjö: KD+S+C (ovanlig KD+S-kombination), majoritet (23/39)
    a: styre('KD+S+C', ['KD', 'S', 'C']),
    b: rest(),
    note: NOTE,
  },
  '0685': { // Vetlanda: M+VF+SD, majoritet (24/45) — första gången SD i ett kommunstyre i
    // länet. VF = Vetlanda framåtanda, partikod 0993, forkortning "VF" (skarp data,
    // verifierat — obs att en annan lokal "Vår Framtid" i en annan kommun delar samma
    // forkortning, men district-scopet gör matchningen säker).
    a: styre('M+VF+SD', ['M', 'VF', 'SD']),
    b: rest(),
    note: NOTE,
  },
  '0686': { // Eksjö: S+M, majoritet (av 49) — efter att C och KD försvagades 2022.
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '0687': { // Tranås: M+KD+L (13/41 själva, MINORITET), med stöd av SD (8) → 21/41
    // tillsammans. SD INTE formell styrmedlem.
    a: styre('M+KD+L', ['M', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '0821': { // Högsby: S+C+V (blocköverskridande), majoritet
    a: styre('S+C+V', ['S', 'C', 'V']),
    b: rest(),
    note: NOTE,
  },
  '0834': { // Torsås: S+C+M+V — OVANLIG fyrpartikombination men bekräftad (majoritet,
    // 23/35 i 2022 års mandatfördelning — sätestalet kan skilja mot 2026, partierna gör
    // det inte).
    a: styre('S+C+M+V', ['S', 'C', 'M', 'V']),
    b: rest(),
    note: NOTE,
  },
  '0840': { // Mörbylånga: S+V+C (2022) → "Samverkan för Mörbylånga" S+M fr.o.m.
    // årsskiftet 2023/2024 (bekräftat av användaren). V och C nu i opposition.
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '0860': { // Hultsfred: C+KD+M, majoritet
    a: styre('C+KD+M', ['C', 'KD', 'M']),
    b: rest(),
    note: NOTE,
  },
  '0861': { // Mönsterås: "Alliansen" C+M+KD+L, MINORITET (21/49)
    a: styre('C+M+KD+L', ['C', 'M', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '0862': { // Emmaboda: "Borgfredsuppgörelse" — S+V+MP och C+M+KD fick lika många mandat
    // (17 vardera av 41; SD:s 7 räknas till ingetdera blocket) och kom överens om att de
    // borgerliga (C+M+KD) styr trots att ingen sida har egen majoritet.
    a: styre('C+M+KD', ['C', 'M', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0880': { // Kalmar: S+V+C, majoritet (32/61)
    a: styre('S+V+C', ['S', 'V', 'C']),
    b: rest(),
    note: NOTE,
  },
  '0881': { // Nybro: S+C, majoritet — V stödjer utanför styret (avslutade 8 år av
    // Alliansens minoritetsstyre C+M+KD+L).
    a: styre('S+C', ['S', 'C']),
    b: rest(),
    note: NOTE,
  },
  '0882': { // Oskarshamn: S+M, majoritet (26/49) — styrt tillsammans sedan 2018.
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '0883': { // Västervik: "Westervikskoalitionen" M+KD+L+WP, MINORITET (20/57), med stöd
    // av SD (9) → 29/57 tillsammans. WP = Westerwikspartiet, partikod 0027, forkortning
    // "WP" (skarp data — obs: SVT:s egen artikel skriver "VDM" som informell förkortning,
    // men den skarpa datan har "WP". "VDM" hade INTE matchat).
    a: styre('M+KD+L+WP', ['M', 'KD', 'L', 'WP']),
    b: rest(),
    note: NOTE,
  },
  '0884': { // Vimmerby: S+C+V, majoritet
    a: styre('S+C+V', ['S', 'C', 'V']),
    b: rest(),
    note: NOTE,
  },
  '0885': { // Borgholm: S+V+C (blocköverskridande), majoritet (18 mandat, knapp)
    a: styre('S+V+C', ['S', 'V', 'C']),
    b: rest(),
    note: NOTE,
  },
  '0760': { // Uppvidinge: SD+C+KD+LPo (2022, minoritet) → LPo lämnade jan 2024 →
    // maktskifte sep 2024 → S+M+V+LPo (bekräftat av användaren). LPo = Landsbygdspartiet
    // Oberoende, partikod 1011, forkortning "LPo" (skarp data, verifierat) — samma parti
    // som lämnade det gamla styret och gick med i det nya.
    a: styre('S+M+V+LPo', ['S', 'M', 'V', 'LPo']),
    b: rest(),
    note: NOTE,
  },
  '0761': { // Lessebo: S+C+V, majoritet — samma koalition sedan 2018.
    a: styre('S+C+V', ['S', 'C', 'V']),
    b: rest(),
    note: NOTE,
  },
  '0763': { // Tingsryd: M+C+KD, MINORITET
    a: styre('M+C+KD', ['M', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0764': { // Alvesta: S+C+KD, majoritet — V:s tekniska valsamverkan stödjer utanför
    // styret (KD ersatte V som formell medlem efter 2022).
    a: styre('S+C+KD', ['S', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0765': { // Älmhult: C+S (blocköverskridande), majoritet (21/41) — V:s tekniska
    // valsamverkan stödjer utanför styret, inte medlem.
    a: styre('C+S', ['C', 'S']),
    b: rest(),
    note: NOTE,
  },
  '0767': { // Markaryd: KD+C+M, majoritet
    a: styre('KD+C+M', ['KD', 'C', 'M']),
    b: rest(),
    note: NOTE,
  },
  '0780': { // Växjö: S+V+MP, MINORITET (29/61) — C:s tekniska valsamverkan stödjer
    // utanför styret (tillsammans 32/61).
    a: styre('S+V+MP', ['S', 'V', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '0781': { // Ljungby: "Alliansen" M+C+L+KD, MINORITET — styrt sedan 2007, nu med taktiskt
    // samarbete med S och V utanför styret.
    a: styre('M+C+L+KD', ['M', 'C', 'L', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '2505': { // Arvidsjaur: S+V, majoritet — samma koalition sedan 2014.
    a: styre('S+V', ['S', 'V']),
    b: rest(),
    note: NOTE,
  },
  '2506': { // Arjeplog: S+L, majoritet (11/21) — Folkinitiativet Arjeplog (6 mandat) är
    // ett separat lokalt parti i OPPOSITION, inte med i styret.
    a: styre('S+L', ['S', 'L']),
    b: rest(),
    note: NOTE,
  },
  '2510': { // Jokkmokk: FJK+MP+SV+V, majoritet — FJK = Framtid i Jokkmokks kommun,
    // partikod 1014; SV = Samernas Väl, partikod 0080 (båda skarp data, verifierade).
    a: styre('FJK+MP+SV+V', ['FJK', 'MP', 'SV', 'V']),
    b: rest(),
    note: NOTE,
  },
  '2513': { // Överkalix: S ENSAMT, egen majoritet (51,3 % av rösterna).
    a: styre('S', ['S']),
    b: rest(),
    note: NOTE,
  },
  '2514': { // Kalix: S+MP+C, majoritet — C ersatte V som styrpartner efter 2022 (S+V+MP
    // föregående mandatperiod).
    a: styre('S+MP+C', ['S', 'MP', 'C']),
    b: rest(),
    note: NOTE,
  },
  '2518': { // Övertorneå: C+FrSÖ+KD+V, majoritet — FrSÖ = Framtid S Övertorneå, partikod
    // 1515, forkortning "FrSÖ" (skarp data, verifierat).
    a: styre('C+FrSÖ+KD+V', ['C', 'FrSÖ', 'KD', 'V']),
    b: rest(),
    note: NOTE,
  },
  '2521': { // Pajala: S+KD+SJV, skör majoritet — SJV = Sjukvårdspartiet (lokalt känt som
    // "Norrbottens Sjukvårdsparti (NS)" före namnbytet 2017), partikod 0193, forkortning
    // "SJV" (skarp data — "NS" är det GAMLA namnet/förkortningen och hade INTE matchat).
    // Framtid S, V och M i opposition.
    a: styre('S+KD+SJV', ['S', 'KD', 'SJV']),
    b: rest(),
    note: NOTE,
  },
  '2523': { // Gällivare: S+MP — bekräftat via de två kommunalråden, majoritetsläge ej
    // närmare verifierat (inga tredje styrpartner hittade trots upprepad sökning).
    a: styre('S+MP', ['S', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '2560': { // Älvsbyn: "Älvsbyalliansen" M+SD+KD+L, MINORITET (12/31) — INTE C (trots
    // namnet "alliansen"), bröt 100 år av S-styre. Verifierat mot flera källor.
    a: styre('M+SD+KD+L', ['M', 'SD', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '2580': { // Luleå: "Hållbara Luleå" S+V+MP, majoritet (32/61)
    a: styre('S+V+MP', ['S', 'V', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '2581': { // Piteå: S+C, majoritet
    a: styre('S+C', ['S', 'C']),
    b: rest(),
    note: NOTE,
  },
  '2582': { // Boden: S+SJV, majoritet (24+1=25/49, precis över gränsen) — SJV =
    // Sjukvårdspartiet (se Pajala-kommentaren om "NS"). Aktiv Samling - Bodenalternativet
    // (ASB, partikod 1373) är ett SEPARAT lokalt parti i opposition, INTE samma som SJV.
    a: styre('S+SJV', ['S', 'SJV']),
    b: rest(),
    note: NOTE,
  },
  '2583': { // Haparanda: S+V (2022) → förlorade budgetomröstning juni 2024 → maktskifte →
    // C+KD+M+SD+SJV fr.o.m. sep 2024 (bekräftat av användaren). SJV = Sjukvårdspartiet
    // ("NS"), samma parti/kod som Pajala/Boden.
    a: styre('C+KD+M+SD+SJV', ['C', 'KD', 'M', 'SD', 'SJV']),
    b: rest(),
    note: NOTE,
  },
  '2584': { // Kiruna: S+V+SL+FI, majoritet (27/45) — SL = Sámelistu/Samelistan, partikod
    // 1073 (skarp data, verifierat). FI = Feministiskt initiativ — INTE i vår party-
    // tabell eftersom FI bekräftat INTE ställer upp i Kirunas 2026-val (två ledande
    // lokala FI:are gick över till S) — inkluderad ändå eftersom configen beskriver det
    // SITTANDE styret (2022–2026), inte en prognos; FI bidrar naturligt med 0 mandat i
    // 2026 eftersom de inte finns i den skarpa datan.
    a: styre('S+V+SL+FI', ['S', 'V', 'SL', 'FI']),
    b: rest(),
    note: NOTE,
  },
  '1214': { // Svalöv: SD+M+KD, majoritet (19/35)
    a: styre('SD+M+KD', ['SD', 'M', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1230': { // Staffanstorp: M+SD, majoritet (22/41)
    a: styre('M+SD', ['M', 'SD']),
    b: rest(),
    note: NOTE,
  },
  '1231': { // Burlöv: M+C+L, MINORITET — samma koalition sedan 2018.
    a: styre('M+C+L', ['M', 'C', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1233': { // Vellinge: M ENSAMT, MINORITET — 30 år av egen majoritet slutade 2022 (22/51).
    a: styre('M', ['M']),
    b: rest(),
    note: NOTE,
  },
  '1256': { // Östra Göinge: "Treklövern" M+C+KD, majoritet (17/31)
    a: styre('M+C+KD', ['M', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1257': { // Örkelljunga: SD+M, majoritet (21/37) — SD störst för första gången.
    a: styre('SD+M', ['SD', 'M']),
    b: rest(),
    note: NOTE,
  },
  '1260': { // Bjuv: SD+M, majoritet (18/31)
    a: styre('SD+M', ['SD', 'M']),
    b: rest(),
    note: NOTE,
  },
  '1261': { // Kävlinge: M+SD+KD, majoritet (26/49) — ersatte Alliansen (C+L tappade
    // mandat till lokala Löddebygden).
    a: styre('M+SD+KD', ['M', 'SD', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1262': { // Lomma: "Alliansen" M+L+C+KD, majoritet
    a: styre('M+L+C+KD', ['M', 'L', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1263': { // Svedala: "Femklövern" M+C+KD+BAP+L, MINORITET (18/45) — BAP = BARAPARTIET
    // (lokalt parti kopplat till orten Bara), partikod 1310, forkortning "BAP" (skarp
    // data, verifierat).
    a: styre('M+C+KD+BAP+L', ['M', 'C', 'KD', 'BAP', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1264': { // Skurup: M+SD+KD, majoritet (23/41)
    a: styre('M+SD+KD', ['M', 'SD', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1265': { // Sjöbo: M+S+C+L, MINORITET — MP stödjer utanför styret.
    a: styre('M+S+C+L', ['M', 'S', 'C', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1266': { // Hörby: SD+M, majoritet (16/31)
    a: styre('SD+M', ['SD', 'M']),
    b: rest(),
    note: NOTE,
  },
  '1267': { // Höör: M+L+C+KD, MINORITET (17/41)
    a: styre('M+L+C+KD', ['M', 'L', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1270': { // Tomelilla: M+C+L+KD (2022) → C uteslöts efter interna strider → M+KD+L,
    // MINORITET — blocköverskridande samarbete med S om budget (S INTE formell medlem).
    a: styre('M+KD+L', ['M', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1272': { // Bromölla: S+V, MINORITET
    a: styre('S+V', ['S', 'V']),
    b: rest(),
    note: NOTE,
  },
  '1273': { // Osby: C+M+KD (2022, minoritet) → C ENSAMT i minoritet numera (bekräftat av
    // användaren).
    a: styre('C', ['C']),
    b: rest(),
    note: NOTE,
  },
  '1275': { // Perstorp: S+PF+M+C+KD, majoritet (15/27) — PF = Perstorps Framtid, partikod
    // 0971, forkortning "PF" (skarp data, verifierat).
    a: styre('S+PF+M+C+KD', ['S', 'PF', 'M', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1276': { // Klippan: KD+VF, mycket liten styrka — 12 uteslutna SD-ledamöter ("vildar")
    // gick till lokala partiet Vår Framtid i Klippan (VF, partikod 1393, forkortning
    // "VF", skarp data verifierat) och styr tillsammans med KD och två INDIVIDUELLA
    // moderater (inte M som parti — bekräftat av användaren, "endast KD+VF" som partier).
    // Hösten 2024 fick oppositionen en mandats övertag (18 mot 17) — situationen är
    // FRAGIL/kontrastad, dubbelkolla nära valet.
    a: styre('KD+VF', ['KD', 'VF']),
    b: rest(),
    note: NOTE,
  },
  '1277': { // Åstorp: SD+M+KD, majoritet (18/31)
    a: styre('SD+M+KD', ['SD', 'M', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1278': { // Båstad: "Samverkan för Bjäre" M+S+L+KD, majoritet
    a: styre('M+S+L+KD', ['M', 'S', 'L', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1280': { // Malmö: S+L+MP, majoritet — V utanför trots rödgrön majoritet på pappret
    // (skattetvist).
    a: styre('S+L+MP', ['S', 'L', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1281': { // Lund: S+M+V+KD, majoritet (34/65) — ovanlig blocköverskridande fyrklöver,
    // bekräftat via rubrik "M och S bildar nytt styre med V och KD i Lund".
    a: styre('S+M+V+KD', ['S', 'M', 'V', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1282': { // Landskrona: L+M+MP, majoritet (26/51) — samma koalition sedan 2006.
    a: styre('L+M+MP', ['L', 'M', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1283': { // Helsingborg: M+L+KD, MINORITET — SD stödjer utanför styret.
    a: styre('M+L+KD', ['M', 'L', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1284': { // Höganäs: M+C+KD, majoritet
    a: styre('M+C+KD', ['M', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1285': { // Eslöv: S+M+L (blocköverskridande), majoritet (27/51)
    a: styre('S+M+L', ['S', 'M', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1286': { // Ystad: M+L+KD+SD, majoritet (28/51)
    a: styre('M+L+KD+SD', ['M', 'L', 'KD', 'SD']),
    b: rest(),
    note: NOTE,
  },
  '1287': { // Trelleborg: SD+M+KD+L, majoritet (32/61)
    a: styre('SD+M+KD+L', ['SD', 'M', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1290': { // Kristianstad: M+SD+KD, majoritet (33/65)
    a: styre('M+SD+KD', ['M', 'SD', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1291': { // Simrishamn: M+L+KD, MINORITET (bekräftat av användaren — INTE C, till
    // skillnad från researchpassets ursprungliga "Alliansen M+C+L+KD"-gissning).
    a: styre('M+L+KD', ['M', 'L', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1292': { // Ängelholm: "Alliansen" M+C+KD+L, MINORITET
    a: styre('M+C+KD+L', ['M', 'C', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1293': { // Hässleholm: SD styrde (2022) → maktskifte 10 maj 2023 → S+M tog över
    // (bekräftat av användaren) → MINORITET sedan L uteslöts april 2025.
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '0428': { // Vingåker: M+C+KD, MINORITET — SD stödjer utanför styret, inte medlem. En
    // motstridig SVT-rubrik ("S, C, MP och KD bildar ny majoritet") motsägs av sin egen
    // artikeltext och ignorerades — två oberoende sökningar bekräftar M+C+KD.
    a: styre('M+C+KD', ['M', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0461': { // Gnesta: S+M, MINORITET (18/31)
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '0480': { // Nyköping: S+M, majoritet (35/61) — ersatte föregående S+C+MP.
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '0481': { // Oxelösund: M+SD+KD+L, majoritet — första borgerliga styret på 72 år.
    a: styre('M+SD+KD+L', ['M', 'SD', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '0482': { // Flen: "Samarbete för Flen" S+C (minoritet, 2022) → utökades → S+C+MP+KD,
    // majoritet.
    a: styre('S+C+MP+KD', ['S', 'C', 'MP', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0483': { // Katrineholm: S+M, majoritet (29/51) — fjärde mandatperioden i rad
    // tillsammans.
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '0484': { // Eskilstuna: S+M+C (2022, 39 mandat) → flera M-avhopp mars 2026 → ny
    // majoritet bildad: S+M+C igen (C fick en kommunalrådspost, M ersatte sina två med
    // nya politiker). Mycket färsk (mars/april 2026) — bekräftat via kommunens egen sajt
    // + SVT.
    a: styre('S+M+C', ['S', 'M', 'C']),
    b: rest(),
    note: NOTE,
  },
  '0486': { // Strängnäs: M+S, majoritet (31/55)
    a: styre('M+S', ['M', 'S']),
    b: rest(),
    note: NOTE,
  },
  '0488': { // Trosa: "Allians för Trosa" M+C+L+KD, majoritet — styrt sedan 2006.
    a: styre('M+C+L+KD', ['M', 'C', 'L', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0305': { // Håbo: M+KD+C (m. SD-stöd utanför, 2022) → "Samverkan Håbo" M+S+C+KD,
    // majoritet, fr.o.m. nov 2024 — kommunens FÖRSTA majoritetsstyre på tio år.
    a: styre('M+S+C+KD', ['M', 'S', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0319': { // Älvkarleby: S+C+KV+V+MP, majoritet (17/31) — KV = Kommunens Väl, partikod
    // 0040, forkortning "KV" (skarp data, verifierat). Obs: samma partikod som Hyltes
    // "Kommunens Väl" i Hallands län — sannolikt en riksregistrerad lista som ställer upp
    // på flera orter; district-scopet gör matchningen säker i båda kommunerna oavsett.
    a: styre('S+C+KV+V+MP', ['S', 'C', 'KV', 'V', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '0330': { // Knivsta: KNU+KD, MINORITET (12 mandat) — SD stödjer utanför styret, inte
    // medlem. KNU = Knivsta.Nu, partikod 0303, forkortning "KNU" (skarp data,
    // verifierat).
    a: styre('KNU+KD', ['KNU', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0331': { // Heby: S+C, majoritet — teknisk valsamverkan med V+MP utanför styret, inte
    // medlemmar.
    a: styre('S+C', ['S', 'C']),
    b: rest(),
    note: NOTE,
  },
  '0380': { // Uppsala (kommun): S+V+MP, MINORITET (39/81) — teknisk valsamverkan med
    // lokala Utvecklingspartiet Demokraterna utanför styret, inte medlem.
    a: styre('S+V+MP', ['S', 'V', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '0381': { // Enköping: M+NE+C+KD+MP+L (2022, majoritet 26/51) → NE lämnade samarbetet 27
    // jan 2025 → NUVARANDE styre M+C+KD+MP+L, MINORITET (20/51 utan NE:s 6 mandat). NE =
    // Nystart Enköping, partikod 1143, forkortning "NE" (skarp data, verifierat) — INTE
    // med i det nuvarande styret trots att den ursprungliga 2022-alliansen (som
    // användaren beskrev) hade dem med.
    a: styre('M+C+KD+MP+L', ['M', 'C', 'KD', 'MP', 'L']),
    b: rest(),
    note: NOTE,
  },
  '0382': { // Östhammar: M+SD+KD+BoA, majoritet (27/49) — BoA = Lokalpartiet BoA (blandad
    // versalisering, INTE "Boa"), partikod 0667, forkortning "BoA" (skarp data,
    // verifierat).
    a: styre('M+SD+KD+BoA', ['M', 'SD', 'KD', 'BoA']),
    b: rest(),
    note: NOTE,
  },
  '0114': { // Upplands Väsby: S+VB+L, majoritetskärna (22/51) — teknisk valsamverkan med
    // V utanför styret, inte medlem. VB = Väsbys Bästa, partikod 1154, forkortning "VB"
    // (skarp data, verifierat).
    a: styre('S+VB+L', ['S', 'VB', 'L']),
    b: rest(),
    note: NOTE,
  },
  '0115': { // Vallentuna: "Alliansen" M+C+L+KD, majoritet
    a: styre('M+C+L+KD', ['M', 'C', 'L', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0123': { // Järfälla: S+C+V (spruckit sommaren 2024 pga oenighet om försörjningsstöd) →
    // S+M, majoritet (32/61) fr.o.m. juni 2024 — FÖRSTA gången M+S styr tillsammans i
    // Järfälla (bekräftat av användaren).
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '0125': { // Ekerö: "Mälaralliansen" M+KD+C+L (2022) → sprack pga SD-samarbete →
    // S+L+KD+C+MP "Mittenstyret", majoritet, fr.o.m. juni 2023 (bekräftat av användaren).
    a: styre('S+L+KD+C+MP', ['S', 'L', 'KD', 'C', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '0127': { // Botkyrka: "Botkyrkas bästa" M+TuP+KD+C, MINORITET (34/75, bekräftat av
    // användaren) — plus 6 f.d. S-ledamöter som blev politiska vildar (INTE räknade som
    // parti, bara individer). TuP = Tullingepartiet, partikod 0711, forkortning "TuP"
    // (skarp data, verifierat). Bröt ~30 år av S-styre.
    a: styre('M+TuP+KD+C', ['M', 'TuP', 'KD', 'C']),
    b: rest(),
    note: NOTE,
  },
  '0128': { // Salem: Alliansen M+C+L+KD styrde sedan kommunens bildande 1983 → historiskt
    // maktskifte 23 nov 2023 → S+L+C+R, MINORITET (14/31, bekräftat mot direkt
    // wikipedia-läsning). R = Rönningepartiet, partikod 1080, forkortning "R" — wikipedia-
    // tabellen skriver självt "RP", vilket INTE hade matchat skarp data.
    a: styre('S+L+C+R', ['S', 'L', 'C', 'R']),
    b: rest(),
    note: NOTE,
  },
  '0138': { // Tyresö: tilltänkt M+KD+C (2022, m. SD-teknisk-samverkan) föll → C+MP+L+S
    // "Tyresösamarbetet" (apr 2023, m. V-stöd) → S+M, majoritet (37/61) fr.o.m. maj 2024
    // (bekräftat av användaren).
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '0191': { // Sigtuna: M+KD+L+C+SFS (2022, minoritet, 29/51) → M+SD+KD+SFS, majoritet
    // (32/51, bekräftat av användaren). SFS = Sigtunapartiet Samling för Sigtuna,
    // partikod 0009, forkortning "SFS" (versaler — INTE "SfS", skarp data, verifierat).
    a: styre('M+SD+KD+SFS', ['M', 'SD', 'KD', 'SFS']),
    b: rest(),
    note: NOTE,
  },
  '0180': { // Stockholm (kommun): S+V+MP, majoritet (53/101) — bekräftat mot TVÅ
    // oberoende källor (start.stockholm.se + separat extraktion av wikipedia-tabellen).
    a: styre('S+V+MP', ['S', 'V', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '0360': { // Tierp: C+M+KD+L (bekräftat av användaren — inget oberoende sökpass kunde
    // fastställa detta, se Uppsala län-anteckningen ovan).
    a: styre('C+M+KD+L', ['C', 'M', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '0162': { // Danderyd: M+L+KD, majoritet (29/51)
    a: styre('M+L+KD', ['M', 'L', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0136': { // Haninge: M+L+KD, MINORITET (21/61)
    a: styre('M+L+KD', ['M', 'L', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0126': { // Huddinge: S+C+MP+HP, MINORITET (26/61) — HP = Huddingepartiet, partikod
    // 0028, forkortning "HP" (skarp data, verifierat — flera olika "HP"-lokalpartier
    // finns nationellt, district-scopet gör matchningen säker).
    a: styre('S+C+MP+HP', ['S', 'C', 'MP', 'HP']),
    b: rest(),
    note: NOTE,
  },
  '0186': { // Lidingö: M+LP, MINORITET (29/61) — LP = Lidingöpartiet, partikod 0019,
    // forkortning "LP" (skarp data, verifierat).
    a: styre('M+LP', ['M', 'LP']),
    b: rest(),
    note: NOTE,
  },
  '0182': { // Nacka: M+C+L+KD, MINORITET (30/61)
    a: styre('M+C+L+KD', ['M', 'C', 'L', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0188': { // Norrtälje: M+SD+L+KD (2022, majoritet, 34/61) → S+C+L+MP, MINORITET
    // (28/61) fr.o.m. aug 2024.
    a: styre('S+C+L+MP', ['S', 'C', 'L', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '0140': { // Nykvarn: S+NP+C+MP, majoritet (16/31) — NP = Nykvarnspartiet, partikod
    // 0123, forkortning "NP" (skarp data, verifierat — skilt från "Ny Kurs Nykvarn",
    // förkortning "NKN").
    a: styre('S+NP+C+MP', ['S', 'NP', 'C', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '0192': { // Nynäshamn: M+KD+L+C, MINORITET (15/41)
    a: styre('M+KD+L+C', ['M', 'KD', 'L', 'C']),
    b: rest(),
    note: NOTE,
  },
  '0163': { // Sollentuna: M+L+C+KD, majoritet (32/61)
    a: styre('M+L+C+KD', ['M', 'L', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0184': { // Solna: S+V+C+MP, majoritet (33/61)
    a: styre('S+V+C+MP', ['S', 'V', 'C', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '0183': { // Sundbyberg: S+V+C+MP, majoritet (34/61)
    a: styre('S+V+C+MP', ['S', 'V', 'C', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '0181': { // Södertälje: S+M+MP, majoritet (35/65)
    a: styre('S+M+MP', ['S', 'M', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '0160': { // Täby: M+L+C+KD, majoritet (43/61)
    a: styre('M+L+C+KD', ['M', 'L', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0139': { // Upplands-Bro: M+KD+L+C, MINORITET (17/41 enligt 2022 års mandatfördelning —
    // sätestalet för 2026 skiljer sig, se SEAT_CONFIG_2026; partierna gör det inte).
    a: styre('M+KD+L+C', ['M', 'KD', 'L', 'C']),
    b: rest(),
    note: NOTE,
  },
  '0187': { // Vaxholm: M+S+V+L+KD, majoritet (16/31 — precis på gränsen)
    a: styre('M+S+V+L+KD', ['M', 'S', 'V', 'L', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0120': { // Värmdö: S+C+L+MP, MINORITET (25/51)
    a: styre('S+C+L+MP', ['S', 'C', 'L', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '0117': { // Österåker: M+L+C+KD, majoritet (27/51 enligt 2022 års mandatfördelning —
    // sätestalet för 2026 skiljer sig, se SEAT_CONFIG_2026; partierna gör det inte).
    a: styre('M+L+C+KD', ['M', 'L', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1784': { // Arvika: S+C+V+MP (–apr 2026) → S+V+MP, MINORITET (23/49) fr.o.m. apr 2026
    // (bekräftat av användaren mot direkt wikipedia-läsning) — C lämnade.
    a: styre('S+V+MP', ['S', 'V', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1730': { // Eda: M+C+KD+HEL+V+L, majoritet (19/35 enligt 2022 — sätestalet för 2026
    // skiljer sig, se SEAT_CONFIG_2026). HEL = Hela Edas Lista, partikod 0160,
    // forkortning "HEL" (skarp data, verifierat).
    a: styre('M+C+KD+HEL+V+L', ['M', 'C', 'KD', 'HEL', 'V', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1782': { // Filipstad: M+SD+L+C, majoritet (19/37 enligt 2022 — sätestalet för 2026
    // skiljer sig, se SEAT_CONFIG_2026).
    a: styre('M+SD+L+C', ['M', 'SD', 'L', 'C']),
    b: rest(),
    note: NOTE,
  },
  '1763': { // Forshaga: S+C, majoritet (21/41)
    a: styre('S+C', ['S', 'C']),
    b: rest(),
    note: NOTE,
  },
  '1764': { // Grums: S+V, majoritet (16/31)
    a: styre('S+V', ['S', 'V']),
    b: rest(),
    note: NOTE,
  },
  '1783': { // Hagfors: OR ENSAMT, MINORITET (15/35) — helt lokalt styre, inget
    // riksdagsparti alls. OR = Oberoende Realister, partikod 1305, forkortning "OR"
    // (skarp data, verifierat).
    a: styre('OR', ['OR']),
    b: rest(),
    note: NOTE,
  },
  '1761': { // Hammarö: S+MP+C+V, majoritet (16/31)
    a: styre('S+MP+C+V', ['S', 'MP', 'C', 'V']),
    b: rest(),
    note: NOTE,
  },
  '1780': { // Karlstad: S+C+MP, MINORITET (29/61)
    a: styre('S+C+MP', ['S', 'C', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1715': { // Kil: S+C+MP, majoritet (21/41)
    a: styre('S+C+MP', ['S', 'C', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1781': { // Kristinehamn: S+C+V+MP, majoritet (21/41)
    a: styre('S+C+V+MP', ['S', 'C', 'V', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1762': { // Munkfors: S ENSAMT, majoritet (13/21, en plats vakant)
    a: styre('S', ['S']),
    b: rest(),
    note: NOTE,
  },
  '1760': { // Storfors: M+SD+C+KD (okt–dec 2022) → S ENSAMT, MINORITET (9/27) fr.o.m. dec
    // 2022 (bekräftat av användaren mot direkt wikipedia-läsning).
    a: styre('S', ['S']),
    b: rest(),
    note: NOTE,
  },
  '1766': { // Sunne: M+HS+L, MINORITET (15/41) — HS = Hela Sunne, partikod 1113,
    // forkortning "HS" (skarp data, verifierat).
    a: styre('M+HS+L', ['M', 'HS', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1785': { // Säffle: C+M+KD+L+MP, majoritet (21/41)
    a: styre('C+M+KD+L+MP', ['C', 'M', 'KD', 'L', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1737': { // Torsby: S ENSAMT, MINORITET (10/31)
    a: styre('S', ['S']),
    b: rest(),
    note: NOTE,
  },
  '1765': { // Årjäng: KD+M+L, MINORITET (15/35)
    a: styre('KD+M+L', ['KD', 'M', 'L']),
    b: rest(),
    note: NOTE,
  },
  '2403': { // Bjurholm: M+KD+SD, majoritet (12/21)
    a: styre('M+KD+SD', ['M', 'KD', 'SD']),
    b: rest(),
    note: NOTE,
  },
  '2425': { // Dorotea: S+L+C+V+KD, majoritet (19/25)
    a: styre('S+L+C+V+KD', ['S', 'L', 'C', 'V', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '2481': { // Lycksele: KD+M+L+C, majoritet (16/31)
    a: styre('KD+M+L+C', ['KD', 'M', 'L', 'C']),
    b: rest(),
    note: NOTE,
  },
  '2418': { // Malå: V+ML+L+M, majoritet (17/25) — ML = Malålistan, partikod 0525,
    // forkortning "ML" (skarp data, verifierat).
    a: styre('V+ML+L+M', ['V', 'ML', 'L', 'M']),
    b: rest(),
    note: NOTE,
  },
  '2401': { // Nordmaling: C+M+KD+L, majoritet (17/31)
    a: styre('C+M+KD+L', ['C', 'M', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '2417': { // Norsjö: S+V, majoritet (14/27)
    a: styre('S+V', ['S', 'V']),
    b: rest(),
    note: NOTE,
  },
  '2409': { // Robertsfors: S+V, MINORITET (15/31)
    a: styre('S+V', ['S', 'V']),
    b: rest(),
    note: NOTE,
  },
  '2482': { // Skellefteå: S+V, majoritet (33/65)
    a: styre('S+V', ['S', 'V']),
    b: rest(),
    note: NOTE,
  },
  '2422': { // Sorsele: V+S, majoritet (16/21)
    a: styre('V+S', ['V', 'S']),
    b: rest(),
    note: NOTE,
  },
  '2421': { // Storuman: S+C+KD, MINORITET (15/31)
    a: styre('S+C+KD', ['S', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '2480': { // Umeå: S+MP, MINORITET (28/65)
    a: styre('S+MP', ['S', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '2462': { // Vilhelmina: S ENSAMT, MINORITET (8/27)
    a: styre('S', ['S']),
    b: rest(),
    note: NOTE,
  },
  '2404': { // Vindeln: S+KD, MINORITET (15/31)
    a: styre('S+KD', ['S', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '2460': { // Vännäs: S+M+V, majoritet (19/31)
    a: styre('S+M+V', ['S', 'M', 'V']),
    b: rest(),
    note: NOTE,
  },
  '2463': { // Åsele: S+ÅSP, majoritet (16/25) — wikipedia-tabellen skriver "ÅP", men
    // partiet (Åselepartiet) har forkortning "ÅSP" i skarp data — "ÅP" hade dessutom
    // felaktigt matchat "Åstorpspartiet" (en helt annan kommuns lokala parti i Skåne).
    // Verifierat mot både skarp data och en oberoende wikipedia-artikel om partiet.
    a: styre('S+ÅSP', ['S', 'ÅSP']),
    b: rest(),
    note: NOTE,
  },
  '2280': { // Härnösand: S+V+MP+KD (2022–2023) → S+MP+KD (2023–), majoritet (22/43) — V
    // lämnade; bekräftat av användaren mot direkt wikipedia-läsning.
    a: styre('S+MP+KD', ['S', 'MP', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '2282': { // Kramfors: S+V, majoritet (22/41 enligt 2022 — sätestalet för 2026 skiljer
    // sig, se SEAT_CONFIG_2026).
    a: styre('S+V', ['S', 'V']),
    b: rest(),
    note: NOTE,
  },
  '2283': { // Sollefteå: C+VSKB+V, majoritet (26/45) — VSKB = Västra Initiativet, partikod
    // 1002, forkortning "VSKB" (skarp data, verifierat).
    a: styre('C+VSKB+V', ['C', 'VSKB', 'V']),
    b: rest(),
    note: NOTE,
  },
  '2281': { // Sundsvall: S+V+C, majoritet (38/71)
    a: styre('S+V+C', ['S', 'V', 'C']),
    b: rest(),
    note: NOTE,
  },
  '2262': { // Timrå: S+M, majoritet (23/41)
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '2260': { // Ånge: S+M+C+KD, majoritet (21/35)
    a: styre('S+M+C+KD', ['S', 'M', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '2284': { // Örnsköldsvik: C+M+KD, MINORITET (28/61)
    a: styre('C+M+KD', ['C', 'M', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1984': { // Arboga: M+SD+L+KD (minoritet, –dec 2025) → S+V+C+MP, majoritet (17/31)
    // fr.o.m. dec 2025 (bekräftat av användaren mot direkt wikipedia-läsning).
    a: styre('S+V+C+MP', ['S', 'V', 'C', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1982': { // Fagersta: S+M+L+C, majoritet (18/35)
    a: styre('S+M+L+C', ['S', 'M', 'L', 'C']),
    b: rest(),
    note: NOTE,
  },
  '1961': { // Hallstahammar: S+V+L+MP, majoritet (19/37)
    a: styre('S+V+L+MP', ['S', 'V', 'L', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1960': { // Kungsör: S+C+V, majoritet (16/31)
    a: styre('S+C+V', ['S', 'C', 'V']),
    b: rest(),
    note: NOTE,
  },
  '1983': { // Köping: S+KD+V+C, majoritet (27/49)
    a: styre('S+KD+V+C', ['S', 'KD', 'V', 'C']),
    b: rest(),
    note: NOTE,
  },
  '1962': { // Norberg: S ENSAMT, MINORITET (13/31)
    a: styre('S', ['S']),
    b: rest(),
    note: NOTE,
  },
  '1981': { // Sala: S+C+V+MP, majoritet (23/45)
    a: styre('S+C+V+MP', ['S', 'C', 'V', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1904': { // Skinnskatteberg: SD ENSAMT (minoritet, 6/25) → SD+L+C, MINORITET (12/25)
    // fr.o.m. mars 2023 (bekräftat av användaren mot direkt wikipedia-läsning).
    a: styre('SD+L+C', ['SD', 'L', 'C']),
    b: rest(),
    note: NOTE,
  },
  '1907': { // Surahammar: M+S+C+KD, majoritet (21/31)
    a: styre('M+S+C+KD', ['M', 'S', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1980': { // Västerås: S+V+C+KD, majoritet (31/61)
    a: styre('S+V+C+KD', ['S', 'V', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1440': { // Ale: M+SD+KD+FiA, majoritet (25/49) — FiA = Framtid i Ale, partikod 1158,
    // forkortning "FiA" (skarp data, verifierat).
    a: styre('M+SD+KD+FiA', ['M', 'SD', 'KD', 'FiA']),
    b: rest(),
    note: NOTE,
  },
  '1489': { // Alingsås: M+KD+L, MINORITET (18/51)
    a: styre('M+KD+L', ['M', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1460': { // Bengtsfors: M+C+KD+L (–sep 2024) → M+C+KD, MINORITET (14/31) fr.o.m. sep 2024
    // (L lämnade).
    a: styre('M+C+KD', ['M', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1443': { // Bollebygd: S+M+V+MP, majoritet (16/31)
    a: styre('S+M+V+MP', ['S', 'M', 'V', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1490': { // Borås: S+C+L+MP, MINORITET (32/73)
    a: styre('S+C+L+MP', ['S', 'C', 'L', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1438': { // Dals-Ed: M+C+KD+L, majoritet (18/31)
    a: styre('M+C+KD+L', ['M', 'C', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1445': { // Essunga: M+C+KD+MP, majoritet (19/31)
    a: styre('M+C+KD+MP', ['M', 'C', 'KD', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1499': { // Falköping: M+C+KD+V+L+MP, MINORITET (25/51)
    a: styre('M+C+KD+V+L+MP', ['M', 'C', 'KD', 'V', 'L', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1439': { // Färgelanda: S+M+L (–jun 2024) → S+L (jun 2024–sep 2025) → SD+KD, MINORITET
    // (12/31) fr.o.m. sep 2025 — bytt två gånger, S helt ute nu.
    a: styre('SD+KD', ['SD', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1444': { // Grästorp: M+C+L+KD, majoritet (19/31)
    a: styre('M+C+L+KD', ['M', 'C', 'L', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1447': { // Gullspång: M+KD, MINORITET (11/31)
    a: styre('M+KD', ['M', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1480': { // Göteborg: S+V+MP, MINORITET (40/81)
    a: styre('S+V+MP', ['S', 'V', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1471': { // Götene: GÖF+M+C+KD+L+MP, MINORITET (20/41) — GÖF = Götenes framtid, partikod
    // 0094, forkortning "GÖF" (skarp data — wikipedia-tabellen skriver "GF", vilket INTE
    // hade matchat).
    a: styre('GÖF+M+C+KD+L+MP', ['GÖF', 'M', 'C', 'KD', 'L', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1466': { // Herrljunga: S+C+V+L, majoritet (16/31)
    a: styre('S+C+V+L', ['S', 'C', 'V', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1497': { // Hjo: M+C+KD+L, majoritet (18/33)
    a: styre('M+C+KD+L', ['M', 'C', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1401': { // Härryda: M+C+L+KD+SPP+KomP, MINORITET (22/51) — SPP och KomP (Sportpartiet
    // och Kommunpartiet i wikipedia-tabellen) matchar INGET parti i skarp data, inte ens
    // det närmast liknande registrerade "SPORT- OCH KOMMUNPARTIET" (SOKP, partikod 0546,
    // noll röster i hela riket i denna datamängd) — inkluderade ändå (samma princip som
    // Kirunas FI, se Norrbotten-anteckningen) eftersom de beskriver det SITTANDE styret;
    // bidrar i praktiken med 0 mandat i appen.
    a: styre('M+C+L+KD+SPP+KomP', ['M', 'C', 'L', 'KD', 'SPP', 'KomP']),
    b: rest(),
    note: NOTE,
  },
  '1446': { // Karlsborg: M+C+KD+L, majoritet (16/31)
    a: styre('M+C+KD+L', ['M', 'C', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1482': { // Kungälv: S+M+MP, majoritet (31/61)
    a: styre('S+M+MP', ['S', 'M', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1441': { // Lerum: M+S, majoritet (26/51)
    a: styre('M+S', ['M', 'S']),
    b: rest(),
    note: NOTE,
  },
  '1494': { // Lidköping: M+KD+V+L (–mars 2025) → S+C+V+MP, majoritet (26/51) fr.o.m. mars
    // 2025 (bekräftat av användaren) — helt ny konstellation, inte bara ett tillägg.
    a: styre('S+C+V+MP', ['S', 'C', 'V', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1462': { // Lilla Edet: C+S+M (–jun 2023) → C+S+M+V, majoritet (17/31) fr.o.m. jun 2023
    // (bekräftat av användaren) — V tillkom.
    a: styre('C+S+M+V', ['C', 'S', 'M', 'V']),
    b: rest(),
    note: NOTE,
  },
  '1484': { // Lysekil: S+LP+MP (–feb 2023) → S+LP+V+MP (feb 2023–jan 2026) → S+V+MP,
    // MINORITET (11/31) fr.o.m. jan 2026 (bekräftat av användaren) — LP (Lysekilspartiet)
    // lämnade, INTE längre med i styret.
    a: styre('S+V+MP', ['S', 'V', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1493': { // Mariestad: M+C+KD (–jul 2024) → M+KD+SD, majoritet (28/49) fr.o.m. jul 2024
    // (bekräftat av användaren) — C ersattes av SD.
    a: styre('M+KD+SD', ['M', 'KD', 'SD']),
    b: rest(),
    note: NOTE,
  },
  '1463': { // Mark: S+C, MINORITET (21/51)
    a: styre('S+C', ['S', 'C']),
    b: rest(),
    note: NOTE,
  },
  '1461': { // Mellerud: M+KD+KiM, MINORITET (10/31) — KiM = KommunPartiet Mellerud,
    // partikod 0593, forkortning "KiM" (skarp data, gemener — wikipedia-tabellen skriver
    // versalt "KIM", vilket INTE hade matchat).
    a: styre('M+KD+KiM', ['M', 'KD', 'KiM']),
    b: rest(),
    note: NOTE,
  },
  '1430': { // Munkedal: SD+M+KD, majoritet (20/35)
    a: styre('SD+M+KD', ['SD', 'M', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1481': { // Mölndal: S+M, majoritet (31/61)
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '1421': { // Orust: S+M+L, majoritet (21/41)
    a: styre('S+M+L', ['S', 'M', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1402': { // Partille: M+KD+L, MINORITET (20/51)
    a: styre('M+KD+L', ['M', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1495': { // Skara: C+S+KD+V+MP+L, majoritet (25/45)
    a: styre('C+S+KD+V+MP+L', ['C', 'S', 'KD', 'V', 'MP', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1496': { // Skövde: M+S+KD, majoritet (32/61)
    a: styre('M+S+KD', ['M', 'S', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1427': { // Sotenäs: S ENSAMT, MINORITET (8/31)
    a: styre('S', ['S']),
    b: rest(),
    note: NOTE,
  },
  '1415': { // Stenungsund: S+M, majoritet (26/51)
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '1486': { // Strömstad: S+M+KD+V, majoritet (22/39)
    a: styre('S+M+KD+V', ['S', 'M', 'KD', 'V']),
    b: rest(),
    note: NOTE,
  },
  '1465': { // Svenljunga: M+SD+KD+LPo (–nov 2023) → M+KD+LPo, MINORITET (12/33) fr.o.m. nov
    // 2023 (SD lämnade). LPo = Landsbygdspartiet Oberoende, partikod 1011, forkortning
    // "LPo" (skarp data, verifierat — samma partikod som Kronobergs Uppvidinge, en
    // riksregistrerad lista på flera orter).
    a: styre('M+KD+LPo', ['M', 'KD', 'LPo']),
    b: rest(),
    note: NOTE,
  },
  '1435': { // Tanum: M+C+L+KD (–sep 2023) → M+C+KD, majoritet (21/41) fr.o.m. sep 2023 (L
    // lämnade).
    a: styre('M+C+KD', ['M', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1472': { // Tibro: S+C+L, MINORITET (17/35)
    a: styre('S+C+L', ['S', 'C', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1498': { // Tidaholm: L+VT+M+SD+KD, majoritet (23/41) — VT = Vi Tidaholm, partikod 1474,
    // forkortning "VT" (skarp data, verifierat).
    a: styre('L+VT+M+SD+KD', ['L', 'VT', 'M', 'SD', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1419': { // Tjörn: L+M+C, MINORITET (13/41)
    a: styre('L+M+C', ['L', 'M', 'C']),
    b: rest(),
    note: NOTE,
  },
  '1452': { // Tranemo: S+C+L, majoritet (21/37)
    a: styre('S+C+L', ['S', 'C', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1488': { // Trollhättan: M+C+KD, MINORITET (24/61)
    a: styre('M+C+KD', ['M', 'C', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1473': { // Töreboda: M+L, MINORITET (10/31)
    a: styre('M+L', ['M', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1485': { // Uddevalla: SD+M+UddP+KD, majoritet (33/61) — UddP = Uddevallapartiet,
    // partikod 1076, forkortning "UddP" (skarp data, verifierat).
    a: styre('SD+M+UddP+KD', ['SD', 'M', 'UddP', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1491': { // Ulricehamn: M+C+KD+L, MINORITET (21/49)
    a: styre('M+C+KD+L', ['M', 'C', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1470': { // Vara: M+SD+KD, majoritet (23/45)
    a: styre('M+SD+KD', ['M', 'SD', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1442': { // Vårgårda: C+M+KD+L, majoritet (21/41)
    a: styre('C+M+KD+L', ['C', 'M', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1487': { // Vänersborg: S+C+KD+MP, MINORITET (23/51)
    a: styre('S+C+KD+MP', ['S', 'C', 'KD', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '1492': { // Åmål: M+C+KD+L, MINORITET (15/35)
    a: styre('M+C+KD+L', ['M', 'C', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1407': { // Öckerö: KD+M+L, majoritet (22/41)
    a: styre('KD+M+L', ['KD', 'M', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1882': { // Askersund: M+KD+L, MINORITET (11/33)
    a: styre('M+KD+L', ['M', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1862': { // Degerfors: V+M (–maj 2024) → V+S+M (maj 2024–jan 2026) → V+S, majoritet
    // (17/31) fr.o.m. jan 2026 (bekräftat av användaren) — M lämnade, S kvar.
    a: styre('V+S', ['V', 'S']),
    b: rest(),
    note: NOTE,
  },
  '1861': { // Hallsberg: S+C+KD+L, majoritet (23/45, 1 vakant)
    a: styre('S+C+KD+L', ['S', 'C', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1863': { // Hällefors: M+C+GL, MINORITET (13/31 enligt 2022 — sätestalet för 2026
    // skiljer sig, se SEAT_CONFIG_2026). GL = Grythyttelistan, partikod 1069, forkortning
    // "GL" (skarp data, verifierat).
    a: styre('M+C+GL', ['M', 'C', 'GL']),
    b: rest(),
    note: NOTE,
  },
  '1883': { // Karlskoga: M+KD+C+L, MINORITET (24/51)
    a: styre('M+KD+C+L', ['M', 'KD', 'C', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1881': { // Kumla: S+M, majoritet (24/45)
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '1860': { // Laxå: C+KD+V, majoritet (16/31)
    a: styre('C+KD+V', ['C', 'KD', 'V']),
    b: rest(),
    note: NOTE,
  },
  '1814': { // Lekeberg: M+KD+FL+L+V (–sep 2023) → M+KD+FL+V, MINORITET (15/35, 2 vakanta)
    // fr.o.m. sep 2023 (bekräftat av användaren) — L lämnade. FL = Framtidspartiet i
    // Lekeberg, partikod 0997, forkortning "FL" (skarp data, verifierat).
    a: styre('M+KD+FL+V', ['M', 'KD', 'FL', 'V']),
    b: rest(),
    note: NOTE,
  },
  '1885': { // Lindesberg: M+SD+KD+LPo+L (–maj 2024) → M+SD+KD+L, MINORITET (22/45) fr.o.m.
    // maj 2024 (bekräftat av användaren) — LPo (Landsbygdspartiet Oberoende, samma
    // partikod 1011 som Kronobergs Uppvidinge och Västra Götalands Svenljunga) lämnade,
    // INTE längre med i det nuvarande styret.
    a: styre('M+SD+KD+L', ['M', 'SD', 'KD', 'L']),
    b: rest(),
    note: NOTE,
  },
  '1864': { // Ljusnarsberg: S+V, majoritet (11/21)
    a: styre('S+V', ['S', 'V']),
    b: rest(),
    note: NOTE,
  },
  '1884': { // Nora: S+M+KD, majoritet (18/35)
    a: styre('S+M+KD', ['S', 'M', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '1880': { // Örebro (kommun): S+M+C, majoritet (36/65)
    a: styre('S+M+C', ['S', 'M', 'C']),
    b: rest(),
    note: NOTE,
  },
  '0560': { // Boxholm: S ENSAMT, MINORITET (12/29)
    a: styre('S', ['S']),
    b: rest(),
    note: NOTE,
  },
  '0562': { // Finspång: S+C+L, MINORITET (22/45)
    a: styre('S+C+L', ['S', 'C', 'L']),
    b: rest(),
    note: NOTE,
  },
  '0513': { // Kinda: M+S+KD, majoritet (18/35)
    a: styre('M+S+KD', ['M', 'S', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0580': { // Linköping: S+M, MINORITET (38/79)
    a: styre('S+M', ['S', 'M']),
    b: rest(),
    note: NOTE,
  },
  '0586': { // Mjölby: S+L+C+KD+MP, majoritet (25/45)
    a: styre('S+L+C+KD+MP', ['S', 'L', 'C', 'KD', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '0583': { // Motala: M+SD+KD, MINORITET (28/57)
    a: styre('M+SD+KD', ['M', 'SD', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0581': { // Norrköping: M+KD+L (–dec 2024) → S+KD+C+L, MINORITET (38/85) fr.o.m. dec
    // 2024 (bekräftat av användaren) — helt ny konstellation, M ersattes av S+C.
    a: styre('S+KD+C+L', ['S', 'KD', 'C', 'L']),
    b: rest(),
    note: NOTE,
  },
  '0582': { // Söderköping: M+S+KD, majoritet (20/39)
    a: styre('M+S+KD', ['M', 'S', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0584': { // Vadstena: M+S, majoritet (19/35)
    a: styre('M+S', ['M', 'S']),
    b: rest(),
    note: NOTE,
  },
  '0563': { // Valdemarsvik: M+SD+LPo+KD, majoritet (19/35) — LPo = Landsbygdspartiet
    // Oberoende, partikod 1011, forkortning "LPo" (skarp data, verifierat — samma
    // partikod som Kronobergs Uppvidinge, Västra Götalands Svenljunga och Örebros
    // Lindesberg, en riksregistrerad lista på flera orter).
    a: styre('M+SD+LPo+KD', ['M', 'SD', 'LPo', 'KD']),
    b: rest(),
    note: NOTE,
  },
  '0512': { // Ydre: C+M, majoritet (12/21)
    a: styre('C+M', ['C', 'M']),
    b: rest(),
    note: NOTE,
  },
  '0561': { // Åtvidaberg: S+C+V+L+MP, majoritet (18/35)
    a: styre('S+C+V+L+MP', ['S', 'C', 'V', 'L', 'MP']),
    b: rest(),
    note: NOTE,
  },
  '0509': { // Ödeshög: M+S+C, majoritet (18/35)
    a: styre('M+S+C', ['M', 'S', 'C']),
    b: rest(),
    note: NOTE,
  },
}
