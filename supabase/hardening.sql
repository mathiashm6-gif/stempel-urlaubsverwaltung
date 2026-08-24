-- =====================================================================
-- Stempel-/Urlaubsverwaltung – Absicherung der Zeitaufzeichnungen
--
-- Im Supabase SQL Editor ausführen. Das Skript ist idempotent, es kann
-- also gefahrlos mehrfach laufen.
--
-- Grundregel, die hier durchgesetzt wird:
--   Zeiten werden gestempelt, nicht bearbeitet. Jede nachträgliche
--   Änderung – auch an Pausen – läuft über einen Korrekturantrag, den
--   ein Admin genehmigt. Ohne das ist die Aufzeichnung nicht
--   manipulationssicher, weil das Frontend mit dem öffentlichen
--   anon-Key arbeitet und jeder Mitarbeiter die REST-API direkt
--   ansprechen kann.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Row Level Security sicherstellen
--
--    Policies ohne aktiviertes RLS sind wirkungslos – die Tabelle ist
--    dann vollständig offen. "enable" ist idempotent.
-- ---------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.time_entries      enable row level security;
alter table public.time_corrections  enable row level security;
alter table public.vacation_requests enable row level security;
alter table public.work_models       enable row level security;

-- Kontrolle: alle Zeilen müssen true zeigen
--   select relname, relrowsecurity from pg_class
--   where relnamespace = 'public'::regnamespace and relkind = 'r';


-- ---------------------------------------------------------------------
-- 2) is_admin() absichern
--
--    security definer  -> umgeht RLS auf profiles, verhindert Rekursion
--    set search_path   -> verhindert Manipulation über den Suchpfad
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;


-- ---------------------------------------------------------------------
-- 3) Änderungen an Zeitbuchungen einschränken
--
--    Admin      : darf alles (genehmigt Korrekturanträge)
--    Mitarbeiter: darf ausschliesslich die laufende Buchung beenden,
--                 also clock_out setzen. clock_in, user_id und kind
--                 bleiben unveränderlich – auch bei Pausen.
--
--    Alles andere -> Korrekturantrag über time_corrections.
-- ---------------------------------------------------------------------
create or replace function public.enforce_time_entry_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception
      'Buchungen können nicht einem anderen Benutzer zugeordnet werden.';
  end if;

  -- Erlaubt: die offene Buchung schliessen, sonst nichts verändern
  if old.clock_out is null
     and new.clock_out is not null
     and new.clock_in is not distinct from old.clock_in
     and coalesce(new.kind, 'work') is not distinct from coalesce(old.kind, 'work')
  then
    return new;
  end if;

  raise exception
    'Zeiten können nur über einen genehmigten Korrekturantrag geändert werden.';
end;
$$;

drop trigger if exists trg_enforce_time_entry_update on public.time_entries;
create trigger trg_enforce_time_entry_update
  before update on public.time_entries
  for each row execute function public.enforce_time_entry_update();


-- ---------------------------------------------------------------------
-- 4) Neue Buchungen einschränken
--
--    Mitarbeiter dürfen nur "jetzt" einstempeln – keine rückdatierten
--    Buchungen, kein fertiges Zeitpaar. Nachträge laufen über den
--    Korrekturantrag, den der Admin genehmigt.
-- ---------------------------------------------------------------------
create or replace function public.enforce_time_entry_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if new.user_id is distinct from auth.uid() then
    raise exception
      'Buchungen können nur für den eigenen Account angelegt werden.';
  end if;

  if new.clock_out is not null then
    raise exception
      'Fertige Zeitpaare müssen über einen Korrekturantrag angelegt werden.';
  end if;

  if new.clock_in is null
     or new.clock_in < now() - interval '5 minutes'
     or new.clock_in > now() + interval '5 minutes'
  then
    raise exception
      'Der Zeitpunkt einer neuen Buchung muss die aktuelle Uhrzeit sein.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_time_entry_insert on public.time_entries;
create trigger trg_enforce_time_entry_insert
  before insert on public.time_entries
  for each row execute function public.enforce_time_entry_insert();


-- ---------------------------------------------------------------------
-- 5) Korrekturanträge: nicht vorab genehmigen, nicht für fremde Buchungen
--
--    Bisher: with check (user_id = auth.uid())
--    Damit liesse sich ein Antrag mit status = 'approved' einstellen
--    oder ein Löschantrag auf die Buchung eines Kollegen stellen, den
--    der Admin dann ahnungslos freigibt.
-- ---------------------------------------------------------------------
drop policy if exists corr_insert_own on public.time_corrections;

create policy corr_insert_own
on public.time_corrections
for insert
to authenticated
with check (
  user_id = auth.uid()
  and coalesce(status, 'pending') = 'pending'
  and (
    entry_id is null
    or exists (
      select 1 from public.time_entries te
      where te.id = time_corrections.entry_id
        and te.user_id = auth.uid()
    )
  )
);


-- ---------------------------------------------------------------------
-- 6) Urlaubsanträge: analog – nicht selbst genehmigen
-- ---------------------------------------------------------------------
drop policy if exists vac_insert_own on public.vacation_requests;

create policy vac_insert_own
on public.vacation_requests
for insert
to authenticated
with check (
  user_id = auth.uid()
  and coalesce(status, 'pending') = 'pending'
);


-- ---------------------------------------------------------------------
-- 7) Keep-alive-Tabelle
--
--    Ziel dieser Tabelle ist ausschliesslich, dem täglichen Cron
--    (app/api/keepalive/route.ts, vercel.json) etwas zum Abfragen zu
--    geben, damit Supabase das Projekt nicht wegen Inaktivität
--    pausiert. Sie enthält keine Nutzdaten.
-- ---------------------------------------------------------------------
create table if not exists public.keepalive (
  id smallint primary key default 1,
  note text default 'Wird täglich vom Cron abgefragt, damit Supabase das Projekt nicht pausiert.'
);

insert into public.keepalive (id) values (1) on conflict (id) do nothing;

alter table public.keepalive enable row level security;

drop policy if exists keepalive_select on public.keepalive;
create policy keepalive_select
on public.keepalive
for select
to anon, authenticated
using (true);


-- =====================================================================
-- Kontrolle
--
-- Mit einem Mitarbeiter-Account (nicht Admin) ausgeführt müssen die
-- folgenden Anweisungen jeweils mit einer Fehlermeldung abbrechen:
--
--   update time_entries set clock_in = clock_in - interval '2 hours'
--   where user_id = auth.uid();
--
--   insert into time_entries (user_id, clock_in, clock_out)
--   values (auth.uid(), now() - interval '1 day', now() - interval '18 hours');
--
--   insert into vacation_requests (user_id, start_date, end_date, status)
--   values (auth.uid(), current_date, current_date, 'approved');
--
-- Weiterhin funktionieren müssen: Einstempeln, Ausstempeln, das Stellen
-- von Urlaubs- und Korrekturanträgen sowie alle Admin-Funktionen.
-- =====================================================================
