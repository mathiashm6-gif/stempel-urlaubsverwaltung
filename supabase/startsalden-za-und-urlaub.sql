-- =====================================================================
-- Startsalden: Zeitausgleich und Urlaub (Uebernahme aus dem Altsystem)
--
-- Im Supabase SQL Editor ausfuehren. Das Skript ist idempotent.
--
-- Hintergrund
--   Beim Umstieg auf das Stempeltool bringen die Mitarbeiter bestehende
--   Staende mit: ein Zeitausgleichs-Guthaben und einen Resturlaub.
--   Beides wird als **Startsaldo zu einem Stichtag** hinterlegt.
--
--   Ab dem Stichtag rechnet das Tool selbst weiter:
--     ZA-Kontostand = Startsaldo + Summe(Ist - Soll) ab Stichtag
--     Urlaubsrest   = Startsaldo + Ansprueche der Folgejahre - Verbrauch ab Stichtag
--
--   Ohne Stichtag verhaelt sich alles wie bisher (Jahresbetrachtung).
--
--   Beide Salden werden in **Minuten** gespeichert (ganzzahlig, auch
--   negativ). Der Urlaub wird damit in Stunden gefuehrt - noetig, weil
--   Teilzeitmodelle unterschiedlich lange Arbeitstage haben und ein
--   "Urlaubstag" dann keine einheitliche Groesse mehr ist.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Spalten am Profil
-- ---------------------------------------------------------------------

-- Zeitausgleich: Startsaldo in Minuten (kann negativ sein) + Stichtag
alter table public.profiles
  add column if not exists opening_balance integer not null default 0;

alter table public.profiles
  add column if not exists opening_balance_date date;

-- Urlaub: Startsaldo in Minuten + Stichtag
alter table public.profiles
  add column if not exists vacation_opening_balance integer not null default 0;

alter table public.profiles
  add column if not exists vacation_opening_date date;

comment on column public.profiles.opening_balance is
  'Zeitausgleich-Startsaldo in Minuten zum Stichtag opening_balance_date.';
comment on column public.profiles.opening_balance_date is
  'Stichtag des ZA-Startsaldos. Ab diesem Tag rechnet das Stundenkonto weiter.';
comment on column public.profiles.vacation_opening_balance is
  'Urlaubs-Startsaldo in Minuten zum Stichtag vacation_opening_date.';
comment on column public.profiles.vacation_opening_date is
  'Stichtag des Urlaubs-Startsaldos. Verbrauch wird ab diesem Tag gezaehlt.';

-- Bestehende NULL-Werte aus einer aelteren Migration glattziehen
update public.profiles set opening_balance = 0 where opening_balance is null;
update public.profiles set vacation_opening_balance = 0 where vacation_opening_balance is null;


-- ---------------------------------------------------------------------
-- 2) Startsalden sind Stammdaten - nur der Admin darf sie aendern
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

  if new.role                     is distinct from old.role
     or new.vacation_days          is distinct from old.vacation_days
     or new.work_model_id          is distinct from old.work_model_id
     or new.entry_date             is distinct from old.entry_date
     or new.active                 is distinct from old.active
     or new.opening_balance        is distinct from old.opening_balance
     or new.opening_balance_date   is distinct from old.opening_balance_date
     or new.vacation_opening_balance is distinct from old.vacation_opening_balance
     or new.vacation_opening_date  is distinct from old.vacation_opening_date
  then
    raise exception
      'Stammdaten (Rolle, Urlaubsanspruch, Zeitmodell, Eintrittsdatum, Freischaltung, Startsalden) aendert nur ein Admin.';
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
--   select email, full_name,
--          opening_balance, opening_balance_date,
--          vacation_opening_balance, vacation_opening_date
--   from public.profiles order by full_name;
--
-- Mit einem Mitarbeiter-Account muss Folgendes mit Fehler abbrechen:
--   update profiles set opening_balance = 9999 where id = auth.uid();
-- =====================================================================
