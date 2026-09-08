// Every call to OpenAI goes through here. The Electron main process is the
// trusted side, so the key lives here and never reaches a renderer.

const M = require("./models.cjs");

const API = "https://api.openai.com/v1";
const key = () => process.env.OPENAI_API_KEY || "";

function requireKey() {
  if (!key()) throw new Error("OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in.");
}

// Pull the assistant text out of a Responses API payload. The shape moves around
// between models, so every known spelling is handled rather than the one that
// happened to work the day it was written.
function textFrom(data) {
  if (!data) return "";
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const msg = Array.isArray(data.output) ? data.output.find((o) => o.type === "message") : null;
  const parts = msg?.content;
  if (Array.isArray(parts)) {
    const joined = parts.map((p) => p?.text || p?.output_text || "").join("").trim();
    if (joined) return joined;
  }
  if (Array.isArray(data.output)) {
    const any = data.output
      .flatMap((o) => (Array.isArray(o.content) ? o.content : []))
      .map((p) => p?.text || "")
      .join("")
      .trim();
    if (any) return any;
  }
  return "";
}

async function post(path, body, { timeoutMs = 60000 } = {}) {
  requireKey();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data?.error?.message || `HTTP ${res.status}`;
      const err = new Error(detail);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One plain turn. Returns text.
 *
 * maxTokens is sized with the reasoning in mind on purpose. A ceiling picked for
 * a non-reasoning model gets eaten by the thinking and returns an empty string,
 * which looks exactly like a broken model and is the most expensive hour in this
 * whole pipeline to debug.
 */
async function complete({
  system,
  messages = [],
  model = M.TEXT_MODEL,
  effort = M.TEXT_REASONING_EFFORT,
  maxTokens = 1200,
  temperature,
}) {
  const input = [];
  if (system) input.push({ role: "system", content: system });
  for (const m of messages) input.push({ role: m.role, content: m.content });

  const body = { model, input, max_output_tokens: maxTokens };
  if (effort) body.reasoning = { effort };
  if (typeof temperature === "number") body.temperature = temperature;

  const data = await post("/responses", body);
  return textFrom(data);
}

/**
 * A turn that must come back as a specific shape.
 *
 * The schema is enforced by the API, not by the prompt. A prompt that asks
 * politely for JSON gets JSON most of the time, and "most of the time" is a
 * crash in the middle of someone's onboarding.
 */
async function structured({
  system,
  user,
  schema,
  name = "result",
  model = M.TEXT_MODEL,
  effort = M.TEXT_REASONING_EFFORT,
  maxTokens = 4000,
}) {
  const body = {
    model,
    input: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: user },
    ],
    max_output_tokens: maxTokens,
    text: { format: { type: "json_schema", name, strict: true, schema } },
  };
  if (effort) body.reasoning = { effort };

  const data = await post("/responses", body);
  const raw = textFrom(data);
  if (!raw) {
    const why = data?.incomplete_details?.reason || data?.status || "no content";
    throw new Error(`structured call returned nothing (${why})`);
  }
  return JSON.parse(raw);
}

/**
 * The rescue path. Reached only by escalation, never because a caller asked.
 * Used when the default model comes back empty on a turn that matters.
 */
async function rescue({ system, messages }) {
  return complete({
    system,
    messages,
    model: M.RESCUE_MODEL,
    effort: M.RESCUE_REASONING_EFFORT,
    maxTokens: M.RESCUE_MAX_TOKENS,
  });
}

/**
 * Speech to text. Takes raw audio bytes, gives words back.
 *
 * The prompt keeps the filler words on purpose. The onboarding yap is dictation,
 * and a transcript tidied into corporate English produces a notebook that does
 * not sound like the person, which is exactly what loses the read-back approval.
 */
async function transcribe(buffer, { filename = "audio.webm", mimeType = "audio/webm", prompt } = {}) {
  requireKey();
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), filename);
  form.append("model", M.TRANSCRIBE_MODEL);
  form.append("language", "en");     // without this he mirrors the wrong language
  form.append(
    "prompt",
    prompt ||
      [
        "This is a person talking about their own day and their own life.",
        "Transcribe every clearly spoken word faithfully.",
        "Keep openings, filler words, repetitions, false starts and slang when they are spoken.",
        "Add only punctuation and capitalization that are strongly supported by the speech.",
        "Keep names, brands, acronyms, numbers, app names and times exact.",
        "Do not summarize, answer, add ideas, or silently rewrite the meaning.",
        "Ignore music, keyboard noise, fans, coughs, and unrelated background speech.",
      ].join(" "),
  );

  const res = await fetch(`${API}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `transcription failed: HTTP ${res.status}`);
  return String(data.text || "").trim();
}

/**
 * Hera's cleanup pass. The user's own words, tidied only where the speech
 * clearly supports it. Never applied to the summarizer's input.
 */
async function refineDictation(text) {
  if (!text || !text.trim()) return "";
  return complete({
    model: M.DICTATION_REFINEMENT_MODEL,
    effort: null,
    maxTokens: 2000,
    system:
      "You clean up dictated text for insertion into a document. Fix punctuation, capitalization and obvious transcription slips. Keep the speaker's own words, tone and slang. Do not summarize, answer, reorder, or add anything. Never use an em-dash or an en-dash. Return only the cleaned text.",
    messages: [{ role: "user", content: text }],
  });
}

// Vision. One screenshot, one question, one short answer.
async function look({ system, prompt, imageBase64, maxTokens = 300 }) {
  const data = await post("/responses", {
    model: M.TEXT_MODEL,
    reasoning: { effort: M.TEXT_REASONING_EFFORT },
    max_output_tokens: maxTokens,
    input: [
      ...(system ? [{ role: "system", content: system }] : []),
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: `data:image/jpeg;base64,${imageBase64}` },
        ],
      },
    ],
  });
  return textFrom(data);
}

module.exports = { complete, structured, rescue, transcribe, refineDictation, look, textFrom, hasKey: () => Boolean(key()) };
