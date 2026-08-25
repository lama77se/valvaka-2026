// Färghjälpare för partifärger i UI:t.
//
// Partiernas märkesfärger (party.color) är valda för att FYLLA ytor (kartan, staplarna)
// mot en mörk bakgrund. Ett par av dem är mörka — V vinröd #8B0016, KD marinblå #231977 —
// vilket är helt läsbart som fyllnad med etikett ovanpå, men nästan osynligt när samma
// färg används som TEXT direkt mot den mörka bakgrunden (avgångstavlan, nedbrytnings-
// rubrikerna). `onDark` höjer därför en färgs ljushet till ett golv så texten syns, men
// behåller kulören (partiidentiteten) — och radernas förkortning ("V"/"S") skiljer dem
// åt även när de lightade nyanserna närmar sig varandra.

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0')

// Höj HSL-ljusheten till minst `floor` (kulör + mättnad bevaras). Redan ljusa färger
// (M ljusblå, SD gul …) lämnas orörda; bara de mörka (V, KD) lyfts.
export function onDark(hex: string, floor = 0.55): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex
  const [r0, g0, b0] = hexToRgb(hex).map((v) => v / 255) as [number, number, number]
  const max = Math.max(r0, g0, b0)
  const min = Math.min(r0, g0, b0)
  const l = (max + min) / 2
  if (l >= floor) return hex
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r0 ? (g0 - b0) / d + (g0 < b0 ? 6 : 0) : max === g0 ? (b0 - r0) / d + 2 : (r0 - g0) / d + 4
    h /= 6
  }
  const L = floor
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = L < 0.5 ? L * (1 + s) : L + s - L * s
  const p = 2 * L - q
  return '#' + toHex(hue2rgb(p, q, h + 1 / 3)) + toHex(hue2rgb(p, q, h)) + toHex(hue2rgb(p, q, h - 1 / 3))
}
