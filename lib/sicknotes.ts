// Arbeitsunfaehigkeitsbestaetigungen (PDF) im privaten Speicher "sick-notes".
// Ablage je Mitarbeiter: <user_id>/<zeitstempel>.pdf (siehe supabase/krankmeldung.sql).

import { supabase } from "./supabaseClient";

export const SICK_TYPE = "Krankheit";
export const SICK_BUCKET = "sick-notes";
export const SICK_MAX_BYTES = 10 * 1024 * 1024;

/** Prueft die Datei vor dem Hochladen; liefert eine Fehlermeldung oder null. */
export function checkSickNote(file: File | null): string | null {
  if (!file) return "Bitte die Krankmeldung als PDF auswählen.";
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return "Bitte eine PDF-Datei hochladen.";
  if (file.size > SICK_MAX_BYTES) return "Die Datei ist größer als 10 MB.";
  return null;
}

export async function uploadSickNote(userId: string, file: File) {
  const path = `${userId}/${Date.now()}.pdf`;
  const { error } = await supabase.storage
    .from(SICK_BUCKET)
    .upload(path, file, { contentType: "application/pdf", upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

/**
 * PDF in neuem Tab oeffnen. Das Fenster wird sofort geoeffnet und erst danach
 * befuellt – sonst blockiert Safari das Popup nach dem Warten auf den Link.
 */
export async function openSickNote(path: string) {
  const win = window.open("", "_blank");
  const { data, error } = await supabase.storage
    .from(SICK_BUCKET)
    .createSignedUrl(path, 120);
  if (error || !data?.signedUrl) {
    win?.close();
    alert(error?.message || "Die Datei konnte nicht geöffnet werden.");
    return;
  }
  if (win) win.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}
