// Kleiner Helfer zum Download einer CSV-Datei (Excel-kompatibel).
// Semikolon als Trenner + BOM, damit Umlaute in Excel korrekt erscheinen.

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const sep = ";";
  const body = rows
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell ?? "");
          return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(sep)
    )
    .join("\r\n");

  const blob = new Blob(["﻿" + body], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
