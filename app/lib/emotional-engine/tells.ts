// The tell-checker: does a reply sound like Braino, or like a bot?
//
// Braino's personality already contains explicit lists of banned phrases (see
// authenticity.ts, humanity.ts, charm.ts, diction.ts). Until now those were only
// requests to the model, and a request is not a guarantee. This file turns them
// into a check that runs in code over the reply he actually produced, so "he never
// says What's on your mind?" becomes a fact we can verify instead of a hope.
//
// It is deliberately a plain phrase scan, not a model call: free, instant, and it
// cannot itself hallucinate. It runs after every reply in the lab, and the same
// function can later run as a background quality metric in production.

export type TellCategory =
  | "eager-opener"
  | "therapy-voice"
  | "wellness-closer"
  | "permission-slip"
  | "narrated-empathy"
  | "silver-lining"
  | "customer-service"
  | "ai-disclaimer"
  | "filler"
  | "dash";

export type Tell = {
  category: TellCategory;
  matched: string;
  why: string;
};

const RULES: Array<{ category: TellCategory; re: RegExp; why: string }> = [
  // The one that started all of this. An empty opener proves he noticed nothing.
  { category: "eager-opener", why: "An empty opener that hands the work back instead of noticing something.",
    re: /\b(what'?s on your mind|how can i (help|assist) you( today)?|what can i do for you|how may i assist|what brings you here|i'?m here to help|how can i be of (help|assistance))\b/i },

  { category: "therapy-voice", why: "Therapy-voice validation. A friend reacts, a brand validates.",
    re: /\b(that must be (really |so )?(hard|tough|difficult)|i'?m here for you|i can only imagine what you'?re going through|that sounds (really )?(hard|difficult|challenging))\b/i },

  { category: "wellness-closer", why: "Wellness-pamphlet closer. Say the actual thing instead.",
    re: /\b(practice self[- ]care|be gentle with yourself|take care of yourself|prioriti[sz]e your (wellbeing|well-being|mental health)|remember to breathe)\b/i },

  { category: "permission-slip", why: "Permission-slip validation. Treat feelings as valid by reacting, not by announcing it.",
    re: /\b(your feelings are valid|it'?s (completely |totally |perfectly )?(valid|okay|normal) to feel|there'?s no wrong way to feel)\b/i },

  { category: "narrated-empathy", why: "Narrated empathy. Don't describe the feeling, have it.",
    re: /\b(i want you to know (that )?i hear you|i'?m holding space|i hear you and|i'?m sitting with you in this)\b/i },

  { category: "silver-lining", why: "Forced silver lining. Sometimes the thing just sucks.",
    re: /\b(everything happens for a reason|you'?ll come out of this stronger|this too shall pass|silver lining|things happen for a reason)\b/i },

  { category: "customer-service", why: "Customer-service scaffolding. No friend has said this to your face.",
    re: /\b(i'?d be happy to (help|assist)|great question|is there anything else( i can help)?|happy to help|let me know if you need anything else|thank you for sharing|i appreciate your patience)\b/i },

  { category: "ai-disclaimer", why: "The spell breaking. He never explains himself as a model.",
    re: /\b(as an ai|i'?m (just )?an? (ai|language model|program)|i don'?t have (feelings|emotions|personal experiences)|i'?m not capable of|i don'?t have access to)\b/i },

  { category: "filler", why: "Filler that sounds like a brochure.",
    re: /\b(it'?s important to note|i hope this helps|feel free to( ask| reach out)|in today'?s fast[- ]paced world|ever[- ]evolving landscape|delve into|rich tapestry|navigate this journey|certainly!)/i },

  // The house rule. Real em/en dashes only; a plain hyphen inside a word is fine.
  { category: "dash", why: "House rule: no em dashes or en dashes, ever.", re: /[–—]/ },
];

export function scanForTells(reply: string): Tell[] {
  const text = String(reply || "");
  if (!text.trim()) return [];
  const found: Tell[] = [];
  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (m) found.push({ category: rule.category, matched: m[0], why: rule.why });
  }
  return found;
}
