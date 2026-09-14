-- personroster_top: lägg till valfri offset (p_offset, default 0) för sidnumrering i
-- PersonrosterPanel.tsx — v1 (20260914190000_personroster_rpc.sql) hade medvetet bara
-- LIMIT, ingen offset (Lars förenklade specen 14 sep). Lars efterfrågade nu faktisk
-- sidbläddring i UI:t ("bara topp 10, var är pagineringen?") — lägger till stödet här.
--
-- OBS: en extra parameter ÄR en ny funktionssignatur för Postgres (argumentlistans
-- TYPER, inte bara namn/default, avgör identitet) — CREATE OR REPLACE på den nya
-- 6-parameterslistan hade annars bara lagt till en ANDRA, överlagrad funktion vid sidan
-- av 5-parametersversionen (PostgREST hanterar överlagrade RPC:er dåligt — "Could not
-- choose the best candidate function" är ett vanligt symptom). Släng den gamla explicit
-- innan den nya skapas. Klienten (personroster.ts) anropar alltid med namngivna
-- parametrar → tillägget av p_offset (default 0) är annars bakåtkompatibelt.
-- personroster_search rörs INTE (Lars ville bara ha paginering på topplistan, inte
-- namnsökningen — en sökning man skriver om är redan sin egen "omstart").
drop function if exists public.personroster_top(text, text, text, text, integer);

create or replace function public.personroster_top(
  p_valtyp text,
  p_niva text,
  p_omradeskod text,
  p_partikod text default null,
  p_limit integer default 10,
  p_offset integer default 0
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
          (p_valtyp = 'RD' and lpad(d.vk_rd, 2, '0') = p_omradeskod)
          or (p_valtyp = 'RF' and lpad(d.vk_rf, 4, '0') = p_omradeskod)
          or (p_valtyp = 'KF' and lpad(d.vk_kf, 6, '0') = p_omradeskod)
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
  order by antal_personroster desc, c.partikod, c.kandidatnummer -- stabil ordning över sidor (annars kan lika antal_personroster byta plats mellan sidor)
  limit p_limit
  offset p_offset;
$$;

grant execute on function public.personroster_top(text, text, text, text, integer, integer) to anon, authenticated;
