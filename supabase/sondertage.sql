-- =====================================================================
-- Sondertage: verkuerzte oder freie Arbeitstage (z. B. 24. und 31.12.)
--
-- Der 24. und 31.12. sind in Oesterreich keine gesetzlichen Feiertage.
-- Die Verkuerzung kommt aus dem Kollektivvertrag (Handel). Die ausfallende
-- Zeit ist bezahlt, deshalb wird das Tagessoll reduziert:
--
--   Tagessoll = Sollstunden des Wochentags laut Zeitmodell x Soll-Prozent
--
--   target_percent = 50  -> halber Arbeitstag
--   target_percent = 0   -> ganzer Tag frei (zaehlt wie ein Feiertag)
--   recurring = true     -> gilt jedes Jahr am selben Tag, ab dem Jahr von "day"
--
-- Idempotent: kann mehrfach ausgefuehrt werden.
-- =====================================================================

create table if not exists public.special_days (
  id uuid primary key default gen_random_uuid(),
  day date not null unique,
  name text not null,
  target_percent integer not null default 50
    check (target_percent between 0 and 100),
  recurring boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.special_days enable row level security;

drop policy if exists sd_select_all on public.special_days;
create policy sd_select_all
on public.special_days
for select
to authenticated
using (true);

drop policy if exists sd_write_admin on public.special_days;
create policy sd_write_admin
on public.special_days
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Vorbelegung laut KV Handel: 24. und 31.12. halber Arbeitstag, jaehrlich.
insert into public.special_days (day, name, target_percent, recurring)
values
  ('2026-12-24', 'Heiliger Abend', 50, true),
  ('2026-12-31', 'Silvester', 50, true)
on conflict (day) do nothing;

-- Kontrolle:
-- select day, name, target_percent, recurring from public.special_days order by day;
