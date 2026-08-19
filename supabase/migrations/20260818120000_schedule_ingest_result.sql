-- Fas 7 — schemalägg ingest-result (den skarpa valnatt-ingesten, körs nu mot genrep).
-- Kadens: varannan minut i förvalsperioden — lugnt mot val.se (manifestet är ETT
-- anrop, sen hämtas bara ändrade organ-zip). Första fyllningen av alla ~314 organ tar
-- ~10–15 varv (MAX_FILES=25/körning), därefter bara det som ändrats. På VALNATTEN:
-- tighta kadensen (30–60 s) i en egen migration + byt RESULT_BASE i funktionen.
--
-- Anon-nyckeln är PUBLIK (samma som i frontend) → ofarlig i cron.job. Funktionen
-- använder sin auto-injicerade service-role internt för att skriva.
select cron.schedule(
  'ingest-result-genrep',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://emtjnmyberugrkdplnsh.supabase.co/functions/v1/ingest-result',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtdGpubXliZXJ1Z3JrZHBsbnNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNDI2NDEsImV4cCI6MjEwMDgxODY0MX0.crVeAkJirm2MFm7eBpF-UbhBi_P3dxmrVCy19MJrCSw'
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- Deploy-time smoke test: fira en körning direkt (ser att pg_net → edge fungerar).
select net.http_post(
  url := 'https://emtjnmyberugrkdplnsh.supabase.co/functions/v1/ingest-result',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtdGpubXliZXJ1Z3JrZHBsbnNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNDI2NDEsImV4cCI6MjEwMDgxODY0MX0.crVeAkJirm2MFm7eBpF-UbhBi_P3dxmrVCy19MJrCSw'
  ),
  timeout_milliseconds := 60000
);
