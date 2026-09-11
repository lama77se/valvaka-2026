-- Ogiltiga röster per distrikt — val.se:s rostfordelnings-JSON har detta som en syskon-nyckel
-- till partirösterna vi redan ingest:ar (vd.rostfordelning.rosterEjPaverkaMandat), men vi har
-- hittills kastat den. Verifierad mot en riktig 2022-fil (val2022/s/rf/…10_RF.zip):
--   rostfordelning.rosterEjPaverkaMandat: {
--     antalRoster,                              -- summan av de tre nedan
--     rosterEjAnmaltDeltagande: { antalRoster }, -- "Ej anmälda partier"
--     blankaRoster:             { antalRoster }, -- "Blanka"
--     ovrigaOgiltiga:           { antalRoster }, -- "Övriga ogiltiga"
--   }
-- Samma grain/nämnare-logik som turnout (bara REGULJÄRA distrikt, ej uppsamling — se
-- 20260901090000_turnout.sql:s kommentar, samma skäl gäller här). Nullable: äldre rader
-- (ingest:ade innan denna migration deployats) saknar värden tills de nästa gång upsertas,
-- ingen bakfylld default att gissa på.
alter table turnout
  add column blanka             integer,
  add column ej_anmalda_partier integer,
  add column ovriga_ogiltiga    integer;

comment on column turnout.blanka is 'Blanka röster i distriktet (rostfordelning.rosterEjPaverkaMandat.blankaRoster.antalRoster)';
comment on column turnout.ej_anmalda_partier is 'Röster på partier som inte anmält deltagande (…rosterEjAnmaltDeltagande.antalRoster)';
comment on column turnout.ovriga_ogiltiga is 'Övriga ogiltiga röster (…ovrigaOgiltiga.antalRoster)';

-- snapshot_json (se 20260905150000_snapshot_blobs.sql) måste utökas i samma andetag — annars
-- serverar CDN-bloben aldrig de nya fälten och klienten faller permanent tillbaka på keyset-
-- vägen för dem. Bumpar formatversionen (v: 1 → 2) så klienten kan skilja på gamla/nya blobbar
-- under den korta övergången (nästa 1-min-refresh regenererar alla tre inom en minut).
create or replace function public.snapshot_json(p_valtyp text) returns text
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'v', 2,
    'valtyp', p_valtyp,
    'generated_at', now(),
    'hwm', coalesce((select max(updated_at) from public.result where valtyp = p_valtyp), 'epoch'::timestamptz),
    'turnout_hwm', coalesce((select max(updated_at) from public.turnout where valtyp = p_valtyp), 'epoch'::timestamptz),
    'result', coalesce((
      select jsonb_agg(jsonb_build_array(valdistriktskod, partikod, roster, status, rapporteringstid)
                       order by valdistriktskod, partikod)
      from public.result where valtyp = p_valtyp), '[]'::jsonb),
    'turnout', coalesce((
      select jsonb_agg(jsonb_build_array(valdistriktskod, totalt_antal_roster, antal_rostberattigade,
                                          blanka, ej_anmalda_partier, ovriga_ogiltiga)
                       order by valdistriktskod)
      from public.turnout where valtyp = p_valtyp), '[]'::jsonb)
  )::text;
$$;

revoke all on function public.snapshot_json(text) from public, anon, authenticated;
grant execute on function public.snapshot_json(text) to service_role;
