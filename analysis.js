// analysis.js
// Turns your session payload into user-friendly summary + CSV download

export function computeSummary(session) {
  if (!session) return null;

  const t = session.rounds?.typing || {};
  const tap = session.rounds?.tapping || {};

  const typingAcc =
    t.attempts ? Math.round((t.correct / t.attempts) * 100) : 0;

  const tapTotal = (tap.hits || 0) + (tap.misses || 0);
  const tapAcc =
    tapTotal ? Math.round(((tap.hits || 0) / tapTotal) * 100) : 0;

  // If you're now using "tap score = hits - misses"
  const tapScore = (tap.hits || 0) - (tap.misses || 0);

  const typingScore = t.score ?? 0;
  const totalScore = (typingScore || 0) + (tapScore || 0);

  return {
    schemaVersion: session.schemaVersion ?? null,
    sessionId: session.sessionId ?? "",
    sessionIndex: session.sessionIndex ?? null,
    participantId: session.participantId ?? "",
    displayName: session.displayName ?? "",
    createdAtClientISO: session.createdAtClientISO ?? "",

    timeBucket: session.context?.timeBucket ?? "",
    fatigue: session.context?.fatigue ?? null,
    inputDevice: session.context?.inputDevice ?? "",
    vibration: session.context?.vibration ?? "",
    alcohol: session.context?.alcohol ?? "",

    typingScore,
    typingAttempts: t.attempts ?? 0,
    typingCorrect: t.correct ?? 0,
    typingAccuracyPct: typingAcc,
    typingMeanIktMs: t.meanIktMs ?? null,
    typingBackspaces: t.backspaces ?? 0,

    tapHits: tap.hits ?? 0,
    tapMisses: tap.misses ?? 0,
    tapScore,
    tapAccuracyPct: tapAcc,
    tapMeanRtMs: tap.meanRtMs ?? null,

    totalScore
  };
}

export function summaryToCSVRow(summary) {
  const cols = Object.keys(summary);
  const vals = cols.map((k) => csvEscape(summary[k]));
  return { header: cols.join(","), row: vals.join(",") };
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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

export function renderSummaryTable(containerEl, summary) {
  if (!containerEl) return;
  containerEl.innerHTML = "";

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";

  for (const [k, v] of Object.entries(summary)) {
    const tr = document.createElement("tr");

    const tdK = document.createElement("td");
    tdK.textContent = k;
    tdK.style.padding = "8px";
    tdK.style.opacity = "0.8";
    tdK.style.borderBottom = "1px solid rgba(255,255,255,0.08)";

    const tdV = document.createElement("td");
    tdV.textContent = v === null ? "—" : String(v);
    tdV.style.padding = "8px";
    tdV.style.borderBottom = "1px solid rgba(255,255,255,0.08)";

    tr.appendChild(tdK);
    tr.appendChild(tdV);
    table.appendChild(tr);
  }

  containerEl.appendChild(table);
}