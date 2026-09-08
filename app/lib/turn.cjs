// The turn. Where the personality, the notebook and the context become one
// prompt. Small on purpose, and everything routes through it.

const { complete, rescue } = require("./openai.cjs");
const { buildCore, detectMomentDetailed, WHO_HE_IS } = require("./engine.cjs");
const { habitsDueToday, describeWindows, routinesToday, progress, slippingHabits } = require("./notebook.cjs");
const store = require("./store.cjs");
const memory = require("./memory.cjs");

/**
 * req: { text, medium: "voice"|"text", history: [{role,content}], screen?, calendar? }
 */
async function turn(req) {
  const medium = req.medium === "voice" ? "voice" : "text";
  const today = req.today ? new Date(req.today) : new Date();

  // 1. What kind of moment is this. Plain word cues, no model call, no latency.
  //    THIS RUNS FOR VOICE TOO. The old repo only ran it for text, which is the
  //    single reason voice Braino was emotionally flat.
  let { moment, intensity } = detectMomentDetailed(req.text);

  const book = store.getNotebook();
  const checkins = store.checkinsSince(30);

  // Relationship moments the word cues cannot see, because they are facts about
  // the history rather than about this sentence. They only override a neutral
  // read: someone in real distress is never relabelled as "nice streak".
  if (moment === "neutral" && book) {
    const ghosted = store.daysSinceLastDebrief(today);
    const slipping = slippingHabits(book, checkins, today);
    const streaks = (book.habits || [])
      .map((h) => ({ h, n: store.streakFor(h.id, h.target, today) }))
      .filter((s) => s.n >= 3);

    if (ghosted !== null && ghosted >= 2) { moment = "ghosted"; intensity = 2; }
    else if (streaks.length) { moment = "streak"; intensity = 2; }
    else if (slipping.length) { moment = "slipping"; intensity = 2; }
  }

  // 2. Personality. Traits reordered so the ones this moment needs lead.
  const core = buildCore({
    medium,
    moment,
    intensity,
    settings: req.settings || store.getSettings(),
  });

  // 3. Who they are, plus 4. what is happening right now.
  const context = [];
  if (book) {
    const due = habitsDueToday(book, today);
    context.push(`Today is ${today.toDateString()}. Their day starts at ${book.startTime}.`);
    const routines = routinesToday(book, today);
    if (routines.length) context.push(`Their routines today: ${routines.map((r) => `${r.start} ${r.label}`).join(", ")}.`);
    if (req.calendar?.length) context.push(`On their calendar: ${req.calendar.map((e) => `${e.start} ${e.title}`).join(", ")}.`);
    if (due.length) context.push(`Habits due today: ${due.map((h) => h.title).join(", ")}.`);
    if (book.focus?.deepWork?.length) context.push(`Deep work: ${describeWindows(book.focus.deepWork)}.`);
    if (book.focus?.distractions?.length) context.push(`What pulls them out: ${book.focus.distractions.join(", ")}.`);
    if (book.slipping?.length) context.push(`What they said keeps slipping: ${book.slipping.join(", ")}.`);

    const prog = progress(book, checkins, today).filter((p) => p.done > 0);
    if (prog.length) context.push(`Where they are: ${prog.map((p) => `${p.title} ${p.done} of ${p.target} ${p.unit}`).join(", ")}.`);
  } else {
    context.push("They have not filled in their notebook yet, so you do not know them well.");
  }
  if (req.screen) context.push(`What is on their screen: ${req.screen}.`);

  // The unstructured half of what he knows. Retrieval is deterministic: salience,
  // recency and keyword overlap, no embeddings and no extra model call.
  const recalled = memory.retrieveMemories(req.text, { isPremium: req.isPremium });
  const memoryBlock = memory.renderMemories(recalled);
  if (memoryBlock) context.push(memoryBlock);

  // The capability note goes in whether or not there are memories yet, so he
  // behaves like someone with a memory from the very first conversation.
  const system = [core, WHO_HE_IS, memory.MEMORY_CAPABILITY_NOTE, context.join("\n")].join("\n\n");
  const messages = (req.history || []).concat({ role: "user", content: req.text });

  let reply = await complete({ system, messages, maxTokens: medium === "voice" ? 500 : 1400 });

  // A ceiling sized for a non-reasoning model gets swallowed by the thinking and
  // returns empty, which looks exactly like a broken model. If the default came
  // back with nothing on a turn that matters, escalate once. The caller never
  // gets to ask for this.
  if (!reply || !reply.trim()) {
    reply = await rescue({ system, messages });
  }

  // Learn, afterwards. Fire and forget: the reply must never wait on capture,
  // and a failed capture must never surface as a broken turn.
  memory.captureMemories(
    messages.concat({ role: "assistant", content: reply }),
    { isPremium: req.isPremium },
  ).catch(() => {});

  return { reply, moment, intensity, recalled: recalled.length };
}

module.exports = { turn };
