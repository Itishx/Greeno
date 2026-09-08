// Emotional Engine — CLASSES. The fork point for splitting one Braino into several.
//
// Until now every surface shared one personality (ORDERED_TRAITS in manifest.ts). Braino is
// splitting into three classes with their own identity: Saburi (the companion), Iomi, and Telos.
// Each class gets its own entry here. Today they all still point at the shared trait set — swap
// a class's `traits` to a class-specific ORDERED_TRAITS (its own traits/ folder, its own
// manifest.ts) when that class's system prompt is ready to diverge for real.
//
// Saburi is first: its final trait set is meant to be derived from the book the founder is
// supplying (an emotionally-intelligent-companion playbook), read in full and distilled into
// trait prose — not pasted in as raw pages. Until that read happens, Saburi runs the shared
// default so the page/product isn't blocked on it.

import type { ClassId, Trait } from "./types.ts";
import { ORDERED_TRAITS } from "./manifest.ts";

export type ClassManifest = {
  id: ClassId;
  name: string;
  summary: string;
  traits: Trait[];
  // Set once this class's traits/ folder has been written specifically for it.
  distinctPrompt: boolean;
};

export const CLASS_MANIFESTS: Record<ClassId, ClassManifest> = {
  braino: {
    id: "braino",
    name: "Braino",
    summary: "The original, undifferentiated product. Every surface before the three-class split.",
    traits: ORDERED_TRAITS,
    distinctPrompt: false,
  },
  saburi: {
    id: "saburi",
    name: "Braino Saburi",
    summary: "The companion class. First to launch. Emotionally intelligent, never clinical.",
    // TODO(saburi-book): replace with a Saburi-only trait set once the founder's book is read
    // and distilled into trait prose. Track in traits/ under this class, not a shared file.
    traits: ORDERED_TRAITS,
    distinctPrompt: false,
  },
  iomi: {
    id: "iomi",
    name: "Braino Iomi",
    summary: "Second class. Trait set not yet forked from the shared default.",
    traits: ORDERED_TRAITS,
    distinctPrompt: false,
  },
  telos: {
    id: "telos",
    name: "Braino Telos",
    summary: "Third class. Trait set not yet forked from the shared default.",
    traits: ORDERED_TRAITS,
    distinctPrompt: false,
  },
};

export function getClassManifest(classId?: ClassId | null): ClassManifest {
  if (classId && CLASS_MANIFESTS[classId]) return CLASS_MANIFESTS[classId];
  return CLASS_MANIFESTS.braino;
}
