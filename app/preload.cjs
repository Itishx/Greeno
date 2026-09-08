// The only bridge. The renderer never sees a key, a file path, or a model name
// it did not ask for by name.

const { contextBridge, ipcRenderer } = require("electron");

const call = (name) => (arg) => ipcRenderer.invoke(name, arg).then((r) => {
  if (r && r.ok) return r.data;
  throw new Error(r?.error || `${name} failed`);
});

const on = (channel) => (fn) => {
  const wrapped = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

contextBridge.exposeInMainWorld("greeno", {
  state: call("state"),
  transcribe: call("transcribe"),
  refine: call("refine"),
  yap: call("yap"),
  saveNotebook: call("saveNotebook"),
  greet: call("greet"),
  greetNow: call("greetNow"),
  debrief: call("debrief"),
  turn: call("turn"),
  ask: call("ask"),
  realtimeCall: call("realtimeCall"),
  perform: call("perform"),
  capabilities: call("capabilities"),
  armAutomation: call("armAutomation"),
  progress: call("progress"),
  settings: call("settings"),
  meta: call("meta"),
  openBook: call("openBook"),
  bootDone: call("bootDone"),
  closeBook: call("closeBook"),
  micPermission: call("micPermission"),
  screenWatch: call("screenWatch"),
  glanceNow: call("glanceNow"),
  markActed: call("markActed"),
  reset: call("reset"),
  openExternal: call("openExternal"),

  // Click-through off only while something is genuinely interactive, and back on
  // the instant it closes.
  interactive: (on_) => ipcRenderer.send("interactive", Boolean(on_)),
  toBook: (msg) => ipcRenderer.send("toBook", msg),
  toNotch: (msg) => ipcRenderer.send("toNotch", msg),

  onBoot: on("boot"),
  onHotkey: on("hotkey"),
  onHotkeyNeedsPermission: on("hotkey-needs-permission"),
  onMorning: on("moment:morning"),
  onNight: on("moment:night"),
  onStuck: on("moment:stuck"),
  onWatchArmed: on("watch:armed"),
  onNotebookSaved: on("notebook:saved"),
  onRoute: on("route"),
  onFromNotch: on("fromNotch"),
  onFromBook: on("fromBook"),
});
