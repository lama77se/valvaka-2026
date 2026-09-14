-- Personröster — områdesskopade RPC-funktioner (handover 14 sep, spec via Val ANALYSIS,
-- Lars beslut 1: SECURITY INVOKER RPC med live-aggregering, INTE en materialiserad vy
-- eller en förberäknad rollup-tabell — ett lagrat facit hade introducerat EXAKT den
-- bugklass kvällen redan jagat två gånger, "någon ändrar datavägen och glömmer hålla
-- synk-mekanismen uppdaterad". Live-aggregering kan aldrig bli inaktuell eftersom den
-- inte lagrar något separat att tappa synk med.
--
-- SECURITY INVOKER (inte DEFINER): personroster/uppsamling_personroster/district är redan
-- fullt publikt läsbara (samma RLS-policy som allt annat referens-/resultatdata i appen) —
-- ingen anledning att köra med förhöjd behörighet.
--
-- Områdesupplösning SPEGLAR districtsInArea (aggregate.ts) EXAKT, inte district-tabellens
-- egna lanskod/kommunkod-kolumner: de kolumnerna saknar (bekräftat 14 sep) sina inledande
-- nollor ("3"/"380" i stället för "03"/"0380") — en tyst datakvalitetslucka som ALDRIG
-- syntes förut eftersom klienten redan undviker dem (region/kommun härleds ur
-- valdistriktskodens EGNA, garanterat rättpaddade 2/4 första tecken; bara valkrets-nivån
-- litar på en district-kolumn, och då vk_rd/vk_rf/vk_kf — som ANVÄNDS konsekvent
-- opaddade genomgående, självkonsekvent med hur klienten redan populerar sina egna
-- valkrets-kodlistor ur SAMMA kolumner). Samma mönster återanvänds här:
--   'riket'    → alla distrikt (bara RD, ingen riksnivå för RF/KF — Lars beslut 2)
--   'region'   → left(valdistriktskod, 2) = områdeskod
--   'kommun'   → left(valdistriktskod, 4) = områdeskod
--   'valkrets' → district.vk_rd/vk_rf/vk_kf = områdeskod (beroende på valtyp)
--
-- Uppsamling vägs in enligt SAMMA princip som uppsamlingForArea/UppsamlingBuckets
-- (aggregate.ts) redan använder för röster (handover 14 sep, Lars förtydligande: gäller
-- ALLA nivåer, inte bara kryssspärrens nämnare) — ALDRIG omimplementerad från scratch:
--   'riket'/'region'/'kommun' (organnivå) → HELA organets uppsamling, oavsett om
--     kretskod är löst eller ej (speglar uppsamling.byOrgan — den fulla hinken).
--   'valkrets' → BARA uppsamling där kretskod ÄR löst till just DEN valkretsen
--     (speglar uppsamling.byValkrets — olösta bidrar aldrig till en specifik valkrets).
--
-- kandidatnummer+partikod grupperas ALDRIG med namn i samma nyckel (namn-fällan, se
-- personroster-migrationens kommentar) — namn är bara en visningssträng, max(namn) väljer
-- en deterministisk representant. ⚠️ Känd v1-begränsning: om samma kandidat har olika
-- stavning i olika rader (bekräftat förekommer, se personroster-migrationen) OCH
-- personroster_search filtrerar på namn, kan resultatets antal_personroster undervärdera
-- kandidatens verkliga totalsumma något (bara rader vars stavning matchar sökningen
-- räknas in) — kandidaten missas dock aldrig helt så länge MINST en stavning matchar.
-- Accepterat för v1 (Val ANALYSIS/Lars, "prefix-/enkel ILIKE räcker") — en tvåstegs
-- match-sedan-summera-fullt-variant kan läggas till om det visar sig behövas.
--
-- ⚠️ Kryssspärr (Lars beslut 3) byggs INTE här — bekräftat 14 sep (Lars, exempel Jimmie
-- Åkesson i data) att en kandidat kan stå på FLERA valkretsars listor samtidigt (t.ex.
-- rikslistekandidater), så "kandidatens EGNA valkrets" inte alltid är entydig vid en
-- organnivå-aggregering över flera valkretsar. personroster_top/search summerar redan
-- KORREKT över hela det efterfrågade området (det är rätt för TOPPLISTAN), men
-- kryssspärr-badgen kräver PER-VALKRETS-evaluering och kommer i en separat, uppföljande
-- migration/RPC skopad till just 'valkrets'-nivå, där "egen valkrets" är entydig.

create or replace function public.personroster_top(
  p_valtyp text,
  p_niva text,
  p_omradeskod text,
  p_partikod text default null,
  p_limit integer default 10
)
returns table (
  partikod text,
  kandidatnummer integer,
  namn text,
  antal_personroster bigint
)
language sql
security invoker
stable
set search_path = ''
as $$
  with geo as (
    select pr.partikod, pr.kandidatnummer, pr.namn, pr.antal_personroster
    from public.personroster pr
    left join public.district d on d.valdistriktskod = pr.valdistriktskod and p_niva = 'valkrets'
    where pr.valtyp = p_valtyp
      and (p_partikod is null or pr.partikod = p_partikod)
      and (
        (p_niva = 'riket' and p_valtyp = 'RD')
        or (p_niva = 'region' and left(pr.valdistriktskod, 2) = p_omradeskod)
        or (p_niva = 'kommun' and left(pr.valdistriktskod, 4) = p_omradeskod)
        or (p_niva = 'valkrets' and (
          (p_valtyp = 'RD' and d.vk_rd = p_omradeskod)
          or (p_valtyp = 'RF' and d.vk_rf = p_omradeskod)
          or (p_valtyp = 'KF' and d.vk_kf = p_omradeskod)
        ))
      )
  ),
  upp as (
    select up.partikod, up.kandidatnummer, up.namn, up.antal_personroster
    from public.uppsamling_personroster up
    where up.valtyp = p_valtyp
      and (p_partikod is null or up.partikod = p_partikod)
      and (
        (p_niva = 'riket' and p_valtyp = 'RD')
        or (p_niva = 'region' and up.lankod = p_omradeskod)
        or (p_niva = 'kommun' and up.kommunkod = p_omradeskod)
        or (p_niva = 'valkrets' and up.kretskod = p_omradeskod)
      )
  )
  select c.partikod, c.kandidatnummer, max(c.namn) as namn, sum(c.antal_personroster)::bigint as antal_personroster
  from (select * from geo union all select * from upp) c
  group by c.partikod, c.kandidatnummer
  order by antal_personroster desc
  limit p_limit;
$$;

-- Samma områdes-/uppsamlingsupplösning som personroster_top, plus ett namnfilter. Prefix-
-- ILIKE (v1, se Val ANALYSIS beslut 4) — räcker gott: scopat till ETT område (aldrig hela
-- tabellen), så prestanda är aldrig en fråga oavsett indexläge.
create or replace function public.personroster_search(
  p_valtyp text,
  p_niva text,
  p_omradeskod text,
  p_query text,
  p_limit integer default 20
)
returns table (
  partikod text,
  kandidatnummer integer,
  namn text,
  antal_personroster bigint
)
language sql
security invoker
stable
set search_path = ''
as $$
  with geo as (
    select pr.partikod, pr.kandidatnummer, pr.namn, pr.antal_personroster
    from public.personroster pr
    left join public.district d on d.valdistriktskod = pr.valdistriktskod and p_niva = 'valkrets'
    where pr.valtyp = p_valtyp
      and pr.namn ilike p_query || '%'
      and (
        (p_niva = 'riket' and p_valtyp = 'RD')
        or (p_niva = 'region' and left(pr.valdistriktskod, 2) = p_omradeskod)
        or (p_niva = 'kommun' and left(pr.valdistriktskod, 4) = p_omradeskod)
        or (p_niva = 'valkrets' and (
          (p_valtyp = 'RD' and d.vk_rd = p_omradeskod)
          or (p_valtyp = 'RF' and d.vk_rf = p_omradeskod)
          or (p_valtyp = 'KF' and d.vk_kf = p_omradeskod)
        ))
      )
  ),
  upp as (
    select up.partikod, up.kandidatnummer, up.namn, up.antal_personroster
    from public.uppsamling_personroster up
    where up.valtyp = p_valtyp
      and up.namn ilike p_query || '%'
      and (
        (p_niva = 'riket' and p_valtyp = 'RD')
        or (p_niva = 'region' and up.lankod = p_omradeskod)
        or (p_niva = 'kommun' and up.kommunkod = p_omradeskod)
        or (p_niva = 'valkrets' and up.kretskod = p_omradeskod)
      )
  )
  select c.partikod, c.kandidatnummer, max(c.namn) as namn, sum(c.antal_personroster)::bigint as antal_personroster
  from (select * from geo union all select * from upp) c
  group by c.partikod, c.kandidatnummer
  order by antal_personroster desc
  limit p_limit;
$$;

-- Sammansatt index för de vanliga aggregeringsformerna (Val ANALYSIS beslut 1): valtyp+
-- partikod+kandidatnummer täcker GROUP BY-vägen, valdistriktskod sist för region/kommun-
-- prefixmatchningen (left()-uttryck kan inte använda ett vanligt btree-index för PREFIX-
-- sökning i sig, men valdistriktskod-kolumnen används ändå av `left(valdistriktskod,2/4)`
-- via en sekventiell scan begränsad av valtyp/partikod först — bounded per område oavsett).
create index if not exists personroster_valtyp_parti_kandidat_idx
  on public.personroster (valtyp, partikod, kandidatnummer, valdistriktskod);
create index if not exists uppsamling_personroster_valtyp_parti_kandidat_idx
  on public.uppsamling_personroster (valtyp, partikod, kandidatnummer);

-- PostgREST RPC kräver explicit EXECUTE-grant (utöver SELECT på de underliggande
-- tabellerna, redan beviljat i respektive tabells egen migration).
grant execute on function public.personroster_top(text, text, text, text, integer) to anon, authenticated;
grant execute on function public.personroster_search(text, text, text, text, integer) to anon, authenticated;
