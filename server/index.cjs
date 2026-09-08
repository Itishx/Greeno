// The web app's server half.
//
// It is deliberately thin: every real decision already lives in app/lib, which
// the Mac app runs too. This file is only routing, so the two surfaces cannot
// drift into disagreeing about what a notebook is.

const path = require("node:path");
const fs = require("node:fs");
const express = require("express");

// .env, same loader as the Mac app.
for (const p of [path.join(__dirname, "..", ".env")]) {
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const store = require("../app/lib/store.cjs");
const nb = require("../app/lib/notebook.cjs");
const openai = require("../app/lib/openai.cjs");
const tts = require("../app/lib/tts.cjs");
const { yapToNotebook, QUESTIONS, ASKED, ASKED_DISPLAY } = require("../app/lib/yap.cjs");
const { morningGreet } = require("../app/lib/greet.cjs");
const { debrief } = require("../app/lib/debrief.cjs");
const { turn } = require("../app/lib/turn.cjs");

// The same store file the Mac app uses, so a notebook built on the web is the
// one he greets you from in the notch.
const DATA_DIR = process.env.GREENO_DATA_DIR
  || path.join(process.env.HOME, "Library", "Application Support", "Greeno");
fs.mkdirSync(DATA_DIR, { recursive: true });
store.init(DATA_DIR);

const app = express();
app.use(express.json({ limit: "25mb" }));

// Every handler reports its own failure rather than throwing a stack at the
// browser, because the front end shows these strings to a person.
const route = (fn) => async (req, res) => {
  try { res.json({ ok: true, data: await fn(req) }); }
  catch (err) {
    console.error("[greeno-web]", err.message);
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Everything the habits tab needs, computed here so the client never has to
 * recompute a streak and get a different answer than he does.
 */
function habitsView() {
  const book = store.getNotebook();
  if (!book) return [];
  const checkins = store.checkinsSince(60);
  const day = today();
  return nb.progress(book, checkins).map((h) => {
    const row = checkins.find((c) => c.habitId === h.id && c.day === day);
    return {
      ...h,
      streak: store.streakFor(h.id, h.target),
      // What was logged TODAY specifically, which is what the tick reflects.
      // progress.done spans the whole cadence window, so a weekly habit at 2/3
      // is not the same question as "did you go today".
      todayValue: row ? Number(row.value) : 0,
      todayNote: row?.note || "",
    };
  });
}

app.get("/api/state", route(() => ({
  notebook: store.getNotebook(),
  approved: store.isApproved(),
  settings: store.getSettings(),
  progress: habitsView(),
  dueToday: store.getNotebook() ? nb.habitsDueToday(store.getNotebook()).map((h) => h.id) : [],
  questions: QUESTIONS,
  asked: ASKED,
  askedDisplay: ASKED_DISPLAY,
  hasOpenAI: openai.hasKey(),
  hasFish: Boolean(process.env.FISH_AUDIO_API_KEY),
})));

// ── ticking a habit off ─────────────────────────────────────────────────────
// The whole point of a tracker, and it did not exist: check-ins were only ever
// written by the night debrief, so there was no way to say "I did it" by hand.
app.post("/api/checkin", route((req) => {
  const book = store.getNotebook();
  if (!book) throw new Error("no notebook yet");
  const habit = (book.habits || []).find((h) => h.id === req.body.habitId);
  if (!habit) throw new Error(`no habit called ${req.body.habitId}`);

  store.upsertCheckin({
    habitId: habit.id,
    day: req.body.day || today(),
    // Unique on (habitId, day), so ticking twice corrects rather than doubles.
    value: Number(req.body.value ?? habit.target) || 0,
    note: String(req.body.note || ""),
    source: "manual",
  });
  return { progress: habitsView() };
}));

// ── habit CRUD ──────────────────────────────────────────────────────────────
app.post("/api/habit/add", route((req) => {
  const book = store.getNotebook();
  if (!book) throw new Error("no notebook yet");
  const title = String(req.body.title || "").trim();
  if (!title) throw new Error("a habit needs a name");
  book.habits = book.habits || [];
  book.habits.push({
    title,
    cadence: ["daily", "weekly", "monthly"].includes(req.body.cadence) ? req.body.cadence : "daily",
    target: Number(req.body.target) > 0 ? Number(req.body.target) : 1,
    unit: String(req.body.unit || "session"),
    why: String(req.body.why || ""),
  });
  store.saveNotebook(nb.ensureIds(book));
  return { notebook: store.getNotebook(), progress: habitsView() };
}));

app.post("/api/habit/update", route((req) => {
  const book = store.getNotebook();
  const habit = (book?.habits || []).find((h) => h.id === req.body.id);
  if (!habit) throw new Error("no such habit");
  if (req.body.title !== undefined) habit.title = String(req.body.title).trim() || habit.title;
  if (req.body.target !== undefined) habit.target = Number(req.body.target) > 0 ? Number(req.body.target) : 1;
  if (req.body.unit !== undefined) habit.unit = String(req.body.unit) || habit.unit;
  if (["daily", "weekly", "monthly"].includes(req.body.cadence)) habit.cadence = req.body.cadence;
  // Its id is kept: renaming a habit must not orphan the check-ins under it.
  store.saveNotebook(book);
  return { notebook: store.getNotebook(), progress: habitsView() };
}));

app.post("/api/habit/delete", route((req) => {
  const book = store.getNotebook();
  if (!book) throw new Error("no notebook yet");
  const id = String(req.body.id || "");
  book.habits = (book.habits || []).filter((h) => h.id !== id);
  // Its check-ins go too. Leaving them behind means a deleted habit can walk
  // back into progress the moment somebody re-adds the same name.
  const all = store.all();
  all.checkins = all.checkins.filter((c) => c.habitId !== id);
  store.saveNotebook(book);
  return { notebook: store.getNotebook(), progress: habitsView() };
}));

// Everything he knows, as a file. Ten minutes of work, and it is the difference
// between data you own and data you are renting.
app.get("/api/export", (_req, res) => {
  res.set("Content-Disposition", `attachment; filename="greeno-${today()}.json"`);
  res.json(store.all());
});

app.post("/api/yap", route((req) =>
  yapToNotebook(req.body.answers || [], req.body.timezone || "UTC")));

app.post("/api/notebook", route((req) => {
  const saved = store.saveNotebook(nb.ensureIds(req.body.notebook), { approved: Boolean(req.body.approved) });
  return saved;
}));

app.post("/api/transcribe", route(async (req) => {
  const buf = Buffer.from(String(req.body.audio || ""), "base64");
  if (!buf.length) throw new Error("no audio");
  return { text: await openai.transcribe(buf, { mimeType: req.body.mimeType || "audio/webm" }) };
}));

app.post("/api/debrief", route((req) => debrief(req.body.transcript)));
app.post("/api/turn", route((req) => turn(req.body)));
app.post("/api/greet", route(() => morningGreet({})));
app.post("/api/settings", route((req) => store.saveSettings(req.body.patch || {})));
app.post("/api/reset", route(() => { store.reset(); return true; }));

// His voice, streamed, so playback starts on the first chunk.
app.get("/api/tts", async (req, res) => {
  try {
    const text = String(req.query.text || "");
    if (!text.trim()) return res.status(400).end();
    const { res: upstream, provider } = await tts.speak(text);
    res.set({ "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Voice-Provider": provider });
    require("node:stream").Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error("[greeno-web] tts", err.message);
    if (!res.headersSent) res.status(502).type("text/plain");
    res.end(String(err.message));
  }
});

// The built site, when there is one.
const dist = path.join(__dirname, "..", "dist-web");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[greeno-web] api on http://127.0.0.1:${PORT}  (data: ${DATA_DIR})`);
  if (!openai.hasKey()) console.warn("[greeno-web] no OPENAI_API_KEY, the summarizer will not run");
});
