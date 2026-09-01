-- =====================================================================
-- Startsalden eintragen  ·  Stichtag 01.09.2026
--
-- Vorher muss startsalden-za-und-urlaub.sql gelaufen sein (Spalten).
-- Als Admin/Chef im Supabase SQL Editor ausfuehren.
--
-- Uebergebene Werte (Summe 2025 + 2026):
--   Romana Schmalwieser  ZA 87:33 + 26:35 = 114:08 h
--                        Urlaub 65:39 + 45:05 = 110:44 h
--   Carolin Iftode       ZA 69:50 + 97:50 = 167:40 h
--                        Urlaub 5 + 26,5 = 31,5 Tage
--
-- Carolins Urlaub kommt in Tagen, gespeichert wird in Minuten. Umgerechnet
-- wird mit den durchschnittlichen Sollstunden je Arbeitstag aus ihrem
-- zugeordneten Zeitmodell (Wochenstunden / Anzahl fixer Arbeitstage).
-- Ist ihr kein Modell zugeordnet, bricht das Skript ab.
--
-- WICHTIG: Der SQL-Editor arbeitet ohne angemeldeten Benutzer, deshalb liefert
-- is_admin() hier false und der Schutz-Trigger blockt die Aenderung. Das
-- Skript schaltet den Trigger daher fuer die Dauer des Laufs ab und am Ende
-- wieder ein. Bricht etwas dazwischen ab, macht der Editor die gesamte
-- Transaktion rueckgaengig - der Trigger ist dann weiterhin aktiv.
-- Zur Sicherheit pruefen (soll "O" = enabled liefern):
--   select tgenabled from pg_trigger where tgname = 'trg_enforce_profile_update';
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0a) Welche Trigger liegen auf profiles?
-- ---------------------------------------------------------------------
select tgname,
       case tgenabled when 'O' then 'aktiv' when 'D' then 'abgeschaltet'
            else tgenabled::text end as status,
       p.proname as funktion
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'public.profiles'::regclass and not t.tgisinternal;


-- ---------------------------------------------------------------------
-- 0b) Kontrolle vorab: welches Zeitmodell haengt an wem?
-- ---------------------------------------------------------------------
select p.full_name, p.email, w.name as zeitmodell,
       w.monday_hours, w.tuesday_hours, w.wednesday_hours, w.thursday_hours,
       w.friday_hours, w.saturday_hours, w.sunday_hours
from public.profiles p
left join public.work_models w on w.id = p.work_model_id
where p.email in ('office@imkerei-seiringer.com', 'carolin@imkerei-seiringer.com');


-- ---------------------------------------------------------------------
-- 1) Schutz-Trigger fuer diesen Lauf abschalten
-- ---------------------------------------------------------------------
-- Es koennen mehrere Trigger auf profiles liegen (auch aus aelteren
-- Migrationen unter anderem Namen), die alle dieselbe Pruefung aufrufen.
-- Deshalb werden hier ALLE eigenen Trigger der Tabelle abgeschaltet.
do $$
declare t record;
begin
  for t in
    select tgname from pg_trigger
    where tgrelid = 'public.profiles'::regclass and not tgisinternal
  loop
    execute format('alter table public.profiles disable trigger %I', t.tgname);
    raise notice 'Trigger abgeschaltet: %', t.tgname;
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 2) Romana Schmalwieser – beide Werte liegen in Stunden vor
-- ---------------------------------------------------------------------
update public.profiles set
  opening_balance           = 114 * 60 + 8,    -- 114:08 h
  opening_balance_date      = date '2026-09-01',
  vacation_opening_balance  = 110 * 60 + 44,   -- 110:44 h
  vacation_opening_date     = date '2026-09-01'
where email = 'office@imkerei-seiringer.com';


-- ---------------------------------------------------------------------
-- 3) Carolin Iftode – ZA in Stunden, Urlaub aus 31,5 Tagen umgerechnet
-- ---------------------------------------------------------------------
do $$
declare
  v_id        uuid;
  v_weekly    numeric;
  v_days      integer;
  v_per_day   numeric;
  v_minutes   integer;
  v_model     text;
begin
  select p.id, w.name,
         coalesce(w.monday_hours,0) + coalesce(w.tuesday_hours,0)
       + coalesce(w.wednesday_hours,0) + coalesce(w.thursday_hours,0)
       + coalesce(w.friday_hours,0) + coalesce(w.saturday_hours,0)
       + coalesce(w.sunday_hours,0),
         (case when coalesce(w.monday_hours,0)    > 0 then 1 else 0 end)
       + (case when coalesce(w.tuesday_hours,0)   > 0 then 1 else 0 end)
       + (case when coalesce(w.wednesday_hours,0) > 0 then 1 else 0 end)
       + (case when coalesce(w.thursday_hours,0)  > 0 then 1 else 0 end)
       + (case when coalesce(w.friday_hours,0)    > 0 then 1 else 0 end)
       + (case when coalesce(w.saturday_hours,0)  > 0 then 1 else 0 end)
       + (case when coalesce(w.sunday_hours,0)    > 0 then 1 else 0 end)
    into v_id, v_model, v_weekly, v_days
  from public.profiles p
  left join public.work_models w on w.id = p.work_model_id
  where p.email = 'carolin@imkerei-seiringer.com';

  if v_id is null then
    raise exception 'Profil carolin@imkerei-seiringer.com nicht gefunden.';
  end if;

  if v_days is null or v_days = 0 then
    raise exception
      'Carolin hat kein Zeitmodell mit Arbeitstagen. Zuerst in der Verwaltung ein Zeitmodell zuordnen, dann dieses Skript erneut ausfuehren.';
  end if;

  v_per_day := v_weekly / v_days;
  v_minutes := round(31.5 * v_per_day * 60);

  update public.profiles set
    opening_balance           = 167 * 60 + 40,   -- 167:40 h
    opening_balance_date      = date '2026-09-01',
    vacation_opening_balance  = v_minutes,
    vacation_opening_date     = date '2026-09-01'
  where id = v_id;

  raise notice
    'Carolin: Modell % · % h/Woche auf % Arbeitstage = % h/Tag -> 31,5 Tage = % Minuten (%:%)',
    v_model, v_weekly, v_days, round(v_per_day, 2), v_minutes,
    v_minutes / 60, lpad((v_minutes % 60)::text, 2, '0');
end $$;


-- ---------------------------------------------------------------------
-- 4) Schutz-Trigger wieder einschalten
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select tgname from pg_trigger
    where tgrelid = 'public.profiles'::regclass and not tgisinternal
  loop
    execute format('alter table public.profiles enable trigger %I', t.tgname);
    raise notice 'Trigger wieder aktiv: %', t.tgname;
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 5) Ergebnis pruefen (Anzeige als h:mm)
-- ---------------------------------------------------------------------
select p.full_name,
       (p.opening_balance / 60) || ':' ||
         lpad((p.opening_balance % 60)::text, 2, '0')          as za_startsaldo,
       p.opening_balance_date                                   as za_stichtag,
       (p.vacation_opening_balance / 60) || ':' ||
         lpad((p.vacation_opening_balance % 60)::text, 2, '0')  as urlaub_startsaldo,
       p.vacation_opening_date                                  as urlaub_stichtag,
       w.name                                                   as zeitmodell
from public.profiles p
left join public.work_models w on w.id = p.work_model_id
where p.vacation_opening_date is not null or p.opening_balance_date is not null
order by p.full_name;
