// Delegation: turning something said out loud into something done to this Mac.
//
// Two tiers, the same shape Braino already uses:
//
//   1. Deterministic word cues FIRST. Free, instant, certain, and testable. A
//      phrase that quits an app or starts a focus block has to be certain, so
//      these patterns are strict: naming a thing is not asking for it. "Put some
//      music on" is a command. "The music in that cafe was good" is not.
//
//   2. One model call as the FALLBACK, and only when the cues found nothing. It
//      returns strict JSON naming one action from the closed allowlist in
//      actions.cjs. It cannot invent a capability, because the schema will not
//      let it and perform() would refuse anyway.
//
// "chat" is itself one of the answers. That is what lets him tell being asked to
// do something from simply being talked to, which is most of what he hears.

const { structured } = require("./openai.cjs");
const actions = require("./actions.cjs");

function normalize(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/^\s*(?:hey\s+)?(?:greeno|braino|breno|grino)[\s,]+/, "")
    .replace(/[?.!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── tier one: the cues ──────────────────────────────────────────────────────
// Every one of these needs an ASK, not just a noun. That is the difference
// between a command and a sentence that happens to mention music.
const ASK = /\b(?:can you|could you|please|let'?s|lets|i want to|i need to|start|begin|put|open|launch|play|pause|stop|end|quit|close|kill|run|turn on|turn off)\b/;

const CUES = [
  {
    id: "focus.on",
    // Focus is the one people say a dozen ways, so it gets the widest net.
    test: (t) => /\b(?:enter|start|begin|turn on|go into|get into|put me in)\b.{0,12}\bfocus\b/.test(t)
      || /\bfocus (?:mode|time|block)\b/.test(t) && ASK.test(t)
      || /\b(?:lock in|deep work|heads down)\b/.test(t),
    args: () => ({}),
  },
  {
    id: "focus.off",
    test: (t) => /\b(?:end|stop|exit|leave|turn off|come out of|break)\b.{0,14}\bfocus\b/.test(t)
      || /\bi'?m done (?:focusing|with focus)\b/.test(t),
    args: () => ({}),
  },
  {
    id: "music.play",
    test: (t) => /\b(?:play|put on|start)\b.{0,18}\b(?:music|song|track|playlist|lofi|spotify|something)\b/.test(t)
      || /\bmusic on\b/.test(t),
    args: (t) => ({ service: /\bapple\b/.test(t) ? "apple" : "spotify" }),
  },
  {
    id: "music.pause",
    test: (t) => /\b(?:pause|stop|kill|turn off)\b.{0,18}\b(?:music|song|track|playlist|spotify)\b/.test(t),
    args: (t) => ({ service: /\bapple\b/.test(t) ? "apple" : "spotify" }),
  },
  {
    id: "app.quit",
    // Anchored to the front, because only an imperative is a command. "I should
    // really close some tabs at some point" is a thought about the future, and
    // an earlier version of this cue quit an app called "Some Tabs At Some
    // Point" over it. One to three words after the verb, and the target has to
    // look like an app rather than a noun.
    test: (t) => Boolean(appTarget(t, /^(?:quit|close|kill)\s+(.+)$/)),
    args: (t) => ({ name: titleCase(appTarget(t, /^(?:quit|close|kill)\s+(.+)$/)) }),
  },
  {
    id: "app.open",
    test: (t) => Boolean(appTarget(t, /^(?:open|launch)\s+(.+)$/)),
    args: (t) => ({ name: titleCase(appTarget(t, /^(?:open|launch)\s+(.+)$/)) }),
  },
  {
    id: "shortcut.run",
    test: (t) => /\brun (?:my |the )?shortcut\b/.test(t),
    args: (t) => ({ name: (/\brun (?:my |the )?shortcut\s+(?:called\s+)?(.+)$/.exec(t) || [])[1] || "" }),
  },
];


// Things people say that are never an app. Without this list, "close some tabs"
// quits an application called Some Tabs.
const NOT_AN_APP = new Set([
  "some", "a", "an", "the", "this", "that", "it", "them", "these", "those",
  "tabs", "tab", "everything", "all", "stuff", "things", "windows", "window",
  "up", "down", "out", "off", "in", "my", "your", "few", "couple", "lot",
  "focus", "music", "notebook", "yourself", "me", "himself",
]);

/**
 * Pull an app name out of an imperative, or return "" if what follows the verb
 * does not look like one. Deliberately strict: guessing here quits real work.
 */
function appTarget(t, re) {
  const m = re.exec(t);
  if (!m) return "";
  const raw = m[1].trim();
  // An app name is one to three words. Anything longer is a sentence.
  const words = raw.split(/\s+/);
  if (words.length > 3) return "";
  if (words.some((w) => NOT_AN_APP.has(w))) return "";
  if (!/^[a-z0-9][a-z0-9 .+-]*$/.test(raw)) return "";
  return raw;
}

function titleCase(s) {
  return String(s || "").trim().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** The free path. Returns an action or null, and never costs anything. */
function parseIntent(raw) {
  const t = normalize(raw);
  if (!t) return null;
  for (const cue of CUES) {
    if (cue.test(t)) {
      const args = cue.args(t) || {};
      // A parser that produced no target has not understood, it has guessed.
      // Fall through to the model rather than acting on a guess.
      if ((cue.id === "app.open" || cue.id === "app.quit") && !args.name) continue;
      if (cue.id === "shortcut.run" && !args.name) continue;
      return { action: cue.id, args, via: "cue" };
    }
  }
  return null;
}

// ── tier two: the classifier ────────────────────────────────────────────────
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "app", "url", "shortcut", "service", "say"],
  properties: {
    action: { type: "string", enum: [...actions.ACTION_IDS, "chat"] },
    app: { type: "string", description: "app name for app.open or app.quit, else empty string" },
    url: { type: "string", description: "full https url for url.open, else empty string" },
    shortcut: { type: "string", description: "shortcut name for shortcut.run, else empty string" },
    service: { type: "string", enum: ["spotify", "apple", "none"] },
    say: { type: "string", description: "One short line, in Braino's voice, said as he does it. Empty if action is chat." },
  },
};

const SYSTEM = `Classify one thing a person said out loud to Greeno on their Mac into EXACTLY one action.

The actions you may choose, and nothing else:
- focus.on: start a focus block
- focus.off: end the focus block
- app.open: open an app (fill "app")
- app.quit: quit an app (fill "app")
- url.open: open a link (fill "url" with a full https url)
- music.play / music.pause: their music (fill "service")
- shortcut.run: run one of their macOS Shortcuts by name (fill "shortcut")
- chat: they are TALKING TO HIM, not commanding him. This is the right answer most of the time.

Rules:

Choose chat unless they are clearly asking for something to be DONE, right now, on this machine. A question, a feeling, a story, a complaint and a piece of news are all chat. When in doubt, chat: doing nothing is recoverable and quitting the wrong app is not.

Never choose an action for anything involving another person. Messaging, texting, emailing, calling and posting are not on the list, and there is no action for them. If they ask you to text someone, that is chat, and he will remind them to do it themselves.

"say" is one short line in his voice, said as he does the thing. No em-dash, no en-dash. Empty string when the action is chat.

Fill every field. Use an empty string for anything the action does not need.`;

/**
 * The full route: cues first, then one model call. Returns
 *   { action, args, say, via }  where action may be "chat".
 */
async function route(raw, { frontApp, notebook } = {}) {
  const cued = parseIntent(raw);
  if (cued) return { ...cued, say: "" };

  const context = [
    `They said: "${String(raw || "").trim()}"`,
    frontApp ? `The app in front of them right now is ${frontApp}.` : "",
    notebook?.focus?.distractions?.length
      ? `They told him these pull them out of it: ${notebook.focus.distractions.join(", ")}.`
      : "",
  ].filter(Boolean).join("\n");

  let out;
  try {
    out = await structured({ system: SYSTEM, user: context, schema: SCHEMA, name: "intent", maxTokens: 600 });
  } catch {
    // A classifier that cannot answer must not guess. Talking is always safe.
    return { action: "chat", args: {}, say: "", via: "fallback" };
  }

  if (!out?.action || out.action === "chat") return { action: "chat", args: {}, say: "", via: "model" };

  const args = {};
  if (out.app) args.name = out.app;
  if (out.url) args.url = out.url;
  if (out.shortcut) args.name = out.shortcut;
  if (out.service && out.service !== "none") args.service = out.service;

  // The allowlist has the last word, whatever the model returned.
  if (!actions.ACTION_IDS.includes(out.action)) {
    return { action: "chat", args: {}, say: "", via: "model" };
  }
  return { action: out.action, args, say: out.say || "", via: "model" };
}

module.exports = { route, parseIntent, normalize, SCHEMA, SYSTEM };
