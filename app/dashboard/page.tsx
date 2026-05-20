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