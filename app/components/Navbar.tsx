"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type NavbarProps = {
  role?: string;
};

export default function Navbar({ role }: NavbarProps) {
  const router = useRouter();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <nav className="flex items-center justify-between bg-gray-900 px-6 py-4 text-white">
      <div className="font-bold">
        Stempel- & Urlaubsverwaltung
      </div>

      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="hover:underline">
          Dashboard
        </Link>

        <Link href="/journal" className="hover:underline">
          Journal
        </Link>

        <Link href="/urlaub" className="hover:underline">
          Urlaub
        </Link>

        <Link href="/auswertung" className="hover:underline">
          Auswertung
        </Link>

        <Link href="/korrektur" className="hover:underline">
          Korrektur
        </Link>

        {role === "admin" && (
          <Link href="/team" className="hover:underline">
            Team
          </Link>
        )}

        {role === "admin" && (
          <Link href="/admin" className="hover:underline">
            Admin
          </Link>
        )}

        <button
          onClick={handleLogout}
          className="rounded bg-red-600 px-3 py-1 hover:bg-red-700"
        >
          Logout
        </button>
      </div>
    </nav>
  );
}
