// Emotional Engine — language policy.
//
// Not a personality trait, but it lives here so all of Braino's "how he communicates" rules sit
// in one folder. Controls which language he replies in. Default is "mirror_user" (reply in
// whatever language the user is speaking); "english" pins him to English.
//
// Moved verbatim from the original braino-prompt.ts so behavior is unchanged.

import type { ResponseMedium } from "./types.ts";

export function buildLanguagePolicyBlock(
  languagePolicy: string | null | undefined,
  _responseMedium: ResponseMedium,
): string {
  const normalized = String(languagePolicy || "mirror_user").trim().toLowerCase();
  if (normalized === "english") {
    return "Language: Reply in English unless the user explicitly asks for another language.";
  }

  return [
    "Language:",
    "- Reply in the same language the user is currently using.",
    "- Do not switch languages because of accents, names, quoted text, code, noise, or a few foreign words.",
    "- If the user's language is mixed or unclear, ask one short clarification instead of guessing.",
  ].join("\n");
}
