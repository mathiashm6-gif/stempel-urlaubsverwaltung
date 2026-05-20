"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function DashboardPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [entries, setEntries] = useState<any[]>([]);

  useEffect(() => {
    async function getUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
      } else {
        setEmail(user.email || "");
        loadEntries();
      }
    }

    getUser();
  }, [router]);

  async function loadEntries() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("time_entries")
      .select("*")
      .eq("user_id", user.id)
      .gte("created_at", today.toISOString())
      .order("created_at", { ascending: false });

    if (!error && data) {
      setEntries(data);
    }
  }

  async function handleClockIn() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const { error } = await supabase.from("time_entries").insert([
      {
        user_id: user.id,
        clock_in: new Date(),
      },
    ]);

    if (error) {
      alert(error.message);
    } else {
      alert("Erfolgreich eingestempelt!");
      loadEntries();
    }
  }

  async function handleClockOut() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const { data, error: fetchError } = await supabase
      .from("time_entries")
      .select("*")
      .eq("user_id", user.id)
      .is("clock_out", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (fetchError || !data) {
      alert("Kein offener Arbeitseintrag gefunden.");
      return;
    }

    const { error } = await supabase
      .from("time_entries")
      .update({
        clock_out: new Date(),
      })
      .eq("id", data.id);

    if (error) {
      alert(error.message);
    } else {
      alert("Erfolgreich ausgestempelt!");
      loadEntries();
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();

    router.push("/login");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded-2xl bg-white p-10 shadow-xl">
        <h1 className="text-4xl font-bold text-gray-800">
          Dashboard
        </h1>

        <p className="mt-4 text-gray-600">
          Eingeloggt als:
        </p>

        <p className="font-semibold text-black">
          {email}
        </p>

        <div className="mt-6 flex gap-4">
          <button
            onClick={handleClockIn}
            className="w-full rounded-lg bg-green-500 px-4 py-2 font-semibold text-white"
          >
            Kommen
          </button>

          <button
            onClick={handleClockOut}
            className="w-full rounded-lg bg-orange-500 px-4 py-2 font-semibold text-white"
          >
            Gehen
          </button>
        </div>

        <div className="mt-6">
          <h2 className="mb-2 text-lg font-semibold text-gray-800">
            Heutige Einträge
          </h2>

          <div className="space-y-2">
            {entries.length === 0 ? (
              <p className="text-sm text-gray-500">
                Heute noch keine Einträge.
              </p>
            ) : (
              entries.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-gray-200 p-3 text-sm"
                >
                  <p>
                    <strong>Kommen:</strong>{" "}
                    {entry.clock_in
                      ? new Date(entry.clock_in).toLocaleTimeString()
                      : "-"}
                  </p>

                  <p>
                    <strong>Gehen:</strong>{" "}
                    {entry.clock_out
                      ? new Date(entry.clock_out).toLocaleTimeString()
                      : "-"}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="mt-6 w-full rounded-lg bg-red-500 px-4 py-2 font-semibold text-white"
        >
          Logout
        </button>
      </div>
    </main>
  );
}