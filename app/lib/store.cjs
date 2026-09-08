// The local store. Same three shapes as the Postgres schema in the build doc, so
// this lifts to Supabase later without touching a caller:
//
//   notebooks  one document per user, the whole of who they are
//   checkins   one row per habit per day, the ledger the night debrief writes
//   showups    every time he spoke first, which is what enforces "three moments"
//
// It is a single JSON file because there is one user on one Mac. Writes are
// atomic (write a temp file, rename over the real one) so a crash mid-save
// cannot leave someone with half a notebook.

const fs = require("node:fs");
const path = require("node:path");

let FILE = null;
let cache = null;

// A FUNCTION, not a shared object. Spreading a template with arrays in it copies
// the references, so every reset handed back the same arrays and the template
// itself accumulated rows forever. Caught by a test that reset twice and found
// eleven memories where it had written eight.
function empty() {
  return { notebook: null, approvedAt: null, checkins: [], showups: [], memories: [], settings: {}, meta: {} };
}

function init(userDataDir) {
  FILE = path.join(userDataDir, "greeno.json");
  cache = read();
  return FILE;
}

/**
 * Load a whole store document straight into memory, with no file behind it.
 *
 * This is what lets the same modules run on a serverless host. Vercel's
 * filesystem is ephemeral, so there is nowhere to write; instead the browser
 * keeps the document and sends it with each request, the request hydrates it
 * here, and every caller below carries on exactly as it does on the Mac.
 *
 * Nothing else in this file needed to change, which is the point: greet.cjs,
 * debrief.cjs, turn.cjs, nudge.cjs and memory.cjs are all already tested
 * against this interface and none of them can tell the difference.
 */
function hydrate(doc) {
  FILE = null;                       // no file, so flush() becomes a no-op
  cache = { ...empty(), ...(doc || {}) };
  return cache;
}

function read() {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return { ...empty(), ...parsed };
  } catch {
    return empty();
  }
}

function flush() {
  // Hydrated (serverless) mode has nowhere to write. The caller returns
  // store.all() to the browser instead, which is the durable copy.
  if (!FILE) return;
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf8");
  fs.renameSync(tmp, FILE);
}

// ── the notebook ────────────────────────────────────────────────────────────
function getNotebook() {
  return cache.notebook;
}

function saveNotebook(nb, { approved = false } = {}) {
  cache.notebook = nb;
  if (approved) cache.approvedAt = new Date().toISOString();
  flush();
  return cache.notebook;
}

function isApproved() {
  return Boolean(cache.approvedAt);
}

// ── check-ins ───────────────────────────────────────────────────────────────
// unique (habit_id, day): one truth per habit per day, so a second debrief on the
// same evening corrects the first rather than double-counting it.
function upsertCheckin({ habitId, day, value, note, source = "debrief" }) {
  const existing = cache.checkins.find((c) => c.habitId === habitId && c.day === day);
  if (existing) {
    Object.assign(existing, { value, note, source, createdAt: existing.createdAt });
  } else {
    cache.checkins.push({
      id: `ci_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      habitId, day, value, note, source,
      createdAt: new Date().toISOString(),
    });
  }
  flush();
}

function checkinsSince(days = 30) {
  const cut = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return cache.checkins.filter((c) => c.day >= cut).sort((a, b) => (a.day < b.day ? 1 : -1));
}

function checkinsForDay(day) {
  return cache.checkins.filter((c) => c.day === day);
}

// How many days in a row this habit has been met. Feeds the "streak" moment.
function streakFor(habitId, target, today = new Date()) {
  let n = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    const hit = cache.checkins.find((c) => c.habitId === habitId && c.day === d);
    if (hit && Number(hit.value) >= Number(target)) n++;
    else if (i > 0) break;          // today not yet logged is not a broken streak
    else if (!hit) continue;
  }
  return n;
}

// ── show-ups ────────────────────────────────────────────────────────────────
function logShowup(kind, said, acted = false) {
  cache.showups.push({
    id: `su_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind, said, acted,
    createdAt: new Date().toISOString(),
  });
  flush();
}

function lastShowups(kind, n = 3) {
  return cache.showups
    .filter((s) => s.kind === kind)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, n);
}

function lastShowup(kind) {
  return lastShowups(kind, 1)[0] || null;
}

function markShowupActed(id) {
  const s = cache.showups.find((x) => x.id === id);
  if (s) { s.acted = true; flush(); }
}

// Did he greet / debrief already today. Stops a restart of the app from firing a
// second morning greet at 09:15 because the process is new.
function didToday(kind, today = new Date()) {
  const day = today.toISOString().slice(0, 10);
  return cache.showups.some((s) => s.kind === kind && s.createdAt.slice(0, 10) === day);
}

// Days since he last heard from them at all. Feeds the "ghosted" moment.
function daysSinceLastDebrief(today = new Date()) {
  const last = lastShowup("night");
  if (!last) return null;
  const then = new Date(last.createdAt);
  return Math.floor((today - then) / 86400000);
}

// ── memories ────────────────────────────────────────────────────────────────
// The unstructured half of what he knows. The notebook is structured and edited
// by the user; memories are ambient and never are. Same idea at two resolutions,
// which is why they are their own list rather than a view over the notebook.
function allMemories() {
  return cache.memories || [];
}

function activeMemories() {
  return allMemories().filter((m) => m.status !== "archived");
}

function addMemory({ content, category, salience }) {
  const now = new Date().toISOString();
  const m = {
    id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content, category, salience,
    source: "auto", status: "active",
    created_at: now, updated_at: now, last_used_at: null,
  };
  cache.memories.push(m);
  return m;
}

function updateMemory(id, patch) {
  const m = allMemories().find((x) => x.id === id);
  if (!m) return null;
  Object.assign(m, patch, { updated_at: new Date().toISOString() });
  return m;
}

function archiveMemory(id) {
  return updateMemory(id, { status: "archived" });
}

function touchMemories(ids) {
  const now = new Date().toISOString();
  let hit = false;
  for (const id of ids) {
    const m = allMemories().find((x) => x.id === id);
    if (m) { m.last_used_at = now; hit = true; }
  }
  if (hit) flush();
}

// Over the cap, the lowest-salience and oldest get ARCHIVED, never deleted.
// Someone's own facts about themselves are not ours to throw away.
function enforceMemoryCap(storeCap) {
  const active = activeMemories();
  if (active.length <= storeCap) return 0;
  const ranked = [...active].sort((a, b) => {
    if (a.salience !== b.salience) return a.salience - b.salience;
    return String(a.last_used_at || a.created_at).localeCompare(String(b.last_used_at || b.created_at));
  });
  const overflow = ranked.slice(0, active.length - storeCap);
  overflow.forEach((m) => { m.status = "archived"; m.updated_at = new Date().toISOString(); });
  return overflow.length;
}

function saveMemories() { flush(); }

// ── settings and misc ───────────────────────────────────────────────────────
function getSettings() { return cache.settings || {}; }
function saveSettings(patch) { cache.settings = { ...cache.settings, ...patch }; flush(); return cache.settings; }
function getMeta(k, d = null) { return k in (cache.meta || {}) ? cache.meta[k] : d; }
function setMeta(k, v) { cache.meta = { ...cache.meta, [k]: v }; flush(); }

function all() { return cache; }
function reset() { cache = empty(); flush(); }

module.exports = {
  init, hydrate, all, reset,
  getNotebook, saveNotebook, isApproved,
  upsertCheckin, checkinsSince, checkinsForDay, streakFor,
  logShowup, lastShowup, lastShowups, markShowupActed, didToday, daysSinceLastDebrief,
  getSettings, saveSettings, getMeta, setMeta,
  allMemories, activeMemories, addMemory, updateMemory, archiveMemory,
  touchMemories, enforceMemoryCap, saveMemories,
};
