"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Icon } from "./icons";

type NavItem = { href: string; label: string; icon: string };
type NavSection = { section: string; items: NavItem[] };

const BASE_NAV: NavSection[] = [
  {
    section: "Meine Zeit",
    items: [
      { href: "/dashboard", label: "Stempeluhr", icon: "clock" },
      { href: "/journal", label: "Monatsjournal", icon: "calendar" },
      { href: "/auswertung", label: "Soll / Ist", icon: "chart" },
      { href: "/stundenkonto", label: "Stundenkonto", icon: "wallet" },
    ],
  },
  {
    section: "Abwesenheit",
    items: [
      { href: "/urlaub", label: "Urlaub", icon: "sun" },
      { href: "/korrektur", label: "Zeitkorrektur", icon: "wrench" },
    ],
  },
];

const ADMIN_NAV: NavSection = {
  section: "Verwaltung",
  items: [
    { href: "/team", label: "Team-Status", icon: "users" },
    { href: "/kalender", label: "Urlaubskalender", icon: "calendar" },
    { href: "/mitarbeiter", label: "Mitarbeiter", icon: "user" },
    { href: "/admin", label: "Verwaltung", icon: "sliders" },
  ],
};

export default function Sidebar({ role }: { role?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  const sections = role === "admin" ? [...BASE_NAV, ADMIN_NAV] : BASE_NAV;

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-64 flex-shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="flex items-center gap-3 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-blue-600 text-white shadow-sm shadow-blue-600/30">
          <Icon name="clock" className="h-5 w-5" strokeWidth={2} />
        </span>
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight text-slate-900">
            Zeiterfassung
          </p>
          <p className="text-xs text-slate-400">Stempeltool</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {sections.map((sec) => (
          <div key={sec.section}>
            <p className="px-3 pt-4 pb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
              {sec.section}
            </p>
            {sec.items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`mb-0.5 flex items-center gap-3 rounded-[9px] px-3 py-2 text-[13.5px] font-medium transition ${
                    active
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <Icon
                    name={item.icon}
                    className={`h-[18px] w-[18px] ${
                      active ? "text-blue-600" : "text-slate-400"
                    }`}
                  />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-3">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-[9px] px-3 py-2 text-[13.5px] font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
        >
          <Icon name="logout" className="h-[18px] w-[18px] text-slate-400" />
          Abmelden
        </button>
      </div>
    </aside>
  );
}
