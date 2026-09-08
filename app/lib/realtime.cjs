// The realtime lane. Ported from supabase/functions/realtime/openai-realtime-call
// and the Mac client, with the Supabase half removed.
//
// THE LINE THAT MATTERS: output_modalities is ["text"]. The Realtime API never
// speaks. It exists for fast turn-taking and streaming transcription; Fish is
// the voice. Let Realtime emit audio and you get a generic assistant voice and
// you have lost the character.
//
// One deliberate difference from Braino. Braino asks Realtime to GENERATE the
// reply, which means the whole persona has to be pushed onto the session, and
// their own comment records what that cost: 26,000 characters of persona
// re-sent 18 times in one session, re-read before every answer, which was the
// ~900ms of dead air before his first word.
//
// Greeno never asks Realtime to generate. `create_response: false` means we
// produce the reply ourselves, through the same turn/delegate/memory path the
// hotkey already uses. So the session carries NO instructions at all, and that
// entire class of bug cannot happen here. Realtime is a microphone with good
// manners: it hears, it transcribes, and it tells us the instant someone starts
// talking so we can stop him mid-sentence.

const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";

// A client that can name its own model is a bill waiting to happen.
const ALLOWED_REALTIME_MODELS = new Set([
  "gpt-realtime-2.1",
  "gpt-realtime-2",
  "gpt-realtime-1.5",
  "gpt-realtime",
  "gpt-realtime-mini",
  "gpt-4o-realtime-preview",
]);

function resolveModel(requested) {
  const env = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini";
  return ALLOWED_REALTIME_MODELS.has(requested) ? requested : env;
}

/**
 * The session OpenAI gets at negotiation time.
 *
 * `noise_reduction` here is an opening default only. The client owns the
 * microphone and overrides it via session.update once the data channel opens.
 * "near_field" as the opening value told OpenAI the mic was at the user's
 * mouth, so a laptop voice at arm's length was scrubbed as room noise until
 * that update arrived.
 */
function buildSessionConfig(model) {
  return {
    type: "realtime",
    model,
    output_modalities: ["text"],       // ← THE line. Audio stays off. Fish is the voice.
    audio: {
      input: {
        noise_reduction: { type: "far_field" },
        transcription: {
          model: DEFAULT_TRANSCRIPTION_MODEL,
          // Without this he mirrors the wrong language back. A real shipped bug.
          language: "en",
          prompt: [
            "Transcribe the user's direct speech to Greeno.",
            "Ignore music, fans, coughs, accidental noises, and unrelated background speech.",
            "Keep names, app names, URLs, file names, and code tokens intact.",
            "If the input is not clear speech, leave it empty.",
          ].join(" "),
        },
        turn_detection: {
          // This value must match what the client sends in its own
          // session.update. Braino's server said "low" while both of its
          // clients said "medium", so the server's value was dead the instant
          // the data channel opened and quietly disagreed with them.
          type: "semantic_vad",
          eagerness: "medium",
          create_response: false,      // we generate the reply ourselves
          interrupt_response: true,    // barge-in
        },
      },
      output: { voice: process.env.OPENAI_REALTIME_VOICE || "marin" },
    },
  };
}

/**
 * Trade the browser's SDP offer for OpenAI's answer.
 *
 * The offer goes as MULTIPART form data, not JSON: `sdp` and `session`. Assuming
 * otherwise is an hour you do not get back.
 */
async function createCall({ offerSdp, model }) {
  // The offer is checked BEFORE the key. A malformed offer is a bug in our own
  // code and should say so, whether or not a key happens to be configured.
  // Reporting it as "no API key" sends you to the wrong file entirely.
  if (!offerSdp || !/^v=0\r?$/m.test(offerSdp) || !/^m=/m.test(offerSdp)) {
    throw new Error("the realtime offer did not look like SDP");
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");

  const realtimeModel = resolveModel(model);
  const form = new FormData();
  form.set("sdp", offerSdp);
  form.set("session", JSON.stringify(buildSessionConfig(realtimeModel)));

  const res = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  const body = await res.text();
  if (!res.ok) {
    let detail = body.slice(0, 300);
    try { detail = JSON.parse(body)?.error?.message || detail; } catch { /* not json */ }
    throw new Error(`realtime call failed (${res.status}): ${detail}`);
  }
  return { answerSdp: body, model: realtimeModel, transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL };
}

module.exports = { createCall, buildSessionConfig, resolveModel, ALLOWED_REALTIME_MODELS, DEFAULT_TRANSCRIPTION_MODEL };
