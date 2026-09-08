// One text-and-vision default for every Braino surface backed by an Edge Function.
// Purpose-built realtime, transcription, TTS, embedding, and moderation models stay
// separate because this model cannot replace those API contracts.
export const BRAINO_TEXT_MODEL = "gpt-5.6-luna";

// GPT-5.4 Mini effectively ran without reasoning. GPT-5.6 defaults to medium,
// so callers moving to Luna must send this explicitly to preserve latency and cost.
export const BRAINO_TEXT_REASONING_EFFORT = "none" as const;
