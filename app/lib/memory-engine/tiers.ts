// Memory Engine — pricing tiers.
//
// This is the ONE file to edit when we decide to cap memory by plan. Right now both tiers are
// generous (we're building the habit, not monetizing it yet). Later, lower FREE.storeCap /
// FREE.injectCount and the rest of the engine enforces it automatically.

import type { TierLimits } from "./types.ts";

export const FREE_LIMITS: TierLimits = {
  storeCap: 200,    // active memories kept; overflow gets archived (not deleted)
  injectCount: 15,  // how many memories ride along in a single prompt
};

export const PREMIUM_LIMITS: TierLimits = {
  storeCap: 5000,
  injectCount: 40,
};

export function getTierLimits(isPremium: boolean | null | undefined): TierLimits {
  return isPremium ? PREMIUM_LIMITS : FREE_LIMITS;
}
