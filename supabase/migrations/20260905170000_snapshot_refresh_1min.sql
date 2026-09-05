-- Snapshot-refresh varje minut (var */5). Kallstart-repetitionen 5 sep visade två hål med 5 min:
--  1. blob-regenereringen efter en ingest-körning ligger sist i samma invokering — dör körningen på
--     CPU-taket efter en tung fil (riks-RD) blir bloben inte regenererad förrän nästa touch/refresh;
--  2. refresh-anropet delade lease med ingesten och blev `busy` bakom krasch-loopen.
-- Edge-vägen `refreshSnapshots` är nu lease-fri och ingest-fri (PR F); en minuts kadens gör att en
-- blob aldrig är äldre än ~60 s oavsett vad ingesten gör. Kostnad: 3 × snapshot_json (~1–1,5 s DB)
-- + 3 uploads per minut — försumbart mot vad den sparar (klienten hoppar över blobbar > 15 min och
-- faller då till keyset-herden). cron.schedule med samma namn ersätter jobbet → idempotent.
select cron.schedule(
  'snapshot-refresh',
  '* * * * *',
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
