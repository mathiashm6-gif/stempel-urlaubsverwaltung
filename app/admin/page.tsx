"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Shell from "../components/Shell";
import { Icon } from "../components/icons";
import {
  WEEKDAYS,
  WorkModel,
  formatDays,
  vacationEntitlement,
  weeklyHours,
  workdayLabel,
} from "@/lib/workmodel";

type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  vacation_days: number;
  work_model_id: string | null;
  active?: boolean | null;
  entry_date?: string | null;
};

// Formular fuer ein Zeitmodell: Stunden je Wochentag-Spalte.
type ModelForm = { name: string; hours: Record<string, number> };

const EMPTY_MODEL: ModelForm = {
  name: "",
  hours: {
    monday_hours: 8,
    tuesday_hours: 8,
    wednesday_hours: 8,
    thursday_hours: 8,
    friday_hours: 8,
    saturday_hours: 0,
    sunday_hours: 0,
  },
};

const YEAR_NOW = new Date().getFullYear();
type Vacation = {
  id: number;
  user_id: string;
  start_date: string;
  end_date: string;
  status: string;
  type?: string | null;
};
type Correction = {
  id: number;
  user_id: string;
  entry_id: string | null;
  kind: string;
  entry_kind?: string | null;
  target_date: string;
  requested_clock_in: string | null;
  requested_clock_out: string | null;
  reason: string | null;
  status: string;
};

const KIND_LABEL: Record<string, string> = {
  create: "Nachtragen",
  edit: "Zeit ändern",
  delete: "Löschen",
};

function timeLabel(iso: string | null) {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const cardCls = "rounded-xl border border-slate-200 bg-white shadow-sm";
const theadCls =
  "bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500";
const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

export default function AdminPage() {
  const router = useRouter();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [vacations, setVacations] = useState<Vacation[]>([]);
  const [workModels, setWorkModels] = useState<WorkModel[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);

  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editRole, setEditRole] = useState("employee");
  const [editVacationDays, setEditVacationDays] = useState(30);
  const [editWorkModelId, setEditWorkModelId] = useState("");
  const [editEntryDate, setEditEntryDate] = useState("");

  // Zeitmodelle: "new" = neues Modell, sonst die id des bearbeiteten Modells
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelForm, setModelForm] = useState<ModelForm>(EMPTY_MODEL);
  const [savingModel, setSavingModel] = useState(false);

  async function init() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    const { data: me } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!me || me.role !== "admin") {
      router.push("/dashboard");
      return;
    }
    await Promise.all([
      loadProfiles(),
      loadVacations(),
      loadWorkModels(),
      loadCorrections(),
    ]);
  }

  async function loadProfiles() {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("email");
    if (error) {
      alert(error.message);
      return;
    }
    setProfiles((data || []) as Profile[]);
  }

  async function loadVacations() {
    const { data, error } = await supabase
      .from("vacation_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      alert(error.message);
      return;
    }
    setVacations((data || []) as Vacation[]);
  }

  async function loadWorkModels() {
    const { data, error } = await supabase
      .from("work_models")
      .select("*")
      .order("name");
    if (error) {
      alert(error.message);
      return;
    }
    setWorkModels((data || []) as WorkModel[]);
  }

  async function loadCorrections() {
    const { data, error } = await supabase
      .from("time_corrections")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      alert(error.message);
      return;
    }
    setCorrections((data || []) as Correction[]);
  }

  async function updateStatus(id: number, status: string) {
    const { error } = await supabase
      .from("vacation_requests")
      .update({ status })
      .eq("id", id);
    if (error) {
      alert(error.message);
      return;
    }
    await loadVacations();
  }

  async function toggleActive(p: Profile) {
    const next = !(p.active !== false);
    const { error } = await supabase
      .from("profiles")
      .update({ active: next })
      .eq("id", p.id);
    if (error) {
      alert(error.message);
      return;
    }
    await loadProfiles();
  }

  function startEdit(profile: Profile) {
    setEditingProfile(profile);
    setEditFullName(profile.full_name || "");
    setEditRole(profile.role || "employee");
    setEditVacationDays(profile.vacation_days || 30);
    setEditWorkModelId(profile.work_model_id || "");
    setEditEntryDate(profile.entry_date || "");
  }

  async function saveProfile() {
    if (!editingProfile) return;
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: editFullName,
        role: editRole,
        vacation_days: editVacationDays,
        work_model_id: editWorkModelId || null,
        entry_date: editEntryDate || null,
      })
      .eq("id", editingProfile.id);
    if (error) {
      alert(error.message);
      return;
    }
    setEditingProfile(null);
    await loadProfiles();
  }

  // ---------------- Zeitmodelle ----------------

  function startNewModel() {
    setEditingModelId("new");
    setModelForm({ name: "", hours: { ...EMPTY_MODEL.hours } });
  }

  function startEditModel(m: WorkModel) {
    const hours: Record<string, number> = {};
    WEEKDAYS.forEach((w) => {
      hours[w.field] = Number(m[w.field] || 0);
    });
    setEditingModelId(m.id);
    setModelForm({ name: m.name, hours });
  }

  function setDayHours(field: string, value: number) {
    setModelForm((f) => ({
      ...f,
      hours: { ...f.hours, [field]: Math.max(0, Math.min(24, value)) },
    }));
  }

  function toggleDay(field: string, on: boolean) {
    // Arbeitstag aus = 0 Stunden. Arbeitstag ein = Vorschlag 8 Stunden.
    setDayHours(field, on ? modelForm.hours[field] || 8 : 0);
  }

  async function saveModel() {
    const name = modelForm.name.trim();
    if (!name) {
      alert("Bitte einen Namen für das Zeitmodell vergeben.");
      return;
    }
    const activeDays = WEEKDAYS.filter((w) => (modelForm.hours[w.field] || 0) > 0);
    if (activeDays.length === 0) {
      alert("Bitte mindestens einen Arbeitstag mit Stunden festlegen.");
      return;
    }
    setSavingModel(true);
    const payload: Record<string, string | number> = { name };
    WEEKDAYS.forEach((w) => {
      payload[w.field] = Number(modelForm.hours[w.field] || 0);
    });

    const { error } =
      editingModelId === "new"
        ? await supabase.from("work_models").insert([payload])
        : await supabase
            .from("work_models")
            .update(payload)
            .eq("id", editingModelId as string);
    setSavingModel(false);
    if (error) {
      alert(error.message);
      return;
    }
    setEditingModelId(null);
    await loadWorkModels();
  }

  async function deleteModel(m: WorkModel) {
    const used = profiles.filter((p) => p.work_model_id === m.id);
    if (used.length > 0) {
      alert(
        `Das Modell ist noch ${used.length} Mitarbeitern zugeordnet. Bitte zuerst umstellen.`
      );
      return;
    }
    if (!confirm(`Zeitmodell "${m.name}" wirklich löschen?`)) return;
    const { error } = await supabase.from("work_models").delete().eq("id", m.id);
    if (error) {
      alert(error.message);
      return;
    }
    await loadWorkModels();
  }

  async function approveCorrection(c: Correction) {
    if (c.kind === "create") {
      const { error } = await supabase.from("time_entries").insert([
        {
          user_id: c.user_id,
          clock_in: c.requested_clock_in,
          clock_out: c.requested_clock_out,
          kind: c.entry_kind || "work",
        },
      ]);
      if (error) {
        alert(error.message);
        return;
      }
    } else if (c.kind === "edit" && c.entry_id) {
      const { error } = await supabase
        .from("time_entries")
        .update({
          clock_in: c.requested_clock_in,
          clock_out: c.requested_clock_out,
        })
        .eq("id", c.entry_id);
      if (error) {
        alert(error.message);
        return;
      }
    } else if (c.kind === "delete" && c.entry_id) {
      const { error } = await supabase
        .from("time_entries")
        .delete()
        .eq("id", c.entry_id);
      if (error) {
        alert(error.message);
        return;
      }
    }
    const { error: statusError } = await supabase
      .from("time_corrections")
      .update({ status: "approved" })
      .eq("id", c.id);
    if (statusError) {
      alert(statusError.message);
      return;
    }
    await loadCorrections();
  }

  async function rejectCorrection(c: Correction) {
    const { error } = await supabase
      .from("time_corrections")
      .update({ status: "rejected" })
      .eq("id", c.id);
    if (error) {
      alert(error.message);
      return;
    }
    await loadCorrections();
  }

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function userEmail(userId: string) {
    return profiles.find((p) => p.id === userId)?.email || userId;
  }
  function workModelName(id: string | null) {
    return workModels.find((m) => m.id === id)?.name || "–";
  }

  const pendingVacations = vacations.filter((v) => v.status === "pending");
  const processedVacations = vacations.filter((v) => v.status !== "pending");
  const pendingCorrections = corrections.filter((c) => c.status === "pending");

  return (
    <Shell title="Verwaltung" subtitle="Mitarbeiter, Anträge und Korrekturen">
      {/* Mitarbeiter */}
      <div className={cardCls}>
        <div className="border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-slate-900">
            Mitarbeiter
          </h2>
        </div>
        <table className="w-full text-sm">
          <thead className={theadCls}>
            <tr>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">E-Mail</th>
              <th className="px-4 py-2.5">Rolle</th>
              <th className="px-4 py-2.5 text-right">Urlaub {YEAR_NOW}</th>
              <th className="px-4 py-2.5">Zeitmodell</th>
              <th className="px-4 py-2.5">Eintritt</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 font-medium text-slate-700">
                  {p.full_name || "–"}
                </td>
                <td className="px-4 py-2.5 text-slate-600">{p.email}</td>
                <td className="px-4 py-2.5">
                  {p.role === "admin" ? (
                    <span className="rounded bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                      Chef / Admin
                    </span>
                  ) : (
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                      Mitarbeiter
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {(() => {
                    const ent = vacationEntitlement(
                      p.vacation_days,
                      p.entry_date,
                      YEAR_NOW
                    );
                    return (
                      <>
                        {formatDays(ent.days)}
                        {ent.aliquot && (
                          <span className="ml-1 text-xs text-amber-600">
                            aliquot
                          </span>
                        )}
                      </>
                    );
                  })()}
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {workModelName(p.work_model_id)}
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {p.entry_date
                    ? new Date(p.entry_date).toLocaleDateString("de-DE")
                    : "–"}
                </td>
                <td className="px-4 py-2.5">
                  {p.active !== false ? (
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      Aktiv
                    </span>
                  ) : (
                    <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      Wartet
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex justify-end gap-2">
                    {p.active !== false ? (
                      <button
                        onClick={() => toggleActive(p)}
                        className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Sperren
                      </button>
                    ) : (
                      <button
                        onClick={() => toggleActive(p)}
                        className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        Freischalten
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(p)}
                      className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      Bearbeiten
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingProfile && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/60 p-6">
          <h3 className="mb-1 text-[15px] font-semibold text-slate-900">
            Mitarbeiter bearbeiten
          </h3>
          <p className="mb-4 text-sm text-slate-500">{editingProfile.email}</p>
          <div className="grid gap-4 md:grid-cols-5">
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                Name
              </label>
              <input
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                Rolle
              </label>
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                className={inputCls}
              >
                <option value="employee">employee</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                Urlaubstage / Jahr
              </label>
              <input
                type="number"
                value={editVacationDays}
                onChange={(e) => setEditVacationDays(Number(e.target.value))}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                Zeitmodell
              </label>
              <select
                value={editWorkModelId}
                onChange={(e) => setEditWorkModelId(e.target.value)}
                className={inputCls}
              >
                <option value="">Bitte wählen</option>
                {workModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {workdayLabel(m)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                Eintrittsdatum
              </label>
              <input
                type="date"
                value={editEntryDate}
                onChange={(e) => setEditEntryDate(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {(() => {
              const ent = vacationEntitlement(
                editVacationDays,
                editEntryDate || null,
                YEAR_NOW
              );
              return ent.aliquot
                ? `Anspruch ${YEAR_NOW}: ${formatDays(ent.days)} Tage – aliquot aus ${formatDays(
                    ent.fullDays
                  )} Tagen für ${ent.coveredDays} von ${ent.yearDays} Kalendertagen, aufgerundet auf halbe Tage.`
                : `Anspruch ${YEAR_NOW}: ${formatDays(
                    ent.days
                  )} Tage (ganzjährig beschäftigt). Ohne Eintrittsdatum wird nicht aliquotiert.`;
            })()}
          </p>
          <div className="mt-4 flex gap-3">
            <button
              onClick={saveProfile}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Speichern
            </button>
            <button
              onClick={() => setEditingProfile(null)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Zeitmodelle */}
      <div className="mt-8 mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-slate-900">
          Arbeitszeitmodelle
        </h2>
        <button
          onClick={startNewModel}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
        >
          <Icon name="check" className="h-3.5 w-3.5" />
          Neues Zeitmodell
        </button>
      </div>
      <div className={cardCls}>
        <table className="w-full text-sm">
          <thead className={theadCls}>
            <tr>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Fixe Arbeitstage</th>
              {WEEKDAYS.map((w) => (
                <th key={w.field} className="px-2 py-2.5 text-right">
                  {w.short}
                </th>
              ))}
              <th className="px-4 py-2.5 text-right">Woche</th>
              <th className="px-4 py-2.5 text-right">Zugeordnet</th>
              <th className="px-4 py-2.5 text-right">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {workModels.map((m) => (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 font-medium text-slate-700">
                  {m.name}
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {workdayLabel(m)}
                </td>
                {WEEKDAYS.map((w) => {
                  const h = Number(m[w.field] || 0);
                  return (
                    <td
                      key={w.field}
                      className={`px-2 py-2.5 text-right tabular-nums ${
                        h > 0 ? "text-slate-700" : "text-slate-300"
                      }`}
                    >
                      {h > 0 ? formatDays(h) : "–"}
                    </td>
                  );
                })}
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-800">
                  {formatDays(weeklyHours(m))} h
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                  {profiles.filter((p) => p.work_model_id === m.id).length}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => startEditModel(m)}
                      className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      Bearbeiten
                    </button>
                    <button
                      onClick={() => deleteModel(m)}
                      className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Löschen
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {workModels.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-6 text-center text-slate-500">
                  Noch kein Zeitmodell angelegt.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingModelId && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/60 p-6">
          <h3 className="mb-1 text-[15px] font-semibold text-slate-900">
            {editingModelId === "new"
              ? "Neues Zeitmodell"
              : "Zeitmodell bearbeiten"}
          </h3>
          <p className="mb-4 text-sm text-slate-500">
            Ein Wochentag mit Stunden ist ein fixer Arbeitstag. Nur diese Tage
            zählen beim Tagessoll und beim Urlaubsverbrauch.
          </p>

          <div className="max-w-sm">
            <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
              Bezeichnung
            </label>
            <input
              value={modelForm.name}
              onChange={(e) =>
                setModelForm((f) => ({ ...f, name: e.target.value }))
              }
              placeholder="z. B. Teilzeit 20 h (Mo/Mi/Fr)"
              className={inputCls}
            />
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {WEEKDAYS.map((w) => {
              const h = modelForm.hours[w.field] || 0;
              const on = h > 0;
              return (
                <div
                  key={w.field}
                  className={`rounded-lg border p-3 ${
                    on
                      ? "border-blue-200 bg-white"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => toggleDay(w.field, e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {w.label}
                  </label>
                  <div className="mt-2 flex items-center gap-1">
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      max="24"
                      disabled={!on}
                      value={h}
                      onChange={(e) =>
                        setDayHours(w.field, Number(e.target.value))
                      }
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm tabular-nums text-slate-800 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                    <span className="text-xs text-slate-500">h</span>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-3 text-sm text-slate-600">
            {WEEKDAYS.filter((w) => (modelForm.hours[w.field] || 0) > 0).length}{" "}
            Arbeitstage pro Woche ·{" "}
            <span className="font-semibold">
              {formatDays(
                WEEKDAYS.reduce(
                  (a, w) => a + (modelForm.hours[w.field] || 0),
                  0
                )
              )}{" "}
              Wochenstunden
            </span>
          </p>

          <div className="mt-4 flex gap-3">
            <button
              onClick={saveModel}
              disabled={savingModel}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {savingModel ? "Wird gespeichert…" : "Speichern"}
            </button>
            <button
              onClick={() => setEditingModelId(null)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Offene Abwesenheitsanträge */}
      <h2 className="mt-8 mb-3 text-[15px] font-semibold text-slate-900">
        Offene Abwesenheitsanträge
      </h2>
      <div className={cardCls}>
        <table className="w-full text-sm">
          <thead className={theadCls}>
            <tr>
              <th className="px-4 py-2.5">Mitarbeiter</th>
              <th className="px-4 py-2.5">Art</th>
              <th className="px-4 py-2.5">Von</th>
              <th className="px-4 py-2.5">Bis</th>
              <th className="px-4 py-2.5 text-right">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {pendingVacations.map((v) => (
              <tr key={v.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 text-slate-600">
                  {userEmail(v.user_id)}
                </td>
                <td className="px-4 py-2.5 font-medium text-slate-700">
                  {v.type || "Urlaub"}
                </td>
                <td className="px-4 py-2.5">
                  {new Date(v.start_date).toLocaleDateString("de-DE")}
                </td>
                <td className="px-4 py-2.5">
                  {new Date(v.end_date).toLocaleDateString("de-DE")}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => updateStatus(v.id, "approved")}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      <Icon name="check" className="h-3.5 w-3.5" /> Genehmigen
                    </button>
                    <button
                      onClick={() => updateStatus(v.id, "rejected")}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      <Icon name="x" className="h-3.5 w-3.5" /> Ablehnen
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {pendingVacations.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  Keine offenen Anträge vorhanden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Offene Zeitkorrekturen */}
      <h2 className="mt-8 mb-3 text-[15px] font-semibold text-slate-900">
        Offene Zeitkorrekturen
      </h2>
      <div className={cardCls}>
        <table className="w-full text-sm">
          <thead className={theadCls}>
            <tr>
              <th className="px-4 py-2.5">Mitarbeiter</th>
              <th className="px-4 py-2.5">Datum</th>
              <th className="px-4 py-2.5">Art</th>
              <th className="px-4 py-2.5">Kommt</th>
              <th className="px-4 py-2.5">Geht</th>
              <th className="px-4 py-2.5">Grund</th>
              <th className="px-4 py-2.5 text-right">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {pendingCorrections.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 text-slate-600">
                  {userEmail(c.user_id)}
                </td>
                <td className="px-4 py-2.5">
                  {new Date(c.target_date).toLocaleDateString("de-DE")}
                </td>
                <td className="px-4 py-2.5 font-medium text-slate-700">
                  {KIND_LABEL[c.kind] || c.kind}
                  {c.kind === "create"
                    ? c.entry_kind === "pause"
                      ? " · Pause"
                      : " · Normal"
                    : ""}
                </td>
                <td className="px-4 py-2.5">
                  {c.kind === "delete" ? "–" : timeLabel(c.requested_clock_in)}
                </td>
                <td className="px-4 py-2.5">
                  {c.kind === "delete" ? "–" : timeLabel(c.requested_clock_out)}
                </td>
                <td className="px-4 py-2.5 text-slate-500">{c.reason || "–"}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => approveCorrection(c)}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      <Icon name="check" className="h-3.5 w-3.5" /> Genehmigen
                    </button>
                    <button
                      onClick={() => rejectCorrection(c)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      <Icon name="x" className="h-3.5 w-3.5" /> Ablehnen
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {pendingCorrections.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  Keine offenen Korrekturanträge vorhanden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Bearbeitete Anträge */}
      <h2 className="mt-8 mb-3 text-[15px] font-semibold text-slate-900">
        Bearbeitete Abwesenheitsanträge
      </h2>
      <div className={cardCls}>
        <table className="w-full text-sm">
          <thead className={theadCls}>
            <tr>
              <th className="px-4 py-2.5">Mitarbeiter</th>
              <th className="px-4 py-2.5">Art</th>
              <th className="px-4 py-2.5">Von</th>
              <th className="px-4 py-2.5">Bis</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {processedVacations.map((v) => (
              <tr key={v.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 text-slate-600">
                  {userEmail(v.user_id)}
                </td>
                <td className="px-4 py-2.5 font-medium text-slate-700">
                  {v.type || "Urlaub"}
                </td>
                <td className="px-4 py-2.5">
                  {new Date(v.start_date).toLocaleDateString("de-DE")}
                </td>
                <td className="px-4 py-2.5">
                  {new Date(v.end_date).toLocaleDateString("de-DE")}
                </td>
                <td className="px-4 py-2.5">
                  {v.status === "approved" ? (
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      Genehmigt
                    </span>
                  ) : (
                    <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                      Abgelehnt
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {processedVacations.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  Noch nichts bearbeitet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
