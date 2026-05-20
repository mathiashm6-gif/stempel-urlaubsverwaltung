"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      alert(error.message);
    } else {
      alert("Registrierung erfolgreich!");
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      alert(error.message);
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <h1 className="text-3xl font-bold text-gray-800">
          Login & Registrierung
        </h1>

        <form onSubmit={handleSignUp} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              E-Mail
            </label>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2"
              placeholder="name@firma.at"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Passwort
            </label>

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2"
              placeholder="Passwort"
            />
          </div>

          <div className="flex gap-4">
            <button
              type="button"
              onClick={handleLogin}
              className="w-full rounded-lg bg-black px-4 py-2 font-semibold text-white"
            >
              Einloggen
            </button>

            <button
              type="submit"
              className="w-full rounded-lg bg-gray-700 px-4 py-2 font-semibold text-white"
            >
              Registrieren
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}