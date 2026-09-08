// Memory Engine — shared types.
//
// The engine has one job: while the user talks to Braino, quietly remember the durable facts and
// keep them up to date. Three ideas:
//   1. A MEMORY is one stored fact about the user (see braino_memories table).
//   2. A MEMORY OP is what the extractor decides to do: add a new one, update an old one, or
//      archive one that's no longer true.
//   3. TIER LIMITS cap how much we store/inject, by free vs premium.
//
// Read this, then README.md.

export type MemoryCategory =
  | "identity"     // who they are: name, role, where they live, language
  | "preference"   // how they like things: concise answers, dark mode, tone
  | "relationship" // people in their life: partner, kids, coworkers, pets
  | "project"      // what they're building/working on
  | "fact"         // any other durable fact
  | "event";       // a dated/temporal thing (a trip, a deadline, a recent happening)

export type MemorySource = "auto" | "user" | "voice";
export type MemoryStatus = "active" | "archived";

// One stored memory (mirrors a braino_memories row).
export type Memory = {
  id: string;
  user_id?: string;
  content: string;
  category: MemoryCategory;
  salience: 1 | 2 | 3;
  source: MemorySource;
  status: MemoryStatus;
  supersedes?: string | null;
  dedup_key?: string | null;
  last_used_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

// What the extractor LLM asks us to do to memory. Kept tiny and explicit on purpose.
export type MemoryOp =
  | { op: "add"; content: string; category: MemoryCategory; salience: 1 | 2 | 3 }
  | { op: "update"; id: string; content: string; category?: MemoryCategory; salience?: 1 | 2 | 3 }
  | { op: "archive"; id: string; reason?: string };

// A lighter shape we hand the extractor so it knows what already exists (and can update/dedupe).
export type ExistingMemoryRef = {
  id: string;
  content: string;
  category: MemoryCategory;
};

// How much memory a tier gets. Generous now; we tighten later by editing tiers.ts only.
export type TierLimits = {
  // Max active memories kept in storage. Over this, the lowest-salience/oldest get archived.
  storeCap: number;
  // How many memories we inject into a single prompt.
  injectCount: number;
};
