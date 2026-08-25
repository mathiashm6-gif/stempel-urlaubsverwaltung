-- =====================================================================
-- Fixe Arbeitstage im Zeitmodell + aliquoter Urlaubsanspruch
--
-- Im Supabase SQL Editor ausführen. Das Skript ist idempotent.
--
-- Was es macht:
--   1) work_models: Stundenspalten absichern (Default 0, kein NULL mehr)
--      Ein Wochentag mit Stunden > 0 ist ein fixer Arbeitstag des Modells.
--      Ein Wochentag mit 0 Stunden ist kein Arbeitstag und zählt daher
--      weder beim Soll noch beim Urlaubsverbrauch.
--   2) profiles.entry_date: Eintrittsdatum, Basis der Aliquotierung
--   3) Schreibrechte auf work_models nur für Admins
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Zeitmodelle: Stunden je Wochentag sauber defaulten
-- ---------------------------------------------------------------------
do $$
declare
  col text;
begin
  foreach col in array array[
    'monday_hours','tuesday_hours','wednesday_hours','thursday_hours',
    'friday_hours','saturday_hours','sunday_hours'
  ]
  loop
    execute format(
      'alter table public.work_models add column if not exists %I numeric(4,2)', col);
    execute format(
      'update public.work_models set %I = 0 where %I is null', col, col);
    execute format(
      'alter table public.work_models alter column %I set default 0', col);
    execute format(
      'alter table public.work_models alter column %I set not null', col);
  end loop;
end $$;

-- Optionale Beispielmodelle (nur anlegen, wenn der Name noch nicht existiert)
insert into public.work_models
  (name, monday_hours, tuesday_hours, wednesday_hours, thursday_hours,
   friday_hours, saturday_hours, sunday_hours)
select v.name, v.mo, v.di, v.mi, v.do_, v.fr, v.sa, v.so
from (values
  ('Vollzeit 38,5 h (Mo-Fr)', 8.0, 8.0, 8.0, 8.0, 6.5, 0, 0),
  ('Teilzeit 30 h (Mo-Do)',   7.5, 7.5, 7.5, 7.5, 0,   0, 0),
  ('Teilzeit 20 h (Mo/Mi/Fr)',7.0, 0,   7.0, 0,   6.0, 0, 0)
) as v(name, mo, di, mi, do_, fr, sa, so)
where not exists (
  select 1 from public.work_models w where w.name = v.name
);


-- ---------------------------------------------------------------------
-- 2) Eintrittsdatum am Profil
--
--    Leer  -> ganzjährig beschäftigt, voller Jahresanspruch
--    Datum -> im Eintrittsjahr wird tagesgenau aliquotiert:
--             Anspruch = Jahresanspruch × (beschäftigte Kalendertage / 365)
--             aufgerundet auf halbe Tage
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists entry_date date;

-- Für später, falls Austritte abgebildet werden sollen (die App liest die
-- Spalte bereits optional, die Oberfläche pflegt sie noch nicht):
-- alter table public.profiles add column if not exists exit_date date;


-- ---------------------------------------------------------------------
-- 3) Zeitmodelle dürfen nur Admins ändern
--
--    Lesen muss jeder angemeldete Benutzer, sonst kann das Dashboard das
--    eigene Tagessoll nicht berechnen.
-- ---------------------------------------------------------------------
alter table public.work_models enable row level security;

drop policy if exists wm_select_all on public.work_models;
create policy wm_select_all
on public.work_models
for select
to authenticated
using (true);

drop policy if exists wm_write_admin on public.work_models;
create policy wm_write_admin
on public.work_models
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());


-- ---------------------------------------------------------------------
-- 4) Stammdaten schützen
--
--    Urlaubsanspruch, Eintrittsdatum, Zeitmodell und Rolle entscheiden
--    über Ansprüche – ein Mitarbeiter darf sie nicht selbst setzen.
-- ---------------------------------------------------------------------
create or replace function public.enforce_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if new.role            is distinct from old.role
     or new.vacation_days is distinct from old.vacation_days
     or new.work_model_id is distinct from old.work_model_id
     or new.entry_date    is distinct from old.entry_date
     or new.active        is distinct from old.active
  then
    raise exception
      'Stammdaten (Rolle, Urlaubsanspruch, Zeitmodell, Eintrittsdatum, Freischaltung) ändert nur ein Admin.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_profile_update on public.profiles;
create trigger trg_enforce_profile_update
  before update on public.profiles
  for each row execute function public.enforce_profile_update();


-- =====================================================================
-- Kontrolle
--
--   select name, monday_hours, tuesday_hours, wednesday_hours,
--          thursday_hours, friday_hours, saturday_hours, sunday_hours
--   from work_models order by name;
--
--   select email, vacation_days, entry_date from profiles order by email;
--
-- Mit einem Mitarbeiter-Account muss Folgendes mit Fehler abbrechen:
--   update profiles set vacation_days = 99 where id = auth.uid();
-- =====================================================================
