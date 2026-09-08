// The notebook: the contract every other piece depends on.
//
// Three sections, and they are the three the dashboard shows:
//
//   ROUTINES  the recurring shape of the day, plus the automations they wish
//             they had. A wished automation is a routine that does not exist yet.
//   HABITS    the things with a target and a cadence. What he holds them to.
//             What keeps slipping hangs off this section.
//   FOCUS     deep work windows, what pulls them out, what they listen to.
//
// Change the shape here and change the summarizer prompt in yap.cjs in the same
// commit. They are one thing wearing two hats.

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const SECTIONS = ["routines", "habits", "focus"];

function emptyNotebook(timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  return {
    startTime: "08:30",
    timezone,
    routines: [],
    habits: [],
    focus: { deepWork: [], distractions: [], music: { mood: "", service: "none", playlist: "" } },
    automations: [],
    slipping: [],
  };
}

/**
 * Which habits are actually due today. Pure and testable, and the place where a
 * weekly habit quietly becoming a daily nag would show up.
 */
function habitsDueToday(book, today = new Date()) {
  if (!book?.habits?.length) return [];
  const dow = DAYS[today.getDay()];
  return book.habits.filter((h) => {
    if (h.cadence === "daily") return true;
    if (h.cadence === "weekly") return dow === "mon";   // surfaced once, at the top of the week
    if (h.cadence === "monthly") return today.getDate() === 1;
    return false;
  });
}

/** "mon, tue 09:00 to 11:30" out of a deepWork array. */
function describeWindows(windows = []) {
  if (!windows.length) return "";
  return windows
    .map((w) => {
      const days = (w.days || []).join(", ");
      return days ? `${days} ${w.start} to ${w.end}` : `${w.start} to ${w.end}`;
    })
    .join("; ");
}

/** Which routine blocks run today. */
function routinesToday(book, today = new Date()) {
  if (!book?.routines?.length) return [];
  const dow = DAYS[today.getDay()];
  return book.routines
    .filter((r) => (r.days || []).includes(dow))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

/** "HH:MM" to minutes since midnight. Returns null on anything unparseable. */
function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Are we inside one of their deep work windows right now. */
function inDeepWork(book, now = new Date()) {
  const dow = DAYS[now.getDay()];
  const mins = now.getHours() * 60 + now.getMinutes();
  return (book?.focus?.deepWork || []).some((w) => {
    if (!(w.days || []).includes(dow)) return false;
    const s = toMinutes(w.start);
    const e = toMinutes(w.end);
    return s !== null && e !== null && mins >= s && mins <= e;
  });
}

/**
 * Progress per habit over its own cadence window, for the dashboard bars.
 * Reads the check-in ledger, never the notebook document.
 */
function progress(book, checkins, today = new Date()) {
  const day = today.toISOString().slice(0, 10);
  const weekStart = new Date(today.getTime() - ((today.getDay() + 6) % 7) * 86400000)
    .toISOString().slice(0, 10);
  const monthStart = `${day.slice(0, 7)}-01`;

  return (book?.habits || []).map((h) => {
    const from = h.cadence === "daily" ? day : h.cadence === "weekly" ? weekStart : monthStart;
    const rows = checkins.filter((c) => c.habitId === h.id && c.day >= from && c.day <= day);
    const done = rows.reduce((sum, c) => sum + Number(c.value || 0), 0);
    const target = Number(h.target) || 1;
    return {
      ...h,
      done,
      target,
      pct: Math.max(0, Math.min(100, Math.round((done / target) * 100))),
      lastNote: rows.length ? rows[rows.length - 1].note : "",
    };
  });
}

/**
 * A habit has been missing most of its window. Feeds the "slipping" moment.
 * Deliberately quiet: it needs a real run of misses, not one bad day.
 */
function slippingHabits(book, checkins, today = new Date()) {
  const out = [];
  for (const h of book?.habits || []) {
    if (h.cadence !== "daily") continue;
    let misses = 0;
    for (let i = 1; i <= 5; i++) {
      const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
      const hit = checkins.find((c) => c.habitId === h.id && c.day === d);
      if (!hit || Number(hit.value) < Number(h.target)) misses++;
    }
    if (misses >= 4) out.push(h);
  }
  return out;
}

/** Give every habit, routine and automation a stable id so patches survive a re-summarize. */
function ensureIds(book) {
  const slug = (s, i, p) =>
    (String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `${p}${i}`).slice(0, 40);
  (book.habits || []).forEach((h, i) => { if (!h.id) h.id = slug(h.title, i, "habit_"); });
  (book.routines || []).forEach((r, i) => { if (!r.id) r.id = slug(r.label, i, "routine_"); });
  (book.automations || []).forEach((a, i) => { if (!a.id) a.id = slug(a.title, i, "auto_"); });
  return book;
}

/** A one-line count per section, for the notch and the read-back header. */
function summarize(book) {
  if (!book) return { routines: 0, habits: 0, focus: 0 };
  return {
    routines: (book.routines?.length || 0) + (book.automations?.length || 0),
    habits: book.habits?.length || 0,
    focus: (book.focus?.deepWork?.length || 0) + (book.focus?.distractions?.length || 0),
  };
}

module.exports = {
  DAYS, SECTIONS, emptyNotebook, habitsDueToday, describeWindows, routinesToday,
  toMinutes, inDeepWork, progress, slippingHabits, ensureIds, summarize,
};
