// What Greeno can actually do to this Mac.
//
// A CLOSED allowlist, on purpose. Every capability is written out by hand here,
// and the delegate router can only ever name one of these. A model that can
// synthesise an arbitrary shell command is a model that can do arbitrary things
// to your machine, and no amount of prompt is a security boundary.
//
// One capability is deliberately missing and always will be: there is nothing in
// here that sends a message to a person. He will remind you to text your mum. He
// will never text her. Chores get automated, relationships never do.

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);

const TIMEOUT = 12000;

async function osa(script) {
  const { stdout } = await run("osascript", ["-e", script], { timeout: TIMEOUT });
  return stdout.trim();
}

// A bare "Command failed" from osascript is almost never a code bug. It is a
// consent prompt hanging invisibly, because dev builds lose their TCC grant on
// every rebuild. Say so, rather than sending someone to debug working code.
function explain(err, what) {
  const raw = String(err?.stderr || err?.message || err);
  if (/not authori[sz]ed|assistive access|-1743|-25211/i.test(raw)) {
    return new Error(`macOS has not granted permission for ${what}. System Settings, Privacy and Security, Automation and Accessibility. In a dev build this grant is voided by every rebuild.`);
  }
  if (/Command failed/i.test(raw) && !raw.includes("execution error")) {
    return new Error(`${what} did not run. This is usually a consent prompt waiting invisibly rather than a bug. Check System Settings, Privacy and Security.`);
  }
  return new Error(`${what} failed: ${raw.split("\n")[0].slice(0, 200)}`);
}

// ── focus ────────────────────────────────────────────────────────────────────
// The Shortcuts route is the real one: a Shortcut that sets a Focus is the only
// supported way to touch Focus, and Focus syncs to the iPhone by itself through
// Share Across Devices. That iPhone sync is free and is the whole reason this is
// worth doing through Shortcuts rather than faking Do Not Disturb locally.
async function focusOn({ shortcut = "Greeno Focus" } = {}) {
  try {
    await run("shortcuts", ["run", shortcut], { timeout: TIMEOUT });
    return { ok: true, via: "shortcuts", shortcut };
  } catch (err) {
    throw new Error(`I could not run the "${shortcut}" Shortcut. Make one in the Shortcuts app that sets a Focus, name it exactly that, and I will use it. (${String(err.stderr || err.message).split("\n")[0].slice(0, 160)})`);
  }
}

async function focusOff({ shortcut = "Greeno Focus Off" } = {}) {
  await run("shortcuts", ["run", shortcut], { timeout: TIMEOUT });
  return { ok: true, via: "shortcuts", shortcut };
}

async function listShortcuts() {
  const { stdout } = await run("shortcuts", ["list"], { timeout: TIMEOUT });
  return stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

async function runShortcut({ name }) {
  if (!name) throw new Error("no shortcut named");
  await run("shortcuts", ["run", name], { timeout: TIMEOUT });
  return { ok: true, name };
}

// ── apps and pages ───────────────────────────────────────────────────────────
async function openApp({ name }) {
  if (!name) throw new Error("no app named");
  await run("open", ["-a", name], { timeout: TIMEOUT });
  return { ok: true, name };
}

// Quitting is the one thing the stuck nudge actually offers to do, so it asks
// politely (AppleScript quit) rather than killing. An unsaved document is worth
// more than a tidy screen.
async function quitApp({ name }) {
  if (!name) throw new Error("no app named");
  try {
    await osa(`tell application ${JSON.stringify(name)} to quit`);
    return { ok: true, name };
  } catch (err) {
    throw explain(err, `quitting ${name}`);
  }
}

async function openUrl({ url }) {
  if (!/^https?:\/\//i.test(String(url || ""))) throw new Error("only http and https links");
  await run("open", [url], { timeout: TIMEOUT });
  return { ok: true, url };
}

async function frontApp() {
  try {
    return await osa('tell application "System Events" to return name of first process whose frontmost is true');
  } catch { return ""; }
}

async function runningApps() {
  try {
    const out = await osa('tell application "System Events" to return name of every process whose background only is false');
    return out.split(", ").map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

// ── music ────────────────────────────────────────────────────────────────────
const PLAYERS = { spotify: "Spotify", apple: "Music" };

async function musicPlay({ service = "spotify", playlist } = {}) {
  const app = PLAYERS[service] || PLAYERS.spotify;
  try {
    if (playlist && service === "spotify" && /^spotify:/.test(playlist)) {
      await osa(`tell application "Spotify" to play track ${JSON.stringify(playlist)}`);
    } else {
      await run("open", ["-a", app], { timeout: TIMEOUT });
      await osa(`tell application ${JSON.stringify(app)} to play`);
    }
    return { ok: true, app };
  } catch (err) {
    throw explain(err, `playing ${app}`);
  }
}

async function musicPause({ service = "spotify" } = {}) {
  const app = PLAYERS[service] || PLAYERS.spotify;
  try {
    await osa(`tell application ${JSON.stringify(app)} to pause`);
    return { ok: true, app };
  } catch (err) {
    throw explain(err, `pausing ${app}`);
  }
}

async function nowPlaying({ service = "spotify" } = {}) {
  const app = PLAYERS[service] || PLAYERS.spotify;
  try {
    const out = await osa(
      `tell application ${JSON.stringify(app)} to if player state is playing then return (name of current track) & " ~ " & (artist of current track)`,
    );
    if (!out) return null;
    const [track, artist] = out.split(" ~ ");
    return { track, artist, app };
  } catch { return null; }
}

// ── the registry the delegate router is allowed to name ─────────────────────
const ACTIONS = {
  "focus.on": { fn: focusOn, label: "start a focus block", confirm: false },
  "focus.off": { fn: focusOff, label: "end the focus block", confirm: false },
  "app.open": { fn: openApp, label: "open an app", confirm: false },
  // Quitting closes someone's work, so it never happens without a yes.
  "app.quit": { fn: quitApp, label: "quit an app", confirm: true },
  "url.open": { fn: openUrl, label: "open a link", confirm: false },
  "music.play": { fn: musicPlay, label: "start the music", confirm: false },
  "music.pause": { fn: musicPause, label: "stop the music", confirm: false },
  "shortcut.run": { fn: runShortcut, label: "run one of your Shortcuts", confirm: true },
};

const ACTION_IDS = Object.keys(ACTIONS);

async function perform(id, args = {}) {
  const entry = ACTIONS[id];
  if (!entry) throw new Error(`${id} is not something I can do`);
  return entry.fn(args || {});
}

function needsConfirm(id) {
  return Boolean(ACTIONS[id]?.confirm);
}

module.exports = {
  ACTIONS, ACTION_IDS, perform, needsConfirm,
  focusOn, focusOff, listShortcuts, runShortcut,
  openApp, quitApp, openUrl, frontApp, runningApps,
  musicPlay, musicPause, nowPlaying,
};
