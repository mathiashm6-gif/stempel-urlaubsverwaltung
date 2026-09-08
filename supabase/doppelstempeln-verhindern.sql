-- =====================================================================
-- Doppeltes Einstempeln verhindern (Datenbankseite)
--
-- Die App prueft vor dem Kommen zwar den Serverstand, aber zwei Tabs, zwei
-- Geraete oder ein schneller Doppelklick koennen trotzdem gleichzeitig
-- einfuegen. Nur die Datenbank kann das sicher ausschliessen:
--   1) Altlasten bereinigen (mehrere offene Buchungen je Benutzer)
--   2) Teil-Unique-Index: je Benutzer hoechstens EINE offene Arbeitsbuchung
--   3) Insert-Trigger mit verstaendlicher Fehlermeldung
--   4) Plausibilitaet: Geht nie vor Kommt
--
-- Idempotent. Im Supabase SQL Editor ausfuehren; wirkt sofort, kein Deploy
-- noetig (die App faengt den Fehler 23505 bzw. die Meldung ab).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Diagnose: wer hat mehr als eine offene Arbeitsbuchung?
-- ---------------------------------------------------------------------
select te.user_id, p.email, count(*) as offene, min(te.clock_in) as aelteste,
       max(te.clock_in) as neueste
from public.time_entries te
left join public.profiles p on p.id = te.user_id
where te.clock_out is null
  and coalesce(te.kind, 'work') = 'work'
group by te.user_id, p.email
having count(*) > 1;


-- ---------------------------------------------------------------------
-- 2) Bereinigung: je Benutzer bleibt nur die NEUESTE offene Buchung offen.
--    Aeltere Duplikate werden mit Dauer 0 geschlossen (clock_out = clock_in),
--    damit keine Phantomstunden entstehen. Echte Zeiten dann ueber die
--    Zeitkorrektur nachtragen.
--    Hinweis: dieser Update ist auch ohne Admin-Session erlaubt, weil der
--    Trigger enforce_time_entry_update "offene Buchung schliessen" zulaesst.
-- ---------------------------------------------------------------------
with ranked as (
  select id,
         row_number() over (partition by user_id order by clock_in desc, created_at desc) as rn
  from public.time_entries
  where clock_out is null
    and coalesce(kind, 'work') = 'work'
)
update public.time_entries te
set clock_out = te.clock_in
from ranked r
where r.id = te.id and r.rn > 1;


-- ---------------------------------------------------------------------
-- 3) Hoechstens eine offene Arbeitsbuchung je Benutzer (Race-sicher).
--    Verstoss -> SQLSTATE 23505 (unique_violation); die App zeigt dann
--    "Du bist bereits eingestempelt".
-- ---------------------------------------------------------------------
create unique index if not exists time_entries_one_open_per_user
  on public.time_entries (user_id)
  where clock_out is null and coalesce(kind, 'work') = 'work';


-- ---------------------------------------------------------------------
-- 4) Geht nie vor Kommt.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'time_entries_out_after_in'
      and conrelid = 'public.time_entries'::regclass
  ) then
    alter table public.time_entries
      add constraint time_entries_out_after_in
      check (clock_out is null or clock_out >= clock_in);
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 5) Insert-Trigger: gleiche Regeln wie bisher (hardening.sql), zusaetzlich
--    eine klare Meldung beim doppelten Kommen – fuer alle, auch Admins.
-- ---------------------------------------------------------------------
create or replace function public.enforce_time_entry_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Neue OFFENE Arbeitsbuchung, obwohl schon eine offen ist -> ablehnen.
  if new.clock_out is null
     and coalesce(new.kind, 'work') = 'work'
     and exists (
       select 1 from public.time_entries te
       where te.user_id = new.user_id
         and te.clock_out is null
         and coalesce(te.kind, 'work') = 'work'
     )
  then
    raise exception
      'Bereits eingestempelt: es gibt noch eine offene Buchung.';
  end if;

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
-- 6) Kontrolle
-- ---------------------------------------------------------------------
select indexname, indexdef
from pg_indexes
where tablename = 'time_entries' and indexname = 'time_entries_one_open_per_user';

select user_id, count(*) as offene
from public.time_entries
where clock_out is null and coalesce(kind, 'work') = 'work'
group by user_id
having count(*) > 1;   -- muss leer sein
