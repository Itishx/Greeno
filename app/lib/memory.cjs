// The memory engine, wired to the local store.
//
// Six of the eight files under memory-engine/ are pure and ported verbatim. The
// two that talked to Postgres (store.ts and capture.ts) are replaced by this
// file, which does the same job against greeno.json.
//
// The split that matters: the NOTEBOOK is structured and edited by the user;
// MEMORY is unstructured and never is. Same idea at two resolutions, which is
// why they are separate lists rather than one being a view over the other.

const {
  shouldCapture,
  buildExtractionPrompt,
  parseMemoryOps,
  selectRelevantMemories,
  renderMemoryBlock,
  MEMORY_CAPABILITY_NOTE,
  getTierLimits,
} = require("./engine.cjs");
const { complete } = require("./openai.cjs");
const store = require("./store.cjs");
const M = require("./models.cjs");

/** Apply what the extractor decided. Returns what changed. */
function applyMemoryOps(ops, limits) {
  const result = { added: 0, updated: 0, archived: 0 };
  for (const op of ops || []) {
    if (op.op === "add" && op.content) {
      // Cheap dedupe on exact content, so the same fact said twice in one
      // conversation does not become two memories.
      const seen = store.activeMemories().some(
        (m) => m.content.trim().toLowerCase() === String(op.content).trim().toLowerCase(),
      );
      if (seen) continue;
      store.addMemory({ content: op.content, category: op.category || "fact", salience: op.salience || 2 });
      result.added++;
    } else if (op.op === "update" && op.id) {
      const patch = { content: op.content };
      if (op.category) patch.category = op.category;
      if (op.salience) patch.salience = op.salience;
      if (store.updateMemory(op.id, patch)) result.updated++;
    } else if (op.op === "archive" && op.id) {
      if (store.archiveMemory(op.id)) result.archived++;
    }
  }
  result.archived += store.enforceMemoryCap(limits.storeCap);
  store.saveMemories();
  return result;
}

/**
 * Runs AFTER he has already answered, and never in front of the user. Memory
 * must not add latency to a turn and must never break one, so every path here
 * swallows its own errors.
 */
async function captureMemories(messages, { isPremium = false } = {}) {
  try {
    if (!Array.isArray(messages) || !messages.length) return null;

    // Gate on the latest user message. Most turns carry nothing worth keeping,
    // and this check costs nothing: plain word cues, no model call.
    const lastUser = [...messages].reverse().find((m) => m?.role === "user");
    if (!shouldCapture(lastUser?.content)) return null;

    const limits = getTierLimits(isPremium);
    const existing = store.activeMemories().map((m) => ({
      id: m.id, content: m.content, category: m.category,
    }));

    const prompt = buildExtractionPrompt(messages.slice(-8), existing);
    const raw = await complete({
      model: M.MEMORY_EXTRACT_MODEL,
      effort: null,
      maxTokens: 900,
      messages: [{ role: "user", content: prompt }],
    });

    const ops = parseMemoryOps(raw);
    if (!ops.length) return null;
    return applyMemoryOps(ops, limits);
  } catch {
    // A failed capture is a memory not kept. It is never a broken conversation.
    return null;
  }
}

/** The memories worth carrying into THIS turn, and the block they render to. */
function retrieveMemories(text, { isPremium = false } = {}) {
  const limits = getTierLimits(isPremium);
  const picked = selectRelevantMemories(store.activeMemories(), text || "", limits.injectCount);
  // Mark them used, so recency scoring reflects what actually gets referenced.
  store.touchMemories(picked.map((m) => m.id));
  return picked;
}

function renderMemories(memories) {
  return renderMemoryBlock(memories || []);
}

module.exports = {
  captureMemories, retrieveMemories, renderMemories,
  applyMemoryOps, MEMORY_CAPABILITY_NOTE,
};
