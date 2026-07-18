"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Icon } from "../components/icons";

export default function ResetPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setMessage("Das Passwort muss mindestens 6 Zeichen haben.");
      return;
    }
    if (password !== password2) {
      setMessage("Die Passwörter stimmen nicht überein.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage(error.message);
      return;
    }
    setDone(true);
    setMessage("Passwort geändert. Du wirst weitergeleitet …");
    setTimeout(() => router.push("/dashboard"), 1500);
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
              Neues Passwort
            </p>
            <p className="text-xs text-slate-400">Zeiterfassung</p>
          </div>
        </div>

        <form onSubmit={handleUpdate} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
              Neues Passwort
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="Mindestens 6 Zeichen"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
              Passwort wiederholen
            </label>
            <input
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="Passwort wiederholen"
            />
          </div>

          {message && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={done}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            Passwort speichern
          </button>
        </form>

        <p className="mt-4 text-center text-[12.5px] text-slate-400">
          Diese Seite über den Link in der E-Mail öffnen. Danach kannst du dich
          mit dem neuen Passwort anmelden.
        </p>
      </div>
    </main>
  );
}
