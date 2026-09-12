// Validerar areaFromSelectValue/LEVELS/PROMPT (src/lib/areaSelect.ts) — ren
// extraktion ur ResultPanel.tsx:46-51,422-433, ingen beteendeändring.
//   npx tsx scripts/verify-area-select.ts
import { LEVELS, PROMPT, areaFromSelectValue } from '../src/lib/areaSelect.ts'

let ok = true
const check = (pass: boolean, label: string, extra = '') => { if (!pass) ok = false; console.log(`${pass ? 'OK ' : 'FEL'} ${label}${extra ? ` — ${extra}` : ''}`) }

check(LEVELS.RD.join() === 'riket,valkrets,kommun', 'LEVELS.RD')
check(LEVELS.RF.join() === 'region,valkrets', 'LEVELS.RF')
check(LEVELS.KF.join() === 'kommun', 'LEVELS.KF')
check(PROMPT.RD === '' && PROMPT.RF === 'Välj region…' && PROMPT.KF === 'Välj kommun…', 'PROMPT')

check(areaFromSelectValue('RD', 'd:01800142') === null, 'd: (distrikt) → null (sätts via kartklick, inte listan)')
check(JSON.stringify(areaFromSelectValue('RD', '')) === JSON.stringify({ level: 'riket', code: null }), 'RD tom sträng → defaultAreaFor(RD) = riket/null', JSON.stringify(areaFromSelectValue('RD', '')))
check(JSON.stringify(areaFromSelectValue('KF', '')) === JSON.stringify({ level: 'kommun', code: null }), 'KF tom sträng → defaultAreaFor(KF) = kommun/null (prompt-läge)', JSON.stringify(areaFromSelectValue('KF', '')))
check(JSON.stringify(areaFromSelectValue('RD', 'riket')) === JSON.stringify({ level: 'riket', code: null }), '"riket" → RIKET')
check(JSON.stringify(areaFromSelectValue('RD', 'vk:29')) === JSON.stringify({ level: 'valkrets', code: '29' }), 'vk: → valkrets')
check(JSON.stringify(areaFromSelectValue('RF', 'r:01')) === JSON.stringify({ level: 'region', code: '01' }), 'r: → region')
check(JSON.stringify(areaFromSelectValue('KF', 'k:1488')) === JSON.stringify({ level: 'kommun', code: '1488' }), 'k: → kommun')

console.log(ok ? '\nAlla kontroller OK.' : '\nMinst en kontroll FEL.')
process.exit(ok ? 0 : 1)
