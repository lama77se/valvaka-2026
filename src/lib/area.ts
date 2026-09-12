// Område-typen och relaterade konstanter — delas av all UI (ResultPanel, DistrictMap,
// Dashboard, osv.). Extraherad till en supabase-fri modul så den kan användas av
// standalone-skript (t.ex. verify-area-select.ts) utan Vite-environment-beroenden.
import type { Level } from './aggregate'
import type { Valtyp } from './results'

export type Area = { level: Level; code: string | null }
export const RIKET: Area = { level: 'riket', code: null }

// Varje valtyp väljer ett organ på EN nativ nivå: RD ett riksorgan, RF 20 region-
// fullmäktige, KF 290 kommunfullmäktige. Ovanför den nivån finns bara röstaggregat,
// ingen församling → väljaren aggregerar aldrig uppåt förbi den nativa nivån.
export const NATIVE_LEVEL: Record<Valtyp, Level> = { RD: 'riket', RF: 'region', KF: 'kommun' }
// Default-område per valtyp. RD → Riket (organ finns). RF/KF → ingen riksnivå, så
// "välj region/kommun"-läge (code null) tills man väljer i listan eller klickar i kartan.
export const defaultAreaFor = (valtyp: Valtyp): Area => ({ level: NATIVE_LEVEL[valtyp], code: null })
