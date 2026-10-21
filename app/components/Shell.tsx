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

type ShellUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
};

// Bleibt beim Seitenwechsel erhalten (Shell wird je Seite neu gemountet),
// damit der Kopf nicht bei jedem Klick neu aufgebaut wird.
let cachedUser: ShellUser | null = null;

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
  const [user, setUser] = useState<ShellUser | null>(cachedUser);
  const [ready, setReady] = useState(cachedUser !== null);
  const [now, setNow] = useState<Date | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  async function loadUser() {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) {
      cachedUser = null;
      setUser(null);
      setReady(true);
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, role, active")
      .eq("id", authUser.id)
      .single();
    // Alles in einem Schritt setzen, damit oben rechts kein Zwischenstand
    // (erst E-Mail, dann Name) aufblitzt.
    const next: ShellUser = {
      id: authUser.id,
      email: authUser.email || "",
      name: profile?.full_name || "",
      role: profile?.role || "",
      active: profile ? profile.active !== false : true,
    };
    cachedUser = next;
    setUser(next);
    setReady(true);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUser();
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);

    // Wird in einem anderen Tab desselben Browsers ein anderes Konto
    // angemeldet (oder abgemeldet), uebernimmt Supabase diese Session auch
    // hier. Dann die Seite neu laden, damit Anzeige und Daten zusammenpassen
    // und nicht unter falschem Namen gestempelt wird.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      const known = cachedUser?.id ?? null;
      const current = session?.user?.id ?? null;
      if (known && current !== known) {
        cachedUser = null;
        if (current) window.location.reload();
        else window.location.href = "/login";
      }
    });

    return () => {
      clearInterval(id);
      sub.subscription.unsubscribe();
    };
  }, []);

  const role = user?.role || "";
  const active = user?.active !== false;
  const display = user ? user.name || user.email || "Angemeldet" : "";
  const roleText = role === "admin" ? "Chef / Admin" : "Mitarbeiter";
  const blocked = ready && role !== "admin" && !active;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar role={role} />

      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMenuOpen(false)}
          />
          <div className="relative h-full">
            <Sidebar
              role={role}
              variant="mobile"
              onNavigate={() => setMenuOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur sm:px-6">
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Menü öffnen"
            className="-ml-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 md:hidden"
          >
            <Icon name="menu" className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-semibold tracking-tight text-slate-900">
              {title}
            </h1>
            {subtitle && (
              <p className="hidden truncate text-[12.5px] text-slate-500 sm:block">
                {subtitle}
              </p>
            )}
          </div>

          <div className="flex flex-shrink-0 items-center gap-3 sm:gap-4">
            {actions}
            <div className="hidden text-right lg:block">
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
            <div className="flex items-center gap-2.5 sm:border-l sm:border-slate-200 sm:pl-4">
              <div className="hidden text-right leading-tight sm:block">
                <p className="text-[13px] font-semibold text-slate-900">
                  {display || "\u00a0"}
                </p>
                <p className="text-[11px] text-slate-400">
                  {user ? roleText : "\u00a0"}
                </p>
              </div>
              <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-blue-600 text-xs font-bold text-white">
                {display ? initials(display) : ""}
              </span>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-5 sm:px-6 sm:py-7">
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
