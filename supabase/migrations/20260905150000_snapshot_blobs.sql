-- SNAPSHOT-BLOBBAR (CDN-contingencyn i docs/valnatt-lastkapacitet.md — triggern slog 5 sep):
-- lasttest `loadtest-poll --steps 50` visade att MOUNT-HERDEN är CPU-flaskhalsen: 50 desktop-
-- flikar = 236 000 rader / 34 requests PER FLIK vid mount (3 valtyper × keyset-snapshot + turnout
-- + uppsamling) → 11,8 M rader på 58 s → Small 100 % CPU. Large (2×) räcker inte för 300–500.
--
-- Lösning: Postgres bygger EN kompakt JSON-blob per valtyp (denna RPC), edge laddar upp den till
-- Storage-bucketen `snapshots` (CDN-backad, samma Cloudflare-cache som `geometry`), och klienten
-- seedar sina stores från bloben vid mount i stället för ~30 PostgREST-sidor. Cursorn sätts till
-- blobens `hwm` (max updated_at) → den befintliga delta-pollen tar gapet sedan bloben genererades.
-- Korrektheten beror alltså INTE på blobens färskhet (en gammal blob ⇒ bara en större första delta);
-- klienten hoppar ändå över blobbar äldre än 15 min och faller då tillbaka på keyset-vägen.
--
-- Format (v1), kompakta arrayer för storlek:
--   { v, valtyp, generated_at, hwm, turnout_hwm,
--     result:  [[valdistriktskod, partikod, roster, status, rapporteringstid], …],
--     turnout: [[valdistriktskod, totalt_antal_roster, antal_rostberattigade], …] }
-- Returnerar TEXT (inte jsonb) så edge kan ladda upp strängen rakt av utan parse+stringify av ~4 MB.
create or replace function public.snapshot_json(p_valtyp text) returns text
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'v', 1,
    'valtyp', p_valtyp,
    'generated_at', now(),
    'hwm', coalesce((select max(updated_at) from public.result where valtyp = p_valtyp), 'epoch'::timestamptz),
    'turnout_hwm', coalesce((select max(updated_at) from public.turnout where valtyp = p_valtyp), 'epoch'::timestamptz),
    'result', coalesce((
      select jsonb_agg(jsonb_build_array(valdistriktskod, partikod, roster, status, rapporteringstid)
                       order by valdistriktskod, partikod)
      from public.result where valtyp = p_valtyp), '[]'::jsonb),
    'turnout', coalesce((
      select jsonb_agg(jsonb_build_array(valdistriktskod, totalt_antal_roster, antal_rostberattigade)
                       order by valdistriktskod)
      from public.turnout where valtyp = p_valtyp), '[]'::jsonb)
  )::text;
$$;

revoke all on function public.snapshot_json(text) from public, anon, authenticated;
grant execute on function public.snapshot_json(text) to service_role;

-- Publik, CDN-backad bucket. service_role laddar upp (bypassar RLS); alla läser via /object/public/.
insert into storage.buckets (id, name, public)
values ('snapshots', 'snapshots', true)
on conflict (id) do update set public = true;

-- uppsamling_result: klienten laddade om HELA tabellen (~9k rader från onsdagen) varje poll och flik.
-- Nu: HWM-probe på updated_at och full omladdning bara när något ändrats. Kräver att updated_at
-- faktiskt bumpas vid ändring (default now() gäller bara INSERT) — villkorlig bump som result/turnout.
-- Triggernamn: *_bump_* < *_no_status_downgrade i bokstavsordning → bump kortsluter före.
create or replace function public.bump_uppsamling_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if (old.roster, old.status, old.kommunkod, old.lankod)
     is not distinct from (new.roster, new.status, new.kommunkod, new.lankod) then
    return null;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists uppsamling_result_bump_updated_at on public.uppsamling_result;
create trigger uppsamling_result_bump_updated_at
  before update on public.uppsamling_result
  for each row execute function public.bump_uppsamling_updated_at();

create index if not exists uppsamling_result_updated_at_idx on public.uppsamling_result (updated_at);

-- Säkerhetsnät: regenerera alla tre blobbarna var 5:e minut oavsett ingest (ingest-result skriver
-- dem annars direkt efter varje körning som ändrade något). Fångar fallet "blob saknas/gammal"
-- utan att någon fil ändrats — t.ex. efter en manuell DB-åtgärd. Anon-nyckeln är publik.
select cron.schedule(
  'snapshot-refresh',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://emtjnmyberugrkdplnsh.supabase.co/functions/v1/ingest-result',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtdGpubXliZXJ1Z3JrZHBsbnNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNDI2NDEsImV4cCI6MjEwMDgxODY0MX0.crVeAkJirm2MFm7eBpF-UbhBi_P3dxmrVCy19MJrCSw'
    ),
    body := jsonb_build_object('refreshSnapshots', true),
    timeout_milliseconds := 60000
  );
  $$
);
