-- =====================================================================
-- HOTFIX: "record new has no field kind" beim Pause- und Feierabend-Stempeln
--
-- Symptom
--   Mitarbeiter koennen einstempeln (Kommen), bekommen aber beim Druecken
--   von "Pause" oder "Feierabend" die Meldung
--     record "new" has no field "kind"
--   Der Chef merkt nichts, weil bei ihm die Admin-Abkuerzung im Trigger
--   greift, bevor das Feld ueberhaupt gelesen wird.
--
-- Ursache
--   Kommen  = INSERT in time_entries -> Trigger enforce_time_entry_insert,
--             der kein "kind" liest -> geht durch.
--   Pause / Feierabend = UPDATE (clock_out setzen) -> Trigger
--             enforce_time_entry_update, der new.kind und old.kind liest.
--   Die Spalte time_entries.kind fehlt in dieser Datenbank, deshalb bricht
--   PL/pgSQL genau dort ab. Die App und lib/time.ts erwarten die Spalte
--   ebenfalls (kind = 'work' | 'pause').
--
-- Dieses Skript ergaenzt die fehlenden Spalten. Es ist idempotent.
-- Im Supabase SQL Editor ausfuehren, danach wirkt es sofort - kein Deploy noetig.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Vorher: welche Spalten hat time_entries wirklich?
-- ---------------------------------------------------------------------
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'time_entries'
order by ordinal_position;


-- ---------------------------------------------------------------------
-- 2) Fehlende Spalten ergaenzen
-- ---------------------------------------------------------------------

-- Art der Buchung: 'work' = Arbeitszeit, 'pause' = Pause
alter table public.time_entries
  add column if not exists kind text not null default 'work';

update public.time_entries set kind = 'work' where kind is null;

-- Art des Segments im Korrekturantrag ('work' / 'pause')
alter table public.time_corrections
  add column if not exists entry_kind text;

-- Freischaltung des Mitarbeiters (wird in /admin geschaltet)
alter table public.profiles
  add column if not exists active boolean not null default true;

comment on column public.time_entries.kind is
  'work = Arbeitszeit, pause = Pause. Pausen reduzieren die Nettoarbeitszeit.';


-- ---------------------------------------------------------------------
-- 3) Schema-Cache von PostgREST neu laden
--
--    Die App spricht ueber PostgREST mit der Datenbank. Der kennt neue
--    Spalten erst nach einem Reload - sonst kommt beim Genehmigen eines
--    Korrekturantrags weiterhin
--      Could not find the 'kind' column of 'time_entries' in the schema cache
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- 4) Nachher: Kontrolle
-- ---------------------------------------------------------------------
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'time_entries'     and column_name in ('kind'))
    or (table_name = 'time_corrections' and column_name in ('entry_kind'))
    or (table_name = 'profiles'         and column_name in ('active'))
  )
order by table_name, column_name;

-- Verteilung der bestehenden Buchungen
select kind, count(*) from public.time_entries group by kind;
