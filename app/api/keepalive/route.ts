// Keep-alive gegen das automatische Pausieren von Supabase.
//
// Supabase pausiert Projekte im Free-Tier, wenn über ein rollierendes Fenster
// von sieben Tagen zu wenig Datenbankaktivität ankommt. Ein pausiertes Projekt
// nimmt keine Anfragen mehr an – im Frontend sieht man dann nur "Load failed".
//
// Dieser Endpoint stellt eine echte Datenbankanfrage. Er wird von Vercel Cron
// aufgerufen (siehe vercel.json). Wichtig: der Aufruf muss von aussen kommen,
// ein Cron innerhalb von Postgres (pg_cron) zählt nicht als Nutzeraktivität.
//
// Optional absichern: Umgebungsvariable CRON_SECRET in Vercel setzen. Vercel
// schickt sie dann automatisch als Bearer-Token mit. Ist sie nicht gesetzt,
// ist der Endpoint offen – er gibt aber ohnehin keine Daten preis.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return Response.json(
      { ok: false, error: "Supabase-Umgebungsvariablen fehlen" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(`${url}/rest/v1/keepalive?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });

    return Response.json(
      {
        ok: res.ok,
        status: res.status,
        at: new Date().toISOString(),
      },
      { status: res.ok ? 200 : 502 }
    );
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unbekannter Fehler",
        at: new Date().toISOString(),
      },
      { status: 502 }
    );
  }
}
