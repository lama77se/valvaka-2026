-- Övriga partier — den RIKTIGA källan (DEL 2, efter PR #170/#171: #170 återanvände av misstag
-- ej_anmalda_partier — ett Ogiltiga röster-fält, helt fel koncept — reverterad i #171).
--
-- Verifierat mot en färsk hämtning av val.se:s riktiga data, PER DISTRIKT (212 rapporterade
-- RD-distrikt, inget undantag): vd.rostfordelning.rosterPaverkaMandat.antalRoster (distriktets
-- EGEN deklarerade totalsumma mandatrelevanta röster) är STÖRRE än summan av de itemiserade
-- partiRoster-posterna i SAMTLIGA fall. Gapet ÄR "Övriga partier" — riktiga, giltiga röster för
-- partier Valmyndigheten inte bryter ut individuellt i strömmen, men som räknas i totalen.
--
-- Samma mönster/motivering som 20260912090000_ogiltiga_roster.sql (nullable, ingen default/
-- bakfyllning — äldre rader saknar värdet tills de nästa gång upsertas av den normala
-- ingest-cykeln, ren additiv migration).
alter table turnout
  add column roster_paverkar_mandat integer;

comment on column turnout.roster_paverkar_mandat is
  'Distriktets EGEN deklarerade rosterPaverkaMandat.antalRoster (rostfordelning-JSON) — gapet mot summan av itemiserade partiRoster-poster är "Övriga partier", INTE samma sak som ej_anmalda_partier (det hör till Ogiltiga röster, se PR #170/#171).';

-- snapshot_json måste utökas i samma andetag (samma skäl som 20260912090000 dokumenterar) —
-- annars serverar CDN-bloben aldrig det nya fältet och klienten faller permanent tillbaka på
-- keyset-vägen för det. Bumpar formatversionen (v: 2 → 3).
create or replace function public.snapshot_json(p_valtyp text) returns text
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'v', 3,
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
                                          blanka, ej_anmalda_partier, ovriga_ogiltiga, roster_paverkar_mandat)
                       order by valdistriktskod)
      from public.turnout where valtyp = p_valtyp), '[]'::jsonb)
  )::text;
$$;

revoke all on function public.snapshot_json(text) from public, anon, authenticated;
grant execute on function public.snapshot_json(text) to service_role;
