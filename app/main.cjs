// Greeno / Braino Companion — the Mac shell.
//
// The main process is the trusted side: API keys, the store, the three moments,
// and the screen glance all live here. The renderer only ever gets results.

const { app, BrowserWindow, ipcMain, screen, globalShortcut, desktopCapturer, shell, systemPreferences, Tray, Menu, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { Readable } = require("node:stream");

// ── .env, without a dependency ──────────────────────────────────────────────
(function loadEnv() {
  for (const p of [path.join(__dirname, "..", ".env"), path.join(process.resourcesPath || "", ".env")]) {
    if (!p || !fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const v = m[2].replace(/^["']|["']$/g, "");
      if (v && !process.env[m[1]]) process.env[m[1]] = v;
    }
    break;
  }
})();

const store = require("./lib/store.cjs");
const openai = require("./lib/openai.cjs");
const tts = require("./lib/tts.cjs");
const { yapToNotebook, QUESTIONS, ASKED, ASKED_DISPLAY } = require("./lib/yap.cjs");
const { morningGreet } = require("./lib/greet.cjs");
const { debrief } = require("./lib/debrief.cjs");
const nudge = require("./lib/nudge.cjs");
const { turn } = require("./lib/turn.cjs");
const actions = require("./lib/actions.cjs");
const delegate = require("./lib/delegate.cjs");
const realtime = require("./lib/realtime.cjs");
const nb = require("./lib/notebook.cjs");

const DEV = process.argv.includes("--dev");

// ONE Greeno. A second instance puts a second notch window on the screen with a
// second mascot walking around in it, plus a second hotkey tap and a second set
// of moment timers firing the same greet twice. It reads as a duplication bug in
// the app when it is really just the app running twice, so the app refuses.
if (!app.requestSingleInstanceLock()) {
  console.log("[greeno] already running; leaving the first one alone");
  app.quit();
  process.exit(0);
}
let notchWin = null;
let bookWin = null;
let hotkeyProc = null;
let ttsServer = null;
let tray = null;
let bootFinished = false;
let pendingRoute = null;
let ttsPort = 0;
const ttsToken = crypto.randomBytes(24).toString("hex");
const log = (...a) => console.log("[greeno]", ...a);

// ─────────────────────────────────────────────────────────────────────────────
// The notch window.
//
// Every option below is load-bearing. This is the single hardest-won block of
// configuration in the product and none of it is decorative.
// ─────────────────────────────────────────────────────────────────────────────
function createNotch() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;

  notchWin = new BrowserWindow({
    x, y, width, height,

    // MUST be a panel. Only panels join fullscreen Spaces, which is the only way
    // Braino stays visible over a fullscreen app. A normal window vanishes the
    // moment someone opens anything fullscreen, which is most of the day.
    type: "panel",

    // Without this, any setBounds after show lets macOS clamp the frame below the
    // menu bar, and notch UI ends up exiled off screen.
    enableLargerThanScreen: true,

    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    focusable: false,              // he never steals focus from what you are typing in
    acceptFirstMouse: true,        // the first click acts, it does not just focus
    show: false,
    trafficLightPosition: { x: -100, y: -100 },

    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // or the walk cycle stutters when unfocused
      devTools: true,
    },
  });

  notchWin.loadFile(path.join(__dirname, "renderer", "notch.html"));
  notchWin.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,   // without this the app flashes in the dock
  });
  notchWin.setAlwaysOnTop(true, "screen-saver", 1);
  notchWin.setFocusable(false);
  // He is transparent to the mouse by default, or he is furniture you have to
  // work around. forward:true keeps hover arriving so he still reacts to the
  // cursor coming near.
  notchWin.setIgnoreMouseEvents(true, { forward: true });

  notchWin.once("ready-to-show", () => {
    notchWin.showInactive();
    notchWin.webContents.send("boot", {
      ttsPort, ttsToken,
      hasNotebook: Boolean(store.getNotebook()),
      approved: store.isApproved(),
      questions: QUESTIONS, asked: ASKED, askedDisplay: ASKED_DISPLAY,
    });
  });

  if (DEV) notchWin.webContents.openDevTools({ mode: "detach" });
}

// The notebook, the read-back and the onboarding split screen. A real window,
// because this one is read and typed in.
function openBook(route = "onboarding") {
  const file = route === "notebook" ? "notebook.html" : "onboarding.html";
  if (bookWin && !bookWin.isDestroyed()) {
    // Switching route means loading the other page, not just telling the old one
    // about it. A "route" message to a window still showing onboarding leaves
    // the user staring at the wrong screen.
    if (!bookWin.webContents.getURL().endsWith(file)) {
      bookWin.loadFile(path.join(__dirname, "renderer", file));
    }
    bookWin.show();
    bookWin.focus();
    return bookWin;
  }
  bookWin = new BrowserWindow({
    width: 1180, height: 820, minWidth: 900, minHeight: 640,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#fbfbfd",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  bookWin.loadFile(path.join(__dirname, "renderer", file));
  bookWin.once("ready-to-show", () => { bookWin.show(); bookWin.focus(); });
  bookWin.on("closed", () => { bookWin = null; });
  if (DEV) bookWin.webContents.openDevTools({ mode: "detach" });
  return bookWin;
}

// ─────────────────────────────────────────────────────────────────────────────
// The menu bar.
//
// He hides from the Dock, which means without this there is no way to open the
// notebook on demand and, worse, no way to QUIT: closing every window is
// deliberately prevented, so the only exit would be killing the process. An
// accessory app needs a menu bar item or it is a thing you cannot put down.
//
// Title-only, no icon asset: a green dot renders correctly in both menu bar
// appearances and never ships a wrong-sized template image.
// ─────────────────────────────────────────────────────────────────────────────
function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle("◉");
  tray.setToolTip("Greeno");
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  const hasBook = Boolean(store.getNotebook());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: hasBook ? "Open your notebook" : "Finish setting up", click: () => openBook(hasBook ? "notebook" : "onboarding") },
    { type: "separator" },
    { label: "Talk to Greeno", accelerator: "Alt+Space", click: () => toNotch("hotkey", { gesture: "menu" }) },
    {
      label: "Watch my screen",
      type: "checkbox",
      checked: screenWatchArmed,
      // Screen watching is opt in and visibly armed. Nothing runs on the
      // machine until they say yes, and they can see that it is on.
      click: (item) => { item.checked ? startScreenWatch() : stopScreenWatch(); refreshTray(); },
    },
    { type: "separator" },
    ...(hasBook ? [{ label: "Do the yap again", click: () => openBook("onboarding") }] : []),
    { label: "Try the morning greet now", enabled: hasBook, click: () => fireMorningNow() },
    { label: "Do tonight's debrief now", enabled: hasBook, click: () => toNotch("moment:night", { prompt: "How did it go?" }) },
    { type: "separator" },
    { label: "Quit Greeno", accelerator: "Command+Q", click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

// The greet, on demand. Used by the menu and by anyone demoing it, and it
// deliberately bypasses the once-a-day guard rather than editing the log.
async function fireMorningNow() {
  try {
    const out = await morningGreet({ today: new Date() });
    toNotch("moment:morning", out);
  } catch (err) {
    log("manual greet failed:", err.message);
    toNotch("moment:morning", { said: `I could not put your morning together. ${err.message}` });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The TTS bridge.
//
// A localhost server rather than IPC, so the renderer can point an <audio> at a
// URL and get real streaming playback: bytes reach the speaker as Fish generates
// them. The key never leaves this process, and the token means nothing else on
// the machine can use the endpoint.
// ─────────────────────────────────────────────────────────────────────────────
function startTtsServer() {
  return new Promise((resolve) => {
    ttsServer = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://127.0.0.1");
        if (url.pathname !== "/tts") { res.writeHead(404).end(); return; }
        if (url.searchParams.get("token") !== ttsToken) { res.writeHead(403).end(); return; }
        const text = url.searchParams.get("text") || "";
        if (!text.trim()) { res.writeHead(400).end(); return; }

        const { res: upstream, provider } = await tts.speak(text);
        res.writeHead(200, {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-store",
          "X-Voice-Provider": provider,
        });
        // Stream it through. Never await arrayBuffer(): that turns a streaming
        // voice back into a waiting one.
        Readable.fromWeb(upstream.body).pipe(res);
      } catch (err) {
        log("tts failed:", err.message);
        if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
        res.end(String(err.message || "tts failed"));
      }
    });
    ttsServer.listen(0, "127.0.0.1", () => {
      ttsPort = ttsServer.address().port;
      log("tts bridge on", ttsPort);
      resolve(ttsPort);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The hotkey. Double-Option, via the Swift helper. A registered chord is kept as
// the always-works fallback, because Accessibility grants are keyed to the binary
// and every dev rebuild voids them.
// ─────────────────────────────────────────────────────────────────────────────
function startHotkey() {
  const bin = path.join(__dirname, "native", "greeno-hotkey");
  if (fs.existsSync(bin)) {
    try {
      hotkeyProc = spawn(bin, { stdio: ["ignore", "pipe", "pipe"] });
      hotkeyProc.stdout.on("data", (buf) => {
        for (const line of String(buf).split("\n").map((s) => s.trim()).filter(Boolean)) {
          log("hotkey:", line);
          if (line === "double-option" || line === "double-control") toNotch("hotkey", { gesture: line });
          if (line === "needs-accessibility") toNotch("hotkey-needs-permission", {});
        }
      });
      hotkeyProc.on("error", (e) => log("hotkey helper error:", e.message));
    } catch (e) {
      log("hotkey helper did not start:", e.message);
    }
  }
  // The fallback. Always registered, so a voided grant never leaves the demo
  // with no way to reach him.
  try {
    globalShortcut.register("Alt+Space", () => toNotch("hotkey", { gesture: "chord" }));
  } catch (e) { log("chord register failed:", e.message); }
}

function toNotch(channel, payload) {
  if (notchWin && !notchWin.isDestroyed()) notchWin.webContents.send(channel, payload);
}
function toBook(channel, payload) {
  if (bookWin && !bookWin.isDestroyed()) bookWin.webContents.send(channel, payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// The three moments. Exactly three. A fourth is how this becomes annoying
// software, so there is no fourth timer in this file.
// ─────────────────────────────────────────────────────────────────────────────
let momentTimer = null;
let glanceTimer = null;
let screenWatchArmed = false;

function startMoments() {
  clearInterval(momentTimer);
  // A minute tick, not a scheduled job, so changing startTime in the notebook
  // takes effect immediately and a laptop waking from sleep still catches up.
  momentTimer = setInterval(tickMoments, 30 * 1000);
  tickMoments();
}

async function tickMoments() {
  const book = store.getNotebook();
  if (!book || !store.isApproved()) return;

  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = nb.toMinutes(book.startTime) ?? 510;

  // Morning. Inside a 45 minute window after their own start time, once a day.
  if (mins >= start && mins < start + 45 && !store.didToday("morning", now)) {
    try {
      const out = await morningGreet({ today: now });
      toNotch("moment:morning", out);
    } catch (e) { log("morning greet failed:", e.message); }
  }

  await runArmedAutomations(now);

  // Night. From 21:00, once a day, and only if he has not already asked.
  const nightAt = nb.toMinutes(store.getSettings().nightTime || "21:00") ?? 1260;
  if (mins >= nightAt && !store.didToday("night", now)) {
    if (!store.getMeta("nightPromptedOn") || store.getMeta("nightPromptedOn") !== now.toISOString().slice(0, 10)) {
      store.setMeta("nightPromptedOn", now.toISOString().slice(0, 10));
      toNotch("moment:night", { prompt: "How did it go?" });
    }
  }
}

/**
 * Automations the user armed. These DO something and say nothing, which is why
 * they are not a fourth moment: a moment is him showing up, and this is him
 * quietly having already done it.
 */
async function runArmedAutomations(now) {
  const book = store.getNotebook();
  if (!book?.automations?.length) return;

  const day = now.toISOString().slice(0, 10);
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = nb.toMinutes(book.startTime) ?? 510;
  const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;

  for (const auto of book.automations) {
    if (auto.status !== "armed" || !auto.action) continue;

    const due =
      auto.trigger === "morning" ? mins >= start && mins < start + 45 :
      auto.trigger === "evening" ? mins >= (nb.toMinutes(store.getSettings().nightTime || "21:00") ?? 1260) :
      auto.trigger === "weekday" ? isWeekday && mins >= start && mins < start + 45 :
      false;                       // "manual" only ever runs when asked
    if (!due) continue;

    // Once a day, and remembered, so a restart does not re-run it.
    if (store.getMeta(`auto:${auto.id}`) === day) continue;
    store.setMeta(`auto:${auto.id}`, day);

    try {
      await actions.perform(auto.action, auto.args || {});
      log("automation ran:", auto.id, auto.action);
    } catch (err) {
      log("automation failed:", auto.id, err.message);
    }
  }
}

// The stuck watcher. 90 seconds is how often he LOOKS. Whether he may SPEAK is
// the 30 minute cooldown inside nudge.cjs, and it is checked before the model is
// ever called, so a look costs nothing when he is not allowed to speak anyway.
function startScreenWatch() {
  if (screenWatchArmed) return;
  screenWatchArmed = true;
  store.saveSettings({ screenWatch: true });
  clearInterval(glanceTimer);
  glanceTimer = setInterval(glanceOnce, nudge.LOOK_INTERVAL_MS);
  toNotch("watch:armed", { armed: true });
  refreshTray();
  log("screen watch armed");
}

function stopScreenWatch() {
  screenWatchArmed = false;
  store.saveSettings({ screenWatch: false });
  clearInterval(glanceTimer);
  toNotch("watch:armed", { armed: false });
  refreshTray();
  log("screen watch disarmed");
}

async function glanceOnce() {
  if (!nudge.mayNudge()) return;
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1280, height: 800 },
    });
    if (!sources.length) return;
    const jpeg = sources[0].thumbnail.toJPEG(70).toString("base64");
    const book = store.getNotebook();
    const intention = store.getMeta("todaysIntention") ||
      (book ? nb.habitsDueToday(book).map((g) => g.title).join(", ") : "");

    const said = await nudge.glance(jpeg, { todaysIntention: intention });
    if (!said) return;                       // SKIP, and that is the normal case
    const row = nudge.armCooldown(said);
    toNotch("moment:stuck", { said, id: row?.id });
  } catch (e) {
    log("glance failed:", e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC
// ─────────────────────────────────────────────────────────────────────────────
function handle(name, fn) {
  ipcMain.handle(name, async (_evt, arg) => {
    try {
      return { ok: true, data: await fn(arg || {}) };
    } catch (err) {
      log(`${name} failed:`, err.message);
      return { ok: false, error: String(err.message || err) };
    }
  });
}

function registerIpc() {
  handle("state", () => ({
    notebook: store.getNotebook(),
    approved: store.isApproved(),
    settings: store.getSettings(),
    checkins: store.checkinsSince(60),
    progress: store.getNotebook() ? nb.progress(store.getNotebook(), store.checkinsSince(60)) : [],
    questions: QUESTIONS,
    asked: ASKED,
    hasOpenAI: openai.hasKey(),
    hasFish: Boolean(process.env.FISH_AUDIO_API_KEY),
    ttsPort, ttsToken,
    screenWatch: screenWatchArmed,
  }));

  // The SDP exchange. The key stays here; the renderer only ever sees an answer.
  handle("realtimeCall", ({ offerSdp, model }) => realtime.createCall({ offerSdp, model }));

  handle("transcribe", async ({ buffer, mimeType }) =>
    openai.transcribe(Buffer.from(buffer), { mimeType: mimeType || "audio/webm" }));

  handle("refine", ({ text }) => openai.refineDictation(text));

  // The split screen calls this after every answer. Five short calls with effort
  // "none" beat one incremental diff, which is a category of bug you do not need
  // during a demo.
  handle("yap", async ({ answers, timezone }) =>
    yapToNotebook(answers || [], timezone || Intl.DateTimeFormat().resolvedOptions().timeZone));

  handle("saveNotebook", ({ notebook, approved }) => {
    const saved = store.saveNotebook(nb.ensureIds(notebook), { approved: Boolean(approved) });
    toNotch("notebook:saved", { approved: store.isApproved() });
    if (approved) startMoments();
    refreshTray();
    return saved;
  });

  handle("greet", ({ events, inbox } = {}) => morningGreet({ events, inbox }));
  handle("debrief", ({ transcript }) => debrief(transcript));
  handle("turn", (req) => turn(req));


  // ── delegation ────────────────────────────────────────────────────────────
  // One entry point for anything said out loud. It decides whether this was a
  // command or a conversation, and the caller never has to guess.
  handle("ask", async ({ text, history = [], medium = "voice" }) => {
    const frontApp = await actions.frontApp();
    const book = store.getNotebook();
    const routed = await delegate.route(text, { frontApp, notebook: book });

    if (routed.action === "chat") {
      const out = await turn({ text, history, medium, screen: frontApp ? `they are in ${frontApp}` : "" });
      return { kind: "said", ...out };
    }

    // Anything that closes someone's work asks first. Nothing runs on this
    // machine until they say yes.
    if (actions.needsConfirm(routed.action)) {
      return {
        kind: "confirm",
        action: routed.action,
        args: routed.args,
        label: actions.ACTIONS[routed.action].label,
        say: routed.say || `Want me to ${actions.ACTIONS[routed.action].label}?`,
      };
    }

    try {
      await actions.perform(routed.action, routed.args);
      return { kind: "did", action: routed.action, say: routed.say || "Done.", via: routed.via };
    } catch (err) {
      return { kind: "failed", action: routed.action, say: String(err.message || err) };
    }
  });

  // The confirmed half of the above, and the only way a confirming action runs.
  handle("perform", async ({ action, args }) => {
    await actions.perform(action, args || {});
    return { ok: true, action };
  });

  handle("capabilities", async () => ({
    actions: actions.ACTION_IDS.map((id) => ({ id, ...actions.ACTIONS[id] , fn: undefined })),
    shortcuts: await actions.listShortcuts().catch(() => []),
    frontApp: await actions.frontApp().catch(() => ""),
    nowPlaying: await actions.nowPlaying().catch(() => null),
  }));

  // Turning a wish into a routine that actually runs.
  handle("armAutomation", ({ id, action, args }) => {
    const book = store.getNotebook();
    if (!book) throw new Error("no notebook yet");
    const auto = (book.automations || []).find((a) => a.id === id);
    if (!auto) throw new Error(`no automation called ${id}`);
    if (action && !actions.ACTION_IDS.includes(action)) throw new Error(`${action} is not something I can do`);
    auto.action = action || auto.action;
    auto.args = args || auto.args || {};
    auto.status = action ? "armed" : "wished";
    store.saveNotebook(book);
    return auto;
  });

  handle("progress", () => {
    const book = store.getNotebook();
    return book ? nb.progress(book, store.checkinsSince(60)) : [];
  });

  handle("settings", ({ patch }) => store.saveSettings(patch || {}));
  handle("meta", ({ key, value }) => { store.setMeta(key, value); return true; });

  handle("openBook", ({ route }) => { openBook(route || "notebook"); return true; });

  // The notch calls this when the boot sequence has finished. Whatever the app
  // wanted to show at startup was held until now, so he arrives first and the
  // window opens behind him rather than under him.
  handle("bootDone", () => {
    bootFinished = true;
    log("boot finished");
    if (pendingRoute) { openBook(pendingRoute); pendingRoute = null; }
    return true;
  });
  handle("closeBook", () => { if (bookWin && !bookWin.isDestroyed()) bookWin.close(); return true; });

  handle("micPermission", async () => {
    const status = systemPreferences.getMediaAccessStatus("microphone");
    if (status === "granted") return { status };
    const ok = await systemPreferences.askForMediaAccess("microphone");
    return { status: ok ? "granted" : systemPreferences.getMediaAccessStatus("microphone") };
  });

  handle("screenWatch", ({ on }) => { on ? startScreenWatch() : stopScreenWatch(); return screenWatchArmed; });
  handle("glanceNow", async () => { await glanceOnce(); return true; });

  handle("greetNow", async () => { await fireMorningNow(); return true; });

  handle("markActed", ({ id }) => { store.markShowupActed(id); return true; });

  handle("reset", () => { store.reset(); return true; });

  handle("openExternal", ({ url }) => shell.openExternal(url));

  // Click-through is turned OFF only while something is genuinely interactive,
  // and back ON the instant it closes. Leaving it off is how the notch becomes a
  // dead zone on the screen.
  ipcMain.on("interactive", (_e, on) => {
    if (notchWin && !notchWin.isDestroyed()) notchWin.setIgnoreMouseEvents(!on, { forward: true });
  });

  // Anything the notch wants the book window to hear, and back.
  ipcMain.on("toBook", (_e, msg) => toBook("fromNotch", msg));
  ipcMain.on("toNotch", (_e, msg) => toNotch("fromBook", msg));
}

// ─────────────────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  store.init(app.getPath("userData"));
  app.dock?.hide?.();
  await startTtsServer();
  registerIpc();
  createNotch();
  createTray();
  startHotkey();
  startMoments();
  if (store.getSettings().screenWatch) startScreenWatch();

  // A fresh install goes straight to his first day on the job, but only once he
  // has finished introducing himself. The notch owns those few seconds.
  if (!store.getNotebook()) {
    if (bootFinished) openBook("onboarding");
    else pendingRoute = "onboarding";
  }

  // If the notch never reports in (a renderer crash, a broken boot), the window
  // still opens. A missed animation must not cost someone the whole app.
  setTimeout(() => {
    if (!bootFinished && pendingRoute) { openBook(pendingRoute); pendingRoute = null; }
  }, 16000);

  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createNotch(); });

  // Someone tried to start him again. Show what they were probably looking for
  // rather than silently doing nothing.
  app.on("second-instance", () => {
    log("a second instance was blocked");
    if (store.getNotebook()) openBook("notebook");
    else if (bootFinished) openBook("onboarding");
  });
});

app.on("window-all-closed", (e) => e.preventDefault());   // he lives in the notch, not in a window
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  hotkeyProc?.kill();
  ttsServer?.close();
});
