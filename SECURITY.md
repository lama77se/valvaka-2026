# Säkerhetspolicy

## Rapportera en sårbarhet

Rapportera **inte** säkerhetshål i publika issues eller pull requests.

Använd i stället GitHubs privata kanal:
**Security → Report a vulnerability** (fliken *Security* högst upp i repot →
*Report a vulnerability*). Det öppnar en privat rådgivning som bara du och
underhållarna ser.

Beskriv gärna:

- vad som är sårbart (fil/endpoint/tabell) och hur det kan utnyttjas,
- steg för att återskapa, samt
- eventuell påverkan (läsa/ändra data, DoS, etc.).

Du får normalt svar inom några dagar. Tack för att du rapporterar ansvarsfullt.

## Säkerhetsmodell (kort)

Detta är en publik realtidsvisualisering av offentliga svenska valresultat.
Några principer som är bra att känna till vid granskning:

- **Klienten använder Supabase anon-nyckel** — den är publik med flit och skyddar
  ingenting i sig. All åtkomstkontroll ligger i Postgres **Row Level Security
  (RLS)**: anon får läsa publik referens-/resultatdata men kan inte skriva till
  någon tabell. Skrivning sker enbart server-side med service-role-nyckeln
  (ingestion-worker/edge functions), som **aldrig** finns i klienten eller repot.
- **Inga hemligheter i repot.** Service-role-nyckel, DB-lösenord och access-tokens
  bor i `.env.local` (gitignore:ad) respektive GitHub Actions-secrets — aldrig
  i versionshanterad kod.
- **En saknad RLS-policy är en sårbarhet.** Varje ny tabell i schemat `public`
  måste ha RLS aktiverat; annars exponeras den via PostgREST. Rapportera gärna om
  du hittar en tabell utan RLS eller en policy som läcker mer än avsett.

## Omfattning

I omfattning: detta repos kod, databasmigrationer/RLS-policyer och edge functions.
Utanför omfattning: sårbarheter i tredjepartsleverantörer (Supabase, Vercel,
`data.val.se`) — rapportera dem direkt till respektive leverantör.
