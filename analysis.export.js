// analysis.export.js
// CSV + download helpers

export function summaryToCSVRow(summary) {
  const cols = Object.keys(summary);
  const vals = cols.map((k) => csvEscape(summary[k]));
  return { header: cols.join(","), row: vals.join(",") };
}

export function downloadCSV(filename, header, row) {
  const csv = header + "\n" + row + "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}