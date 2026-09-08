const test = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const e = require("../app/lib/engine.cjs");
const store = require("../app/lib/store.cjs");
store.init(fs.mkdtempSync(path.join(os.tmpdir(), "greeno-mem-t-")));
const memory = require("../app/lib/memory.cjs");

// The gate is what keeps this cheap. If it fired on every turn, every "what is
// 2+2" would cost an extraction call.
test("the gate only opens on something worth remembering", () => {
  for (const yes of [
    "my name is Itish",
    "i hate mornings",
    "i'm building a companion app",
    "remember that the gym is on tuesdays",
    "my sister is visiting next week",
  ]) assert.ok(e.shouldCapture(yes), `should have captured: "${yes}"`);

  for (const no of [
    "what is 2+2",
    "open spotify",
    "summarize this page",
    "ok",
    "what time is it",
  ]) assert.ok(!e.shouldCapture(no), `should NOT have captured: "${no}"`);
});

test("retrieval ranks by salience, recency and overlap", () => {
  store.reset();
  store.addMemory({ content: "User's name is Itish.", category: "identity", salience: 3 });
  store.addMemory({ content: "Hates mornings, best work after 9pm.", category: "preference", salience: 2 });
  store.addMemory({ content: "Once mentioned liking pistachio ice cream.", category: "fact", salience: 1 });
  store.saveMemories();

  const picked = memory.retrieveMemories("when should i do deep work", { isPremium: false });
  assert.ok(picked.length >= 2);
  // High-salience identity rides along even when the message does not mention it.
  assert.ok(picked.some((m) => /Itish/.test(m.content)), "identity did not ride along");
  assert.ok(picked.some((m) => /mornings/.test(m.content)), "the relevant preference was not surfaced");
});

test("the same fact twice does not become two memories", () => {
  store.reset();
  const limits = e.getTierLimits(false);
  memory.applyMemoryOps([{ op: "add", content: "User's name is Itish.", category: "identity", salience: 3 }], limits);
  memory.applyMemoryOps([{ op: "add", content: "user's name is itish.", category: "identity", salience: 3 }], limits);
  assert.strictEqual(store.activeMemories().length, 1, "the duplicate was stored");
});

// Someone's own facts about themselves are not ours to throw away.
test("overflow is archived, never deleted", () => {
  store.reset();
  const limits = { storeCap: 5, injectCount: 3 };
  for (let i = 0; i < 8; i++) {
    memory.applyMemoryOps(
      [{ op: "add", content: `fact number ${i}`, category: "fact", salience: i < 2 ? 1 : 3 }],
      limits,
    );
  }
  assert.strictEqual(store.activeMemories().length, 5, "the cap was not enforced");
  assert.strictEqual(store.allMemories().length, 8, "memories were deleted instead of archived");

  // The two low-salience ones go FIRST. Once they are gone the cap still has to
  // be met, so a high-salience memory going third is correct, not a bug.
  const archived = store.allMemories().filter((m) => m.status === "archived");
  assert.strictEqual(archived.length, 3);
  const lowArchived = archived.filter((m) => m.salience === 1).length;
  assert.strictEqual(lowArchived, 2, "the low-salience memories were not archived first");
});

test("archived memories never reach a prompt", () => {
  store.reset();
  store.addMemory({ content: "still true", category: "fact", salience: 3 });
  const gone = store.addMemory({ content: "no longer true", category: "fact", salience: 3 });
  store.archiveMemory(gone.id);
  store.saveMemories();
  const block = memory.renderMemories(memory.retrieveMemories("anything"));
  assert.ok(block.includes("still true"));
  assert.ok(!block.includes("no longer true"), "an archived memory was injected");
});

test("he is told he has a memory even before he has one", () => {
  store.reset();
  assert.ok(memory.MEMORY_CAPABILITY_NOTE.length > 100);
  assert.ok(/never say you can'?t remember across sessions/i.test(memory.MEMORY_CAPABILITY_NOTE));
});

test("capture never throws, whatever happens", async () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const out = await memory.captureMemories([{ role: "user", content: "my name is Itish" }]);
  assert.strictEqual(out, null, "a keyless capture should return null, not throw");
  if (saved) process.env.OPENAI_API_KEY = saved;
});
