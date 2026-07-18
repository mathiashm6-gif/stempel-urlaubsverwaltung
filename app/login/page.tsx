"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Icon } from "../components/icons";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function handleSignUp() {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Registrierung erfolgreich – du kannst dich jetzt einloggen.");
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setMessage(error.message);
    } else {
      router.push("/dashboard");
    }
  }

  async function handleReset() {
    if (!email) {
      setMessage("Bitte zuerst deine E-Mail-Adresse eingeben.");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset`,
    });
    if (error) {
      setMessage(error.message);
    } else {
      setMessage(
        "Wir haben dir einen Link zum Zurücksetzen geschickt. Bitte schau in dein E-Mail-Postfach."
      );
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-blue-600 text-white shadow-sm shadow-blue-600/30">
            <Icon name="clock" className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="leading-tight">
            <p className="text-lg font-semibold tracking-tight text-slate-900">
              Zeiterfassung
            </p>
            <p className="text-xs text-slate-400">Anmelden oder registrieren</p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
              E-Mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="name@firma.at"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
              Passwort
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="Passwort"
            />
          </div>

          {message && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
              {message}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Einloggen
            </button>
            <button
              type="button"
              onClick={handleSignUp}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Registrieren
            </button>
          </div>

          <button
            type="button"
            onClick={handleReset}
            className="w-full pt-1 text-center text-[13px] text-slate-500 transition hover:text-slate-700"
          >
            Passwort vergessen?
          </button>
        </form>
      </div>
    </main>
  );
}
