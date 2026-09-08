// Memory Engine — the capture gate.
//
// Running the extractor LLM on EVERY message would be wasteful — most turns ("what's 2+2",
// "summarize this") carry nothing worth remembering. shouldCapture() is a cheap, deterministic
// check (just word cues, no AI) that decides whether a message is worth running extraction on.
// If you find Braino missing things it should remember, widen the cues here.

const EXPLICIT_REMEMBER = /\b(remember (that|this)?|note that|don'?t forget|keep in mind|for future reference|make a note|memori[sz]e)\b/i;

// First-person signals that a durable fact about the user is being shared.
const SELF_DISCLOSURE = new RegExp(
  [
    "\\bmy name is\\b", "\\bcall me\\b", "\\bi'?m called\\b",
    "\\bi am\\b", "\\bi'?m\\b",                       // "I'm a designer", "I am 24"
    "\\bi live\\b", "\\bi'?m (from|based)\\b", "\\bi moved\\b",
    "\\bi work\\b", "\\bi'?m (a|an|the)\\b",          // role/identity
    "\\bi prefer\\b", "\\bi like\\b", "\\bi love\\b", "\\bi hate\\b", "\\bi can'?t stand\\b",
    "\\bi'?m building\\b", "\\bi'?m working on\\b", "\\bmy (startup|company|project|product|app|site|business)\\b",
    "\\bmy (wife|husband|partner|girlfriend|boyfriend|gf|bf|mom|mum|dad|son|daughter|kid|kids|child|children|brother|sister|friend|boss|team|dog|cat|pet)\\b",
    "\\bi (have|own|use)\\b",
    "\\bi'?m (allergic|vegetarian|vegan|diabetic)\\b",
    "\\bmy (birthday|goal|deadline|timezone|email|number)\\b",
  ].join("|"),
  "i",
);

export function shouldCapture(text: string | null | undefined): boolean {
  const t = String(text || "").trim();
  if (t.length < 4) return false;
  return EXPLICIT_REMEMBER.test(t) || SELF_DISCLOSURE.test(t);
}
