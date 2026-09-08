// One place for every model choice, with the reasoning about cost.
// Ported from supabase/functions/_shared/openai-models.ts and widened to cover
// the jobs the companion needs that the web app never did.

const env = (k, d) => (process.env[k] && String(process.env[k]).trim()) || d;

module.exports = {
  // Default text and vision for every Braino surface.
  TEXT_MODEL: env("BRAINO_TEXT_MODEL", "gpt-5.6-luna"),

  // GPT-5.4 Mini effectively ran without reasoning. GPT-5.6 defaults to medium,
  // so this has to be sent explicitly or every turn pays latency it does not use.
  TEXT_REASONING_EFFORT: "none",

  // Reached only by escalation, never because a caller asked for it. A path that
  // lets the caller pick the expensive model is a bill waiting to happen.
  RESCUE_MODEL: env("BRAINO_RESCUE_MODEL", "gpt-6-astra"),
  RESCUE_REASONING_EFFORT: "medium",
  RESCUE_MAX_TOKENS: 6000,

  TRANSCRIBE_MODEL: env("TRANSCRIBE_MODEL", "gpt-4o-transcribe"),
  DICTATION_REFINEMENT_MODEL: env("DICTATION_REFINEMENT_MODEL", "gpt-4.1-mini"),

  // The memory extractor. Cheap on purpose: it runs after every disclosing turn.
  MEMORY_EXTRACT_MODEL: env("MEMORY_EXTRACT_MODEL", "gpt-4o-mini"),

  FISH_MODEL: env("FISH_AUDIO_MODEL", "s2.1-pro"),
  // Braino. Brainelle is b67aedfb36d04c53892fd0e96db08180.
  FISH_REFERENCE_ID: env("FISH_AUDIO_REFERENCE_ID", env("FISH_AUDIO_VOICE_ID", "88b183bfbdda44a09ad4474712b967f4")),

  OPENAI_TTS_MODEL: env("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
  OPENAI_TTS_VOICE: env("OPENAI_TTS_VOICE", "marin"),
  OPENAI_TTS_INSTRUCTIONS: env(
    "OPENAI_TTS_INSTRUCTIONS",
    "Sound warm, direct, lively, and conversational. Keep the pacing natural and not announcer-like.",
  ),
  ENABLE_OPENAI_TTS_FALLBACK: env("ENABLE_OPENAI_TTS_FALLBACK", "true") !== "false",
};
