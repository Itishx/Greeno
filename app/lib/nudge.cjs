// The stuck nudge. The cowork glance from mac/braino-mac/main.cjs, made
// companion-shaped.
//
// Three changes from the original, and all three matter:
//   1. The intention goes in. Without what today is actually about, he is
//      guessing what a distraction even is.
//   2. He never speaks it. The notch renders "Braino has a suggestion" and waits
//      to be opened. Suggestions are read, never spoken at.
//   3. A cooldown floor. 90 seconds is how often he LOOKS. 30 minutes is the
//      soonest he may SPEAK, enforced against the show-up log.

const { look } = require("./openai.cjs");
const store = require("./store.cjs");
const { inDeepWork } = require("./notebook.cjs");

const LOOK_INTERVAL_MS = 90 * 1000;
const SPEAK_COOLDOWN_MS = 30 * 60 * 1000;

/** The cooldown floor. A read against the show-up log, so a double-fire is visible. */
function mayNudge(now = Date.now()) {
  const last = store.lastShowup("stuck");
  if (!last) return true;
  return now - new Date(last.createdAt).getTime() > SPEAK_COOLDOWN_MS;
}

function buildPrompt({ todaysIntention, recentSuggestions = [], notebook }) {
  const distractions = notebook?.focus?.distractions || [];
  return [
    "You are Braino in COWORK MODE: a coworking buddy who has been watching your",
    "human work on this Mac, checking in every minute or two.",
    recentSuggestions.length
      ? `You already offered recently (do NOT repeat or rephrase these): ${recentSuggestions.join(" | ")}`
      : "",
    todaysIntention ? `This morning they said today was about: ${todaysIntention}.` : "",
    distractions.length
      ? `They told you what pulls them out of it: ${distractions.join(", ")}. Those are the things worth noticing.`
      : "",
    "Look at the screen. If they are working, say nothing.",
    "Only speak if there is a real, specific, useful thing to offer, tied to what they said today was about.",
    "One or two sentences. It will be READ, not spoken, so write it to be read.",
    "Never use an em-dash or an en-dash.",
    "If there is nothing genuinely worth saying, reply with exactly: SKIP",
  ].filter(Boolean).join("\n");
}

/**
 * One glance. Returns a suggestion string, or null when he should stay quiet.
 * Takes the screenshot as base64 jpeg; the caller owns capture so this stays
 * testable without a screen.
 */
async function glance(imageBase64, { todaysIntention, now = Date.now() } = {}) {
  if (!mayNudge(now)) return null;

  const notebook = store.getNotebook();
  // Not while they are heads down inside a window they told him to protect.
  if (notebook && inDeepWork(notebook, new Date(now))) return null;

  const recentSuggestions = store.lastShowups("stuck", 3).map((s) => s.said).filter(Boolean);
  const prompt = buildPrompt({ todaysIntention, recentSuggestions, notebook });

  const said = await look({
    prompt,
    imageBase64,
    system: "You are Braino. You are looking at your human's screen because they let you. Be useful or be quiet.",
    maxTokens: 200,
  });

  const clean = String(said || "").trim();
  // The SKIP gate is the entire design. A model that must justify speaking says
  // nothing most of the time, which is the only reason this is tolerable to live with.
  if (!clean || /^SKIP\b/i.test(clean)) return null;
  return clean;
}

/** Called when the suggestion is actually shown. Starts the 30-minute clock. */
function armCooldown(said) {
  store.logShowup("stuck", said);
  return store.lastShowup("stuck");
}

module.exports = { glance, mayNudge, armCooldown, buildPrompt, LOOK_INTERVAL_MS, SPEAK_COOLDOWN_MS };
