-- =====================================================================
-- Schema-Check: erwartet die App vs. was die Datenbank wirklich hat
--
-- Nur lesend, aendert nichts. Im Supabase SQL Editor ausfuehren und die
-- Ausgabe der ersten Abfrage anschauen: alles mit "FEHLT" muss ergaenzt
-- werden, sonst bricht die App an genau dieser Stelle ab - so wie bei
-- time_entries.kind (Pause / Feierabend) am 02.09.2026.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Erwartete Spalten abgleichen
-- ---------------------------------------------------------------------
with erwartet(tabelle, spalte, wofuer) as (values
  -- profiles
  ('profiles','id','Benutzer-ID'),
  ('profiles','email','Anzeige in Verwaltung'),
  ('profiles','full_name','Anzeige'),
  ('profiles','role','admin / employee'),
  ('profiles','vacation_days','Jahresanspruch Urlaub'),
  ('profiles','work_model_id','Zeitmodell'),
  ('profiles','active','Freischaltung'),
  ('profiles','entry_date','Eintrittsdatum, Aliquotierung'),
  ('profiles','opening_balance','ZA-Startsaldo (Minuten)'),
  ('profiles','opening_balance_date','Stichtag ZA'),
  ('profiles','vacation_opening_balance','Urlaubs-Startsaldo (Minuten)'),
  ('profiles','vacation_opening_date','Stichtag Urlaub'),
  -- work_models
  ('work_models','id','Zeitmodell'),
  ('work_models','name','Zeitmodell'),
  ('work_models','monday_hours','Tagessoll Montag'),
  ('work_models','tuesday_hours','Tagessoll Dienstag'),
  ('work_models','wednesday_hours','Tagessoll Mittwoch'),
  ('work_models','thursday_hours','Tagessoll Donnerstag'),
  ('work_models','friday_hours','Tagessoll Freitag'),
  ('work_models','saturday_hours','Tagessoll Samstag'),
  ('work_models','sunday_hours','Tagessoll Sonntag'),
  -- time_entries
  ('time_entries','id','Buchung'),
  ('time_entries','user_id','Buchung'),
  ('time_entries','clock_in','Kommen'),
  ('time_entries','clock_out','Gehen / Pause'),
  ('time_entries','created_at','Tagesfilter im Dashboard'),
  ('time_entries','kind','work / pause - Trigger beim Ausstempeln'),
  -- vacation_requests
  ('vacation_requests','id','Abwesenheitsantrag'),
  ('vacation_requests','user_id','Abwesenheitsantrag'),
  ('vacation_requests','start_date','Zeitraum'),
  ('vacation_requests','end_date','Zeitraum'),
  ('vacation_requests','status','pending / approved / rejected'),
  ('vacation_requests','type','Urlaub, Krankheit, Arzt, ...'),
  ('vacation_requests','created_at','Sortierung'),
  -- time_corrections
  ('time_corrections','id','Korrekturantrag'),
  ('time_corrections','user_id','Korrekturantrag'),
  ('time_corrections','entry_id','betroffene Buchung (uuid)'),
  ('time_corrections','kind','create / edit / delete'),
  ('time_corrections','entry_kind','work / pause des Segments'),
  ('time_corrections','target_date','Tag der Korrektur'),
  ('time_corrections','requested_clock_in','gewuenschtes Kommen'),
  ('time_corrections','requested_clock_out','gewuenschtes Gehen'),
  ('time_corrections','reason','Begruendung'),
  ('time_corrections','status','pending / approved / rejected'),
  ('time_corrections','created_at','Sortierung')
)
select e.tabelle, e.spalte,
       case when c.column_name is null then 'FEHLT' else 'ok' end as status,
       c.data_type as typ,
       e.wofuer
from erwartet e
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = e.tabelle
 and c.column_name = e.spalte
order by (c.column_name is not null), e.tabelle, e.spalte;


-- ---------------------------------------------------------------------
-- 2) Row Level Security: eingeschaltet?
-- ---------------------------------------------------------------------
select relname as tabelle,
       case when relrowsecurity then 'RLS aktiv' else 'RLS AUS' end as status
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('profiles','work_models','time_entries',
                  'vacation_requests','time_corrections')
order by relname;


-- ---------------------------------------------------------------------
-- 3) Welche Regeln (Policies) greifen je Tabelle?
-- ---------------------------------------------------------------------
select tablename as tabelle, policyname as regel, cmd as fuer
from pg_policies
where schemaname = 'public'
order by tablename, policyname;


-- ---------------------------------------------------------------------
-- 4) Welche Trigger liegen auf den Tabellen?
-- ---------------------------------------------------------------------
select c.relname as tabelle, t.tgname as trigger,
       p.proname as funktion,
       case t.tgenabled when 'O' then 'aktiv' when 'D' then 'ABGESCHALTET'
            else t.tgenabled::text end as status
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and c.relnamespace = 'public'::regnamespace
order by c.relname, t.tgname;


-- ---------------------------------------------------------------------
-- 5) Offene Buchungen (heute nicht ausgestempelt)
-- ---------------------------------------------------------------------
select p.full_name, te.clock_in, te.clock_out
from public.time_entries te
join public.profiles p on p.id = te.user_id
where te.clock_out is null
order by te.clock_in desc
limit 20;
