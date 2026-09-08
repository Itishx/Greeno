// The Express app, shared by two hosts.
//
//   server/index.cjs   local dev: one long-lived process with a real JSON file
//   api/index.js       Vercel: a serverless function with no filesystem at all
//
// The difference is ONE thing: where the store document comes from.
//
// Locally the store is read from disk once at boot, as it always was. On Vercel
// there is nowhere durable to write, so the BROWSER holds the document and
// sends it with each request; the request hydrates it into memory, the existing
// modules run against it unchanged, and the mutated document goes back in the
// response for the browser to keep.
//
// Nothing in app/lib had to be rewritten for this. greet.cjs, debrief.cjs,
// turn.cjs and memory.cjs cannot tell which mode they are in, which is why the
// tests that cover them still mean something.

const path = require("node:path");
const fs = require("node:fs");
const express = require("express");

// .env, same loader as the Mac app. On Vercel these come from project env vars
// and this loop simply finds no file.
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

// Serverless unless a local data directory is configured for us.
const LOCAL_DIR = process.env.GREENO_DATA_DIR
  || (process.env.VERCEL ? null : path.join(process.env.HOME || "/tmp", "Library", "Application Support", "Greeno"));

if (LOCAL_DIR) {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  store.init(LOCAL_DIR);
}

const app = express();
// Base64 audio is the biggest thing that crosses this boundary.
app.use(express.json({ limit: "25mb" }));

/**
 * Put the right store document in memory for this request.
 *
 * If the client sent one, that is the truth and the response must hand back
 * whatever the handlers changed. Otherwise we are local and the file on disk is
 * already loaded.
 */
function withStore(req) {
  const sent = req.body && typeof req.body.store === "object" && req.body.store !== null;
  if (sent) { store.hydrate(req.body.store); return true; }

  // Serverless with nothing sent yet: hydrate an empty document AND still
  // return it. Keying this off whether the client sent something loses the very
  // first save, which is the one that matters: a first-time visitor has no
  // document, so the notebook they just built would come back with nowhere to
  // live. Serverless always hands the document home.
  if (!LOCAL_DIR) { store.hydrate({}); return true; }

  return false;   // local: the file on disk is the durable copy
}

// One store-touching request at a time in this process.
//
// store.cjs keeps `cache` as a module global, and a warm serverless instance
// serves invocations concurrently. Without this lock, visitor A hydrates their
// document, awaits OpenAI for several seconds, and while it waits visitor B
// hydrates over the same global. A then resumes writing into B's document and
// sends B's notebook home in A's response, where A's browser saves it. That is
// one person's habits landing in another person's browser.
//
// Serializing is the cheap fix: the alternative is threading AsyncLocalStorage
// through twenty-five `cache.` references in a file that Electron, four library
// modules and six test files all depend on.
let queue = Promise.resolve();
const serialize = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.then(() => {}, () => {});   // a thrown handler must not wedge the queue
  return run;
};

const route = (fn) => async (req, res) => {
  try {
    // Hydrate, run, and capture the document as ONE atomic step. Capturing
    // outside the lock would hand back whatever the next request had loaded.
    const { data, doc } = await serialize(async () => {
      const hydrated = withStore(req);
      const out = await fn(req);
      // Copied, not referenced: the cache is reassigned by the next hydrate and
      // a live reference would be a second way to leak.
      return { data: out, doc: hydrated ? JSON.parse(JSON.stringify(store.all())) : null };
    });
    res.json({ ok: true, data, ...(doc ? { store: doc } : {}) });
  } catch (err) {
    console.error("[greeno-web]", err.message);
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
};

const today = () => new Date().toISOString().slice(0, 10);

/** Everything the habits tab needs, computed server-side so the client never
 *  disagrees with him about a streak. */
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
      todayValue: row ? Number(row.value) : 0,
      todayNote: row?.note || "",
    };
  });
}

const view = () => ({
  notebook: store.getNotebook(),
  approved: store.isApproved(),
  settings: store.getSettings(),
  progress: habitsView(),
  dueToday: store.getNotebook() ? nb.habitsDueToday(store.getNotebook()).map((h) => h.id) : [],
});

// GET has no body, so it can only ever answer for the local store. The web app
// uses POST /api/state and sends its document.
app.get("/api/state", route(() => ({ ...view(), ...meta() })));
app.post("/api/state", route(() => ({ ...view(), ...meta() })));

const meta = () => ({
  questions: QUESTIONS,
  asked: ASKED,
  askedDisplay: ASKED_DISPLAY,
  hasOpenAI: openai.hasKey(),
  hasFish: Boolean(process.env.FISH_AUDIO_API_KEY),
  serverless: !LOCAL_DIR,
});

app.post("/api/yap", route((req) =>
  yapToNotebook(req.body.answers || [], req.body.timezone || "UTC")));

app.post("/api/notebook", route((req) => {
  store.saveNotebook(nb.ensureIds(req.body.notebook), { approved: Boolean(req.body.approved) });
  return view();
}));

app.post("/api/transcribe", route(async (req) => {
  const buf = Buffer.from(String(req.body.audio || ""), "base64");
  if (!buf.length) throw new Error("no audio");
  return { text: await openai.transcribe(buf, { mimeType: req.body.mimeType || "audio/webm" }) };
}));

app.post("/api/checkin", route((req) => {
  const book = store.getNotebook();
  if (!book) throw new Error("no notebook yet");
  const habit = (book.habits || []).find((h) => h.id === req.body.habitId);
  if (!habit) throw new Error(`no habit called ${req.body.habitId}`);
  store.upsertCheckin({
    habitId: habit.id,
    day: req.body.day || today(),
    value: Number(req.body.value ?? habit.target) || 0,
    note: String(req.body.note || ""),
    source: "manual",
  });
  return { progress: habitsView() };
}));

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
  return view();
}));

app.post("/api/habit/update", route((req) => {
  const book = store.getNotebook();
  const habit = (book?.habits || []).find((h) => h.id === req.body.id);
  if (!habit) throw new Error("no such habit");
  if (req.body.title !== undefined) habit.title = String(req.body.title).trim() || habit.title;
  if (req.body.target !== undefined) habit.target = Number(req.body.target) > 0 ? Number(req.body.target) : 1;
  if (req.body.unit !== undefined) habit.unit = String(req.body.unit) || habit.unit;
  if (["daily", "weekly", "monthly"].includes(req.body.cadence)) habit.cadence = req.body.cadence;
  store.saveNotebook(book);
  return view();
}));

app.post("/api/habit/delete", route((req) => {
  const book = store.getNotebook();
  if (!book) throw new Error("no notebook yet");
  const id = String(req.body.id || "");
  book.habits = (book.habits || []).filter((h) => h.id !== id);
  const all = store.all();
  all.checkins = all.checkins.filter((c) => c.habitId !== id);
  store.saveNotebook(book);
  return view();
}));

app.post("/api/debrief", route((req) => debrief(req.body.transcript)));
app.post("/api/turn", route((req) => turn(req.body)));
app.post("/api/greet", route(() => morningGreet({})));
app.post("/api/settings", route((req) => ({ settings: store.saveSettings(req.body.patch || {}) })));
app.post("/api/reset", route(() => { store.reset(); return view(); }));

// Everything he knows, as a file. For a design whose data lives in one browser,
// this is the only backup that exists, so it must not quietly 404.
app.post("/api/export", route(() => store.all()));

// His voice. Streamed, so playback starts on the first chunk rather than the
// last. Not wrapped in route(): the body is audio, not JSON.
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

module.exports = app;
module.exports.LOCAL_DIR = LOCAL_DIR;
