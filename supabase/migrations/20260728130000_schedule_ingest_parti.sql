-- Fas 3 — schemalägg ingest-parti (förvalsperiod: 1×/timme).
-- Kräver pg_cron + pg_net (aktiverade via Dashboard → Database → Extensions).
--
-- Anon-nyckeln nedan är PUBLIK (samma som i frontend-bundlen) → ofarlig att den
-- syns i cron.job. Funktionen använder sin auto-injicerade service-role internt
-- för att skriva; service-role hamnar ALDRIG i cron-SQL:en.

select cron.schedule(
  'ingest-parti-hourly',
  '7 * * * *',   -- minut 7 varje timme (undvik :00-rusning)
  $$
  select net.http_post(
    url := 'https://emtjnmyberugrkdplnsh.supabase.co/functions/v1/ingest-parti',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtdGpubXliZXJ1Z3JrZHBsbnNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNDI2NDEsImV4cCI6MjEwMDgxODY0MX0.crVeAkJirm2MFm7eBpF-UbhBi_P3dxmrVCy19MJrCSw'
    ),
    timeout_milliseconds := 20000
  );
  $$
);

-- Deploy-time smoke test: fira funktionen en gång direkt så vi ser att
-- pg_net → edge function-vägen fungerar (utan att vänta på nästa hel timme).
select net.http_post(
  url := 'https://emtjnmyberugrkdplnsh.supabase.co/functions/v1/ingest-parti',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtdGpubXliZXJ1Z3JrZHBsbnNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNDI2NDEsImV4cCI6MjEwMDgxODY0MX0.crVeAkJirm2MFm7eBpF-UbhBi_P3dxmrVCy19MJrCSw'
  ),
  timeout_milliseconds := 20000
);
