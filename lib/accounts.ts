// Laedt ZA-Konto und Urlaubskonto fuer einen oder mehrere Mitarbeiter.
// Gleiche Rechnung auf allen Seiten (Stundenkonto, Urlaub, Team, Mitarbeiter,
// Dashboard). Die Abfragen laufen unter RLS: ein Mitarbeiter sieht nur sich
// selbst, ein Admin alle.

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSpecialDays } from "./holidays";
import { VacationAccount, WorkModel, vacationAccount } from "./workmodel";
import { ZaAccount, ZaEntry, zaAccount } from "./zaccount";

type Profile = {
  id: string;
  vacation_days?: number | null;
  work_model_id?: string | null;
  entry_date?: string | null;
  opening_balance?: number | null;
  opening_balance_date?: string | null;
  vacation_opening_balance?: number | null;
  vacation_opening_date?: string | null;
};

type Request = {
  user_id: string;
  start_date: string;
  end_date: string;
  status: string;
  type?: string | null;
};

export type Accounts = {
  model: WorkModel | null;
  za: ZaAccount;
  vacation: VacationAccount;
};

const PAGE = 1000;

/**
 * Alle Zeilen einer Abfrage holen. Supabase liefert pro Anfrage hoechstens
 * 1000 Zeilen; ohne Blaettern wuerde das Stundenkonto ab dann still falsch.
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

export async function loadAccounts(
  client: SupabaseClient,
  userIds?: string[],
  /** ZA-Stand zu einem anderen Zeitpunkt als jetzt (z. B. Ende gestern). */
  options?: { zaAsOf?: Date }
): Promise<Record<string, Accounts>> {
  await loadSpecialDays(client);

  const only = userIds && userIds.length ? userIds : null;

  const profilesQ = client.from("profiles").select("*");
  const [{ data: profileData }, { data: modelData }] = await Promise.all([
    only ? profilesQ.in("id", only) : profilesQ,
    client.from("work_models").select("*"),
  ]);
  const profiles = (profileData || []) as Profile[];
  const models = (modelData || []) as WorkModel[];

  const [entries, requests] = await Promise.all([
    fetchAllRows<ZaEntry>((from, to) => {
      const q = client
        .from("time_entries")
        .select("id, user_id, clock_in, clock_out, kind")
        .order("clock_in", { ascending: true })
        .range(from, to);
      return only ? q.in("user_id", only) : q;
    }),
    fetchAllRows<Request>((from, to) => {
      const q = client
        .from("vacation_requests")
        .select("user_id, start_date, end_date, status, type")
        .order("start_date", { ascending: true })
        .range(from, to);
      return only ? q.in("user_id", only) : q;
    }),
  ]);

  const result: Record<string, Accounts> = {};
  for (const p of profiles) {
    const model = models.find((m) => m.id === p.work_model_id) || null;
    const userEntries = entries.filter((e) => e.user_id === p.id);
    const userRequests = requests.filter((r) => r.user_id === p.id);
    result[p.id] = {
      model,
      za: zaAccount({
        model,
        entries: userEntries,
        absences: userRequests,
        openingMinutes: p.opening_balance,
        openingDate: p.opening_balance_date,
        now: options?.zaAsOf,
      }),
      vacation: vacationAccount({
        model,
        fullDays: Number(p.vacation_days || 0),
        entryDate: p.entry_date || null,
        openingMinutes: Number(p.vacation_opening_balance || 0),
        openingDate: p.vacation_opening_date || null,
        requests: userRequests,
      }),
    };
  }
  return result;
}
