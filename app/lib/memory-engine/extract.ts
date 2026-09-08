// Memory Engine — extraction. The "what should I remember / update / forget?" brain.
//
// Pure functions only (no DB, no network): build the prompt we send to a cheap LLM, and parse the
// strict-JSON ops it returns. The orchestrator (capture.ts) does the actual model call + writes.

import type { ExistingMemoryRef, MemoryCategory, MemoryOp } from "./types.ts";

type ChatMsg = { role: string; content: string };

const CATEGORIES: MemoryCategory[] = ["identity", "preference", "relationship", "project", "fact", "event"];

// Build the extraction prompt. The model sees what's already remembered (with ids, so it can
// update/archive precisely) and the recent conversation, and returns a JSON list of operations.
export function buildExtractionPrompt(recentMessages: ChatMsg[], existing: ExistingMemoryRef[]): string {
  const convo = recentMessages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && String(m.content || "").trim())
    .slice(-8)
    .map((m) => `${m.role === "user" ? "User" : "Braino"}: ${String(m.content).trim()}`)
    .join("\n");

  const existingList = existing.length
    ? existing.map((m) => `[${m.id}] (${m.category}) ${m.content}`).join("\n")
    : "(none yet)";

  return `You maintain Braino's long-term memory of ONE user. From the latest conversation, decide what durable facts to remember, update, or forget. Be conservative and precise.

What counts as memory (remember it):
- Identity: name, age, role/job, where they live, languages they speak.
- Preferences: how they like answers/tools/tone (e.g. prefers concise answers, dark mode).
- Relationships: people/pets in their life (partner, kids, coworkers, friends, pets) and names.
- Projects: what they're building or working on.
- Durable facts & meaningful events (a move, a new job, a trip, a deadline).

What is NOT memory (ignore it):
- One-off task requests ("summarize this", "fix this bug"), questions, or anything about Braino itself.
- General world knowledge, transient mood, or anything not specifically about this user.
- Sensitive specifics you shouldn't store (full payment card numbers, passwords).

Rules:
- Write each memory as a short third-person statement starting with "User " (e.g. "User is building an app called Braino").
- If a NEW fact contradicts or refines an existing memory, use "update" with that memory's id (not a new add).
- If an existing memory is now clearly false/obsolete, "archive" it by id.
- Do NOT re-add something already in the existing list. No duplicates.
- salience: 3 = core identity/important, 2 = normal, 1 = minor.
- category must be one of: ${CATEGORIES.join(", ")}.

Existing memories:
${existingList}

Recent conversation:
${convo}

Respond with STRICT JSON only, no prose, in exactly this shape:
{"ops": [
  {"op":"add","content":"User ...","category":"identity","salience":3},
  {"op":"update","id":"<existing-id>","content":"User ...","category":"project","salience":2},
  {"op":"archive","id":"<existing-id>","reason":"no longer true"}
]}
If there is nothing worth remembering, respond with {"ops": []}.`;
}

// Parse the model's JSON into validated ops. Tolerates code fences and stray prose around the JSON.
export function parseMemoryOps(raw: string): MemoryOp[] {
  const text = String(raw || "").trim();
  if (!text) return [];

  let jsonStr = text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) jsonStr = fence[1].trim();

  // If there's surrounding prose, grab the outermost {...}.
  if (!jsonStr.startsWith("{") && !jsonStr.startsWith("[")) {
    const start = jsonStr.indexOf("{");
    const end = jsonStr.lastIndexOf("}");
    if (start >= 0 && end > start) jsonStr = jsonStr.slice(start, end + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }

  const rawOps = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as any)?.ops)
      ? (parsed as any).ops
      : [];

  const ops: MemoryOp[] = [];
  for (const o of rawOps) {
    if (!o || typeof o !== "object") continue;
    const op = String((o as any).op || "").toLowerCase();

    if (op === "add") {
      const content = cleanContent((o as any).content);
      if (!content) continue;
      ops.push({ op: "add", content, category: normCategory((o as any).category), salience: normSalience((o as any).salience) });
    } else if (op === "update") {
      const id = String((o as any).id || "").trim();
      const content = cleanContent((o as any).content);
      if (!id || !content) continue;
      ops.push({ op: "update", id, content, category: normCategory((o as any).category), salience: normSalience((o as any).salience) });
    } else if (op === "archive") {
      const id = String((o as any).id || "").trim();
      if (!id) continue;
      ops.push({ op: "archive", id, reason: String((o as any).reason || "").trim() || undefined });
    }
  }
  return ops;
}

function cleanContent(value: unknown): string {
  const s = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return s.length > 400 ? s.slice(0, 399) + "…" : s;
}

function normCategory(value: unknown): MemoryCategory {
  const c = String(value || "").toLowerCase();
  return (CATEGORIES as string[]).includes(c) ? (c as MemoryCategory) : "fact";
}

function normSalience(value: unknown): 1 | 2 | 3 {
  const n = Math.round(Number(value));
  return n === 1 || n === 3 ? n : 2;
}
