// Geometri-konfig för distriktskartan (Fas 1).
//
// Distriktsgeometrin är statisk: en engångs-reprojicerad + förenklad GeoJSON
// (SWEREF99 TM / EPSG:3006 -> WGS84 / EPSG:4326, se docs/arkitektur.md §6).
// Den laddas EN gång som statisk asset — bara resultatvärden flödar sedan i
// realtid och joinas mot tile-/feature-features på `Valdistriktskod`.
//
// URL:en är env-styrd: lokalt servas filen från public/ (Vite), i produktion
// pekas VITE_GEOMETRY_URL mot den hostade artefakten (beslut i Fas 1 —
// Supabase Storage e.d.). Filen committas aldrig (gitignore: *.geojson).
export const GEOMETRY_URL =
  import.meta.env.VITE_GEOMETRY_URL ?? '/valdistrikt-2026-wgs84.geojson'

// Upplösta (dissolved) gränser för kartfärgläget "Valkrets/Region/Kommun" (en nivå
// under riket, valtyp-beroende — se ColorMode/GROUP_LEVEL_LABEL i lib/results). Byggs
// av scripts/build-group-boundaries.mjs ur SAMMA geometri (ingen extra nedladdning).
// Härledda ur GEOMETRY_URL:s katalog i stället för egna VITE_-variabler — de ligger
// alltid som SYSKON-filer i samma Storage-bucket/public-katalog, så inga nya env-
// variabler behöver sättas i Vercel när prod-URL:en är en full Storage-länk.
const GEOMETRY_DIR = GEOMETRY_URL.slice(0, GEOMETRY_URL.lastIndexOf('/') + 1)
export const VALKRETS_RD_BOUNDARIES_URL = `${GEOMETRY_DIR}valkrets-rd-boundaries.geojson`
export const REGION_BOUNDARIES_URL = `${GEOMETRY_DIR}region-boundaries.geojson`
export const KOMMUN_BOUNDARIES_URL = `${GEOMETRY_DIR}kommun-boundaries.geojson`

// Join-nyckel överallt: 8-siffrig valdistriktskod (kommunkod(4) + distrikt(4)).
// I 2026-geometrin ligger den färdig i propertyn `Valdistriktskod` — används som
// MapLibre `promoteId` så feature-id === valdistriktskod och `setFeatureState`
// kan färga distrikt direkt på resultat-upserts (Fas 5).
export const DISTRICT_ID_PROPERTY = 'Valdistriktskod'

// Sveriges utsträckning i WGS84 (uppmätt ur den reprojicerade filens bounds).
// [minLon, minLat, maxLon, maxLat]
export const SWEDEN_BOUNDS: [number, number, number, number] = [
  10.5935, 55.1371, 24.17768, 69.05997,
]
