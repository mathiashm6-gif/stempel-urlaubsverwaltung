-- =====================================================================
-- Krankmeldung mit Pflicht-PDF
--
-- Eine Krankmeldung (Typ "Krankheit") gilt sofort, ohne Genehmigung, aber
-- nur mit hochgeladener Arbeitsunfaehigkeitsbestaetigung als PDF.
-- Alle anderen Abwesenheiten bleiben Antraege (status pending).
--
--   1) vacation_requests.attachment_path  (Pfad im Speicher)
--   2) privater Speicher-Bucket "sick-notes" (nur PDF, max. 10 MB)
--      Ablage: <user_id>/<zeitstempel>.pdf
--      Hochladen: nur in den eigenen Ordner
--      Lesen:     der Mitarbeiter selbst und Admins
--      Loeschen:  nur Admins; Aendern: niemand
--   3) Regel fuer neue Antraege (ersetzt vac_insert_own aus hardening.sql):
--      - normale Abwesenheit: nur als "pending", ohne Anhang
--      - Krankheit: nur als "approved" UND mit einem PDF, das wirklich im
--        eigenen Ordner liegt
--
-- Idempotent: kann mehrfach ausgefuehrt werden.
-- =====================================================================

-- 1) Spalte
alter table public.vacation_requests
  add column if not exists attachment_path text;

-- 2) Speicher-Bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sick-notes', 'sick-notes', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists sick_notes_insert_own on storage.objects;
create policy sick_notes_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'sick-notes'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists sick_notes_select on storage.objects;
create policy sick_notes_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'sick-notes'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists sick_notes_delete_admin on storage.objects;
create policy sick_notes_delete_admin
on storage.objects
for delete
to authenticated
using (bucket_id = 'sick-notes' and public.is_admin());

-- 3) Neue Antraege
drop policy if exists vac_insert_own on public.vacation_requests;
create policy vac_insert_own
on public.vacation_requests
for insert
to authenticated
with check (
  user_id = auth.uid()
  and (
    (
      coalesce(type, 'Urlaub') <> 'Krankheit'
      and coalesce(status, 'pending') = 'pending'
      and attachment_path is null
    )
    or (
      type = 'Krankheit'
      and status = 'approved'
      and attachment_path like auth.uid()::text || '/%'
      and exists (
        select 1 from storage.objects o
        where o.bucket_id = 'sick-notes'
          and o.name = attachment_path
      )
    )
  )
);

-- Kontrolle:
-- select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'sick-notes';
-- select policyname from pg_policies where tablename in ('objects', 'vacation_requests');
