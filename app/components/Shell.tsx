"use client";

import { ReactNode, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Sidebar from "./Sidebar";
import { Icon } from "./icons";

function initials(text: string) {
  const parts = text.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return text.slice(0, 2).toUpperCase();
}

export default function Shell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [role, setRole] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [active, setActive] = useState(true);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  async function loadUser() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setReady(true);
      return;
    }
    setEmail(user.email || "");
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, role, active")
      .eq("id", user.id)
      .single();
    if (profile) {
      setRole(profile.role || "");
      setName(profile.full_name || "");
      setActive(profile.active !== false);
    }
    setReady(true);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUser();
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const display = name || email || "Angemeldet";
  const roleText = role === "admin" ? "Chef / Admin" : "Mitarbeiter";
  const blocked = ready && role !== "admin" && !active;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar role={role} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white/85 px-6 backdrop-blur">
          <div>
            <h1 className="text-[17px] font-semibold tracking-tight text-slate-900">
              {title}
            </h1>
            {subtitle && (
              <p className="text-[12.5px] text-slate-500">{subtitle}</p>
            )}
          </div>

          <div className="flex items-center gap-4">
            {actions}
            <div className="hidden text-right sm:block">
              <p className="text-[15px] font-semibold tabular-nums text-slate-900">
                {now ? now.toLocaleTimeString("de-AT") : "--:--:--"}
              </p>
              <p className="text-[11.5px] text-slate-400">
                {now
                  ? now.toLocaleDateString("de-AT", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })
                  : ""}
              </p>
            </div>
            <div className="flex items-center gap-2.5 border-l border-slate-200 pl-4">
              <div className="hidden text-right leading-tight sm:block">
                <p className="text-[13px] font-semibold text-slate-900">
                  {display}
                </p>
                <p className="text-[11px] text-slate-400">{roleText}</p>
              </div>
              <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-blue-600 text-xs font-bold text-white">
                {initials(display)}
              </span>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-7">
          {blocked ? (
            <div className="mx-auto mt-10 max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                <Icon name="clock" className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">
                Konto wartet auf Freischaltung
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                Dein Zugang wurde noch nicht freigeschaltet. Sobald dein
                Vorgesetzter dich in der Verwaltung freischaltet, kannst du mit
                dem Stempeln beginnen.
              </p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
