// Memory Engine — retrieval. Pick the most relevant memories for THIS conversation.
//
// v1 is deterministic (no embeddings): score each memory by how important it is (salience), how
// recently it mattered (recency), and whether it overlaps with what the user just said (keyword
// overlap). Return the top slice. pgvector semantic search is a planned later upgrade that would
// slot in right here.

import type { Memory } from "./types.ts";

const STOPWORDS = new Set(
  "the a an and or but to of in on at for is are was were be been i you he she it we they my your his her our their this that with as from about into over under just so do does did have has had can could would should will".split(
    " ",
  ),
);

function keywords(text: string): Set<string> {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function recencyBoost(memory: Memory): number {
  const ts = memory.last_used_at || memory.updated_at || memory.created_at;
  if (!ts) return 0;
  const ageDays = (Date.now() - new Date(ts).getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays)) return 0;
  // Fresh memories get up to +1.5, decaying over ~60 days, never negative.
  return Math.max(0, 1.5 - ageDays / 40);
}

// Rank and take the top `limit` memories. Identity/core facts (high salience) always score well,
// so a user's name/role rides along even when the message doesn't mention it; topical memories
// surface when the message overlaps them.
export function selectRelevantMemories(memories: Memory[], message: string, limit: number): Memory[] {
  const active = memories.filter((m) => m.status !== "archived");
  if (active.length <= limit) {
    return [...active].sort((a, b) => b.salience - a.salience);
  }

  const msgWords = keywords(message);
  const scored = active.map((m) => {
    const overlap = msgWords.size
      ? [...keywords(m.content)].filter((w) => msgWords.has(w)).length
      : 0;
    const score = m.salience * 2 + recencyBoost(m) + overlap * 1.5;
    return { m, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.m);
}
