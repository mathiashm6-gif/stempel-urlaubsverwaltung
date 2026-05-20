"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function DashboardPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");

  useEffect(() => {
    async function getUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
      } else {
        setEmail(user.email || "");
      }
    }

    getUser();
  }, [router]);

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