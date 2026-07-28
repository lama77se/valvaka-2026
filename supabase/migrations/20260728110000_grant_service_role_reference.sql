-- Fas 2 följdmigration: skrivrättigheter för service_role på referenstabellerna.
--
-- Projektet har "Automatically expose new tables" AV, så nya tabeller får inga
-- automatiska grants till Data API-rollerna — inte heller service_role (som
-- PostgREST antar vid service-role-nyckel). Ingest-skriptet
-- (scripts/ingest-reference.mjs) skriver som service_role och behöver därför
-- explicit grant. RLS kringgås redan av service_role (BYPASSRLS); detta är enbart
-- table-grant, inte en policy.
grant all on party to service_role;
grant all on district to service_role;
grant all on district_comparison to service_role;
