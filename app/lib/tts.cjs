// The voice. Fish Audio is the identity; OpenAI TTS is the safety net.
//
// Ported from supabase/functions/voice/fish-audio-tts. Two things here are worth
// more than they look:
//   1. `model` goes in the HEADER, not the body. It costs an hour to assume otherwise.
//   2. The response is streamed through, never awaited as an arrayBuffer. Bytes
//      reach the speaker as Fish generates them, so playback starts on the first
//      chunk instead of after the last one.

const M = require("./models.cjs");

// 402 is out of credits and fatal. 429 is a transient burst limit and worth a
// retry. 401 is a bad key. Everything 5xx is the provider having a bad day.
function normalizeFishErrorStatus(status) {
  if (status === 402) return "credits";
  if (status === 429) return "rate_limit";
  if (status === 401) return "invalid_api_key";
  if (status >= 500) return "provider_unavailable";
  return "provider_error";
}

function fishBody(text, { latency = "normal", referenceId } = {}) {
  const body = {
    text: String(text).slice(0, 2000),
    temperature: 0.7,
    top_p: 0.7,
    prosody: { speed: 1, volume: 0, normalize_loudness: true },
    // Smaller chunks mean Fish emits the first frames sooner, which is what
    // makes streaming playback feel responsive rather than merely fast.
    chunk_length: 100,
    normalize: true,
    format: "mp3",
    sample_rate: 44100,
    mp3_bitrate: 128,
    latency,
    max_new_tokens: 1024,
    repetition_penalty: 1.2,
    min_chunk_length: 20,
    condition_on_previous_chunks: true,
    early_stop_threshold: 1,
  };
  const ref = referenceId || M.FISH_REFERENCE_ID;
  if (ref) body.reference_id = ref;
  return body;
}

/**
 * Returns a live fetch Response whose body is the mp3 stream, or throws with a
 * normalized `kind` so the caller can tell "out of credits" from "try again".
 */
async function fishSpeak(text, opts = {}) {
  const apiKey = process.env.FISH_AUDIO_API_KEY;
  if (!apiKey) {
    const err = new Error("FISH_AUDIO_API_KEY is not set");
    err.kind = "no_key";
    throw err;
  }

  const res = await fetch("https://api.fish.audio/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      model: M.FISH_MODEL,          // a HEADER, not a body field
    },
    body: JSON.stringify(fishBody(text, opts)),
  });

  if (!res.ok) {
    const kind = normalizeFishErrorStatus(res.status);
    const detail = await res.text().catch(() => "");
    const err = new Error(`fish ${res.status}: ${detail.slice(0, 300)}`);
    err.kind = kind;
    err.status = res.status;
    throw err;
  }
  return res;
}

/** OpenAI TTS. Reached only when Fish cannot answer. */
async function openaiSpeak(text) {
  if (!M.ENABLE_OPENAI_TTS_FALLBACK) {
    const err = new Error("OpenAI TTS fallback is disabled");
    err.kind = "fallback_disabled";
    throw err;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not set");
    err.kind = "no_key";
    throw err;
  }

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: M.OPENAI_TTS_MODEL,
      voice: M.OPENAI_TTS_VOICE,
      input: String(text).slice(0, 4000),
      instructions: M.OPENAI_TTS_INSTRUCTIONS,
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`openai tts ${res.status}: ${detail.slice(0, 300)}`);
    err.kind = "provider_error";
    throw err;
  }
  return res;
}

/**
 * Fish, then OpenAI. Out of credits and a bad key both fall through, because in
 * both cases Fish is not coming back this session and a silent Braino is worse
 * than a Braino in a borrowed voice.
 */
async function speak(text, opts = {}) {
  try {
    const res = await fishSpeak(text, opts);
    return { res, provider: "fish" };
  } catch (err) {
    if (err.kind === "rate_limit") {
      await new Promise((r) => setTimeout(r, 400));
      try {
        const res = await fishSpeak(text, opts);
        return { res, provider: "fish" };
      } catch { /* fall through to OpenAI */ }
    }
    const res = await openaiSpeak(text);
    return { res, provider: "openai", fishError: err.kind };
  }
}

module.exports = { speak, fishSpeak, openaiSpeak, normalizeFishErrorStatus };
