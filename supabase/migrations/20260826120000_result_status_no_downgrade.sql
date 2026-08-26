-- Skydda den slutliga räkningen. När slutliga resultatfiler börjar ingestas (dagar
-- efter valnatten, från onsdagsräkningen) ska de INTE kunna skrivas över av en sen
-- preliminär re-ingest — den preliminära filen kan råka publiceras om efter att den
-- slutliga kommit. En BEFORE UPDATE-trigger hoppar över just den nedgraderingen
-- (status 'slutlig' → 'preliminar'); raden behåller sina slutliga värden.
--
-- Släpps igenom som vanligt: preliminär → preliminär (valnatten) och preliminär →
-- slutlig (uppgraderingen när sluträkningen kommer). Under valnatten är alla rader
-- preliminära, så triggern är då en no-op.
create or replace function public.result_no_status_downgrade()
returns trigger
language plpgsql
as $$
begin
  if OLD.status = 'slutlig' and NEW.status is distinct from 'slutlig' then
    return null; -- hoppa över uppdateringen → behåll den slutliga raden
  end if;
  return NEW;
end;
$$;

drop trigger if exists result_no_status_downgrade on public.result;
create trigger result_no_status_downgrade
  before update on public.result
  for each row
  execute function public.result_no_status_downgrade();
