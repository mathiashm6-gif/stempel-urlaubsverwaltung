// Mail-Benachrichtigung ausloesen (siehe app/api/notify/route.ts).
//
// Wird nach dem Speichern aufgerufen und nicht abgewartet: schlaegt der
// Mailversand fehl, bleibt der Antrag trotzdem gespeichert. Fehler landen
// nur in der Browser-Konsole.

import { supabase } from "./supabaseClient";

export type NotifyEvent =
  | "vacation_requested"
  | "vacation_decided"
  | "correction_requested"
  | "correction_decided"
  | "offday_work"
  | "sick_reported";

export async function notify(event: NotifyEvent, ids: (string | number)[]) {
  try {
    if (!ids.length) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const res = await fetch("/api/notify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ event, ids }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      console.warn("Benachrichtigung nicht verschickt:", body?.error || body?.skipped || res.status);
    }
  } catch (err) {
    console.warn("Benachrichtigung nicht verschickt:", err);
  }
}
