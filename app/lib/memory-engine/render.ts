// Memory Engine, render memories into prompt text.
//
// Turns the selected memories into the block that gets injected into Braino's system prompt, plus
// a short capability note so Braino knows it HAS long-term memory and can use/acknowledge it
// naturally ("I'll remember that").

import type { Memory } from "./types.ts";

// One line per memory, grouped lightly by category for readability by the model.
export function renderMemoryBlock(memories: Memory[]): string {
  if (!memories.length) return "";
  const lines = memories.map((m) => `- ${m.content.trim()}`);
  return [
    "Things you remember about this user (your long-term memory, use it naturally, don't recite it):",
    ...lines,
  ].join("\n");
}

// A short standing instruction about the memory capability. Added to the prompt once, regardless
// of whether there are memories yet, so Braino behaves like it has a memory from day one.
export const MEMORY_CAPABILITY_NOTE =
  "Long-term memory: You remember important, durable things about this user across conversations, who they are, what they're building, how they like things. Use what you remember naturally, as a friend would, without announcing it or listing it back. When the user shares something clearly worth keeping (their name, a preference, a project, a person in their life), you can briefly acknowledge it (\"got it, I'll remember that\"), it's saved automatically. Never claim to remember something you don't, and never say you can't remember across sessions.";
