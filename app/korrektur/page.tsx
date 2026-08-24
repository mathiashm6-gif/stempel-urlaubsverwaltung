"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Shell from "../components/Shell";
import { Icon } from "../components/icons";
import { isPause } from "@/lib/time";

type TimeEntry = {
  id: string;
  user_id: string;
  clock_in: string | null;
  clock_out: string | null;
  kind?: string | null;
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
  created_at: string;
};
type Segment = { id: number; kind: string; start: string; end: string };

const KIND_LABEL: Record<string, string> = {
  create: "Nachtragen",
  edit: "Zeit ändern",
  delete: "Löschen",
};

function toISO(dateStr: string, timeStr: string) {
  if (!dateStr || !timeStr) return null;
  const d = new Date(`${dateStr}T${timeStr}`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function timeInputValue(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}
function timeLabel(iso: string | null) {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function hmToMin(hm: string) {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function fmtMin(min: number) {
  const abs = Math.max(0, Math.round(min));
  return `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}
function statusLabel(status: string) {
  if (status === "approved")
    return { text: "Genehmigt", cls: "bg-emerald-50 text-emerald-700" };
  if (status === "rejected")
    return { text: "Abgelehnt", cls: "bg-red-50 text-red-700" };
  return { text: "Offen", cls: "bg-amber-50 text-amber-700" };
}

export default function KorrekturPage() {
  const router = useRouter();
  const today = new Date().toISOString().split("T")[0];

  const [selectedDate, setSelectedDate] = useState(today);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);

  // Segment-Builder (Zwischenebene)
  const [draftKind, setDraftKind] = useState("work");
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [antragReason, setAntragReason] = useState("");
  const idRef = useRef(1);

  // Bestehende Buchung ändern/löschen
  const [action, setAction] = useState<{
    mode: "edit" | "delete";
    entry: TimeEntry;
  } | null>(null);
  const [editIn, setEditIn] = useState("");
  const [editOut, setEditOut] = useState("");
  const [editReason, setEditReason] = useState("");

  async function loadData(dateValue: string) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    setLoading(true);

    const start = new Date(dateValue);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const { data: entryData } = await supabase
      .from("time_entries")
      .select("*")
      .eq("user_id", user.id)
      .gte("clock_in", start.toISOString())
      .lt("clock_in", end.toISOString())
      .order("clock_in", { ascending: true });
    setEntries((entryData || []) as TimeEntry[]);

    const { data: corrData } = await supabase
      .from("time_corrections")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setCorrections((corrData || []) as Correction[]);

    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  async function currentUserId() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id || null;
  }

  // --- Segment-Builder ---
  function addSegment() {
    if (!draftStart || !draftEnd) {
      alert("Bitte Start und Ende angeben.");
      return;
    }
    if (draftEnd <= draftStart) {
      alert("Das Ende muss nach dem Start liegen.");
      return;
    }
    const s = hmToMin(draftStart);
    const e = hmToMin(draftEnd);
    const overlap = segments.some(
      (seg) => hmToMin(seg.start) < e && s < hmToMin(seg.end)
    );
    if (overlap) {
      alert(
        "Dieser Zeitraum überschneidet sich mit einer bereits hinzugefügten Buchung."
      );
      return;
    }
    const next = [
      ...segments,
      { id: idRef.current++, kind: draftKind, start: draftStart, end: draftEnd },
    ].sort((a, b) => hmToMin(a.start) - hmToMin(b.start));
    setSegments(next);
    setDraftStart("");
    setDraftEnd("");
  }

  function removeSegment(id: number) {
    setSegments(segments.filter((s) => s.id !== id));
  }

  async function submitAntrag() {
    const uid = await currentUserId();
    if (!uid) return;
    if (!segments.length) {
      alert("Bitte mindestens eine Buchung hinzufügen.");
      return;
    }
    const rows = segments.map((seg) => ({
      user_id: uid,
      entry_id: null,
      kind: "create",
      entry_kind: seg.kind,
      target_date: selectedDate,
      requested_clock_in: toISO(selectedDate, seg.start),
      requested_clock_out: toISO(selectedDate, seg.end),
      reason: antragReason || null,
    }));
    const { error } = await supabase.from("time_corrections").insert(rows);
    if (error) {
      alert(error.message);
      return;
    }
    setSegments([]);
    setAntragReason("");
    setDraftKind("work");
    setDraftStart("");
    setDraftEnd("");
    await loadData(selectedDate);
  }

  // --- Bestehende Buchung ändern/löschen ---
  function startEdit(entry: TimeEntry) {
    setAction({ mode: "edit", entry });
    setEditIn(timeInputValue(entry.clock_in));
    setEditOut(timeInputValue(entry.clock_out));
    setEditReason("");
  }
  function startDelete(entry: TimeEntry) {
    setAction({ mode: "delete", entry });
    setEditReason("");
  }
  async function submitAction() {
    if (!action) return;
    const uid = await currentUserId();
    if (!uid) return;

    if (action.mode === "edit") {
      if (!editIn) {
        alert("Bitte zumindest die Kommt-Zeit angeben.");
        return;
      }
      if (editOut && editOut < editIn) {
        alert("Die Geht-Zeit darf nicht vor der Kommt-Zeit liegen.");
        return;
      }
      // Auch Pausen laufen über den Korrekturantrag: jede nachträgliche
      // Änderung einer Zeitaufzeichnung muss genehmigt werden.
      if (isPause(action.entry) && !editOut) {
        alert("Bitte Start und Ende der Pause angeben.");
        return;
      }
      const { error } = await supabase.from("time_corrections").insert([
        {
          user_id: uid,
          entry_id: action.entry.id,
          kind: "edit",
          entry_kind: action.entry.kind || "work",
          target_date: selectedDate,
          requested_clock_in: toISO(selectedDate, editIn),
          requested_clock_out: editOut ? toISO(selectedDate, editOut) : null,
          reason: editReason || null,
        },
      ]);
      if (error) {
        alert(error.message);
        return;
      }
    } else {
      const { error } = await supabase.from("time_corrections").insert([
        {
          user_id: uid,
          entry_id: action.entry.id,
          kind: "delete",
          target_date: selectedDate,
          requested_clock_in: action.entry.clock_in,
          requested_clock_out: action.entry.clock_out,
          reason: editReason || null,
        },
      ]);
      if (error) {
        alert(error.message);
        return;
      }
    }
    setAction(null);
    await loadData(selectedDate);
  }

  const inputCls =
    "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

  const totalWork = segments
    .filter((s) => s.kind === "work")
    .reduce((a, s) => a + (hmToMin(s.end) - hmToMin(s.start)), 0);
  const totalPause = segments
    .filter((s) => s.kind === "pause")
    .reduce((a, s) => a + (hmToMin(s.end) - hmToMin(s.start)), 0);
  const netMin = Math.max(0, totalWork - totalPause);
  const legalWarn = totalWork > 360 && totalPause < 30;
  const editingPause =
    !!action && action.mode === "edit" && isPause(action.entry);

  return (
    <Shell
      title="Zeitkorrektur"
      subtitle="Vergessene oder falsche Stempelungen beantragen"
    >
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <span className="text-sm font-semibold text-slate-700">Tag</span>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => {
            setAction(null);
            setSelectedDate(e.target.value);
          }}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
        />
      </div>

      {/* Bestehende Buchungen */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-slate-900">
            Buchungen am {new Date(selectedDate).toLocaleDateString("de-DE")}
          </h2>
        </div>
        {loading ? (
          <p className="px-5 py-6 text-sm text-slate-500">Wird geladen…</p>
        ) : entries.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">
            Für diesen Tag gibt es keine Buchungen. Du kannst unten welche
            nachtragen.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Kommt</th>
                <th className="px-4 py-2.5">Geht</th>
                <th className="px-4 py-2.5 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5">
                    {isPause(e) && (
                      <span className="mr-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                        Pause
                      </span>
                    )}
                    {timeLabel(e.clock_in)}
                  </td>
                  <td className="px-4 py-2.5">{timeLabel(e.clock_out)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => startEdit(e)}
                        className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        Zeit ändern
                      </button>
                      <button
                        onClick={() => startDelete(e)}
                        className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Löschen
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Aktionspanel ändern/löschen */}
      {action && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/60 p-5">
          <h3 className="mb-1 text-[15px] font-semibold text-slate-900">
            {editingPause
              ? "Pausenzeit ändern beantragen"
              : action.mode === "edit"
              ? "Zeit ändern beantragen"
              : "Löschen beantragen"}
          </h3>
          {editingPause && (
            <p className="mb-3 text-[12.5px] text-slate-600">
              Auch Änderungen an Pausen müssen genehmigt werden. Die Buchung
              bleibt bis zur Freigabe unverändert.
            </p>
          )}
          {action.mode === "edit" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                  Neue Kommt-Zeit
                </label>
                <input
                  type="time"
                  value={editIn}
                  onChange={(e) => setEditIn(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                  Neue Geht-Zeit
                </label>
                <input
                  type="time"
                  value={editOut}
                  onChange={(e) => setEditOut(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              Buchung {timeLabel(action.entry.clock_in)} –{" "}
              {timeLabel(action.entry.clock_out)} zur Löschung vormerken.
            </p>
          )}
          {!editingPause && (
            <div className="mt-3">
              <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
                Grund
              </label>
              <input
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="z.B. Geht vergessen zu stempeln"
                className={inputCls}
              />
            </div>
          )}
          <div className="mt-4 flex gap-3">
            <button
              onClick={submitAction}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <Icon name="check" className="h-4 w-4" />
              {editingPause ? "Pause speichern" : "Antrag einreichen"}
            </button>
            <button
              onClick={() => setAction(null)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Segment-Builder: Buchungen nachtragen */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-[15px] font-semibold text-slate-900">
          Buchungen nachtragen
        </h2>
        <p className="mb-4 text-[12.5px] text-slate-500">
          Füge einzelne Segmente hinzu (z.B. Arbeit 12:00–14:00, dann Pause
          14:00–15:00) und sende am Schluss den gesamten Antrag.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
              Art
            </label>
            <select
              value={draftKind}
              onChange={(e) => setDraftKind(e.target.value)}
              className={inputCls}
            >
              <option value="work">Normalbuchung</option>
              <option value="pause">Pause</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
              Start
            </label>
            <input
              type="time"
              value={draftStart}
              onChange={(e) => setDraftStart(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
              Ende
            </label>
            <input
              type="time"
              value={draftEnd}
              onChange={(e) => setDraftEnd(e.target.value)}
              className={inputCls}
            />
          </div>
          <button
            onClick={addSegment}
            className="inline-flex h-[38px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <Icon name="plus" className="h-4 w-4 text-slate-500" />
            Hinzufügen
          </button>
        </div>

        {/* Segment-Liste */}
        {segments.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Art</th>
                  <th className="px-4 py-2">Von</th>
                  <th className="px-4 py-2">Bis</th>
                  <th className="px-4 py-2 text-right">Dauer</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {segments.map((seg) => (
                  <tr key={seg.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">
                      {seg.kind === "pause" ? (
                        <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          Pause
                        </span>
                      ) : (
                        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                          Normalbuchung
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">{seg.start}</td>
                    <td className="px-4 py-2">{seg.end}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {fmtMin(hmToMin(seg.end) - hmToMin(seg.start))}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => removeSegment(seg.id)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                        title="Entfernen"
                      >
                        <Icon name="x" className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-[12.5px] text-slate-600">
              <span>
                Arbeit: <b className="text-slate-800">{fmtMin(totalWork)}</b>
              </span>
              <span>
                Pause: <b className="text-slate-800">{fmtMin(totalPause)}</b>
              </span>
              <span>
                Netto: <b className="text-slate-800">{fmtMin(netMin)}</b>
              </span>
            </div>
          </div>
        )}

        {legalWarn && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
            <Icon name="info" className="h-4 w-4 shrink-0" />
            Über 6 Std Arbeitszeit – gesetzlich sind mind. 30 Min Pause
            vorgeschrieben. Füge noch eine Pause hinzu.
          </div>
        )}

        <div className="mt-3">
          <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">
            Grund
          </label>
          <input
            value={antragReason}
            onChange={(e) => setAntragReason(e.target.value)}
            placeholder="z.B. Stempeln komplett vergessen"
            className={inputCls}
          />
        </div>

        <button
          onClick={submitAntrag}
          disabled={segments.length === 0}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="check" className="h-4 w-4" />
          Antrag senden
          {segments.length > 0 ? ` (${segments.length})` : ""}
        </button>
      </div>

      {/* Eigene Korrekturanträge */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-slate-900">
            Meine Korrekturanträge
          </h2>
        </div>
        {corrections.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">
            Noch keine Korrekturanträge gestellt.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Datum</th>
                <th className="px-4 py-2.5">Art</th>
                <th className="px-4 py-2.5">Kommt</th>
                <th className="px-4 py-2.5">Geht</th>
                <th className="px-4 py-2.5">Grund</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {corrections.map((c) => {
                const label = statusLabel(c.status);
                return (
                  <tr key={c.id} className="border-t border-slate-100">
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
                      {c.kind === "delete"
                        ? "–"
                        : timeLabel(c.requested_clock_out)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {c.reason || "–"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${label.cls}`}
                      >
                        {label.text}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
