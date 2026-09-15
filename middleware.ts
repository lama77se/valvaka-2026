// Lösenordsgrind för /eg_m (handover 14 sep, Lars via Val ANALYSIS) — en halvdold,
// icke-indexerad sida (eg_m.html/src/eg_m/), HELT fristående från huvudappen. Vercel
// Edge Middleware, framework-agnostisk (projektet är rent Vite/SPA, inget Next.js) —
// @vercel/edge:s `next()` är den dokumenterade vägen att "släppa igenom" en request
// till normal statisk routing utan Next-specifika API:er.
//
// Halvdold, INTE en hård säkerhetsgräns: matchern gäller bara SIDROUTEN /eg_m (den
// mänskliga upptäckten/länken), inte de kompilerade JS/CSS-tillgångarna den refererar
// (/assets/eg_m-*.js) — de är statiska filer utan hemligheter (samma publika anon-
// nyckel/RLS-modell som huvudsajtens bundle redan exponerar), så att gata dem extra
// vore meningslöst. Kombinerat med `noindex` (eg_m.html) räcker detta för "halvdold
// länk delad med en person", inte för att skydda känslig data (det finns ingen här —
// se lib/eg_m.ts, all data är redan offentlig valstatistik).
//
// ⚠️ Kan INTE testköras lokalt: Vercel Edge Middleware körs bara på Vercels egen
// infrastruktur (`vite dev`/`vite preview` kör den aldrig) och denna session har ingen
// Vercel-inloggning. Krypto-/cookie-logiken (HMAC, konstant-tid-jämförelse) är
// verifierad separat i ren Node (samma Web Crypto-API). Fullständig verifiering av
// grinden i en RIKTIG deploy (matcher träffar /eg_m, POST sätter cookien, GET med
// giltig cookie släpper igenom) måste göras av någon med Vercel-åtkomst efter merge —
// samma mönster som databasmigrationerna tidigare ikväll.
import { next } from '@vercel/edge'

export const config = { matcher: ['/eg_m', '/eg_m/'] }

const COOKIE_NAME = 'eg_m_auth'
const MAX_AGE_S = 60 * 60 * 24 * 30 // 30 dagar — en länk man loggar in på en gång, inte varje besök

async function hmac(value: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(value))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Konstant-tid-jämförelse — undviker att svarstiden läcker HUR MÅNGA tecken som
// stämde (klassisk timing-attack mot en naiv `===`). Längdskillnaden läcker fortfarande
// (kort-circuit ovan), en accepterad, vanlig avvägning för en sida med den här
// hotmodellen (en halvdold personlig sida, inte en inloggningsgrind mot känslig data).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function loginPage(wrongPassword: boolean): Response {
  const html = `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Logga in</title>
<style>
body{font-family:system-ui,sans-serif;background:#0b1020;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:1rem;box-sizing:border-box}
form{background:#1e293b;padding:2rem;border-radius:0.5rem;width:min(320px,100%)}
label{display:block;font-size:0.875rem}
input{width:100%;box-sizing:border-box;padding:0.5rem;margin-top:0.5rem;border-radius:0.25rem;border:1px solid #475569;background:#0f172a;color:#e2e8f0;font-size:1rem}
button{margin-top:1rem;width:100%;padding:0.5rem;border-radius:0.25rem;border:none;background:#0284c7;color:#fff;font-weight:600;cursor:pointer;font-size:1rem}
p.err{color:#fb7185;font-size:0.875rem;margin:0 0 0.75rem}
</style></head>
<body>
<form method="POST">
${wrongPassword ? '<p class="err">Fel lösenord.</p>' : ''}
<label>Lösenord<input type="password" name="password" autofocus></label>
<button type="submit">Logga in</button>
</form>
</body></html>`
  return new Response(html, { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

export default async function middleware(request: Request): Promise<Response> {
  const password = process.env.EG_M_PASSWORD
  // Fail CLOSED (inte öppet) om lösenordet inte är satt som Vercel-secret — hellre ett
  // tydligt 500-fel än en sida som råkar bli oskyddad av ett missat env-steg.
  if (!password) return new Response('Sidan är inte konfigurerad.', { status: 500 })

  const expected = await hmac('eg_m', password)

  if (request.method === 'POST') {
    const form = await request.formData()
    const attempt = String(form.get('password') ?? '')
    if (timingSafeEqual(attempt, password)) {
      const res = new Response(null, { status: 303, headers: { Location: '/eg_m' } })
      res.headers.append('Set-Cookie', `${COOKIE_NAME}=${expected}; Path=/eg_m; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_S}`)
      return res
    }
    return loginPage(true)
  }

  const cookieHeader = request.headers.get('cookie') ?? ''
  const token = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1)
  if (token && timingSafeEqual(token, expected)) return next()

  return loginPage(false)
}
