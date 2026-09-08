// The realtime lane, client side. WebRTC with an ordered data channel.
//
// What this is for: hearing the user the instant they start, streaming their
// words as they say them, and telling us to shut Greeno up mid-sentence. It
// never generates a reply. The transcript goes into the same turn pipeline the
// hotkey already uses, and Fish speaks the answer.
(function () {
  let pc = null;
  let dc = null;
  let stream = null;
  let remoteAudio = null;
  let generation = 0;              // bumped by every stop, so stale events retire
  let active = false;
  let connecting = false;
  let liveTranscript = "";
  let flushTimer = null;
  const on = {};                   // { ready, speechStart, speechStop, partial, final, error, closed }

  const emit = (name, ...args) => { try { on[name]?.(...args); } catch (err) { console.error("[greeno] realtime handler", name, err); } };

  // A laptop microphone is at arm's length; a headset is at your mouth. Telling
  // OpenAI the wrong one is why a normal speaking voice gets scrubbed as room
  // noise. Guess from the device label and correct it on the session once the
  // channel is open.
  function noiseReductionFor(track) {
    const label = String(track?.label || "").toLowerCase();
    const builtIn = /macbook|built-?in|internal|imac|studio display/.test(label);
    return builtIn ? "far_field" : "near_field";
  }

  function send(event) {
    if (!dc || dc.readyState !== "open") return false;
    try { dc.send(JSON.stringify(event)); return true; } catch { return false; }
  }

  async function start(handlers = {}) {
    if (active || connecting) return true;
    Object.assign(on, handlers);
    connecting = true;
    const token = ++generation;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Echo cancellation is not optional here: Greeno is talking out loud
          // through the speakers while this microphone is open, and without it
          // he hears himself and answers himself.
          echoCancellation: true,
          // One noise-reduction stage, not two. OpenAI does its own, keyed to
          // the field verdict below; running Chromium's on top of it is how
          // speech starts sounding underwater.
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      pc = new RTCPeerConnection();
      const track = stream.getAudioTracks()[0];
      const verdict = noiseReductionFor(track);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      // The remote track is attached and then MUTED. Not skipped: attaching it
      // keeps the negotiation standard and leaves the option of switching to
      // OpenAI's voice later. Muting it is what makes Fish the voice.
      remoteAudio = new Audio();
      remoteAudio.autoplay = true;
      remoteAudio.muted = true;
      remoteAudio.volume = 0;
      document.body.appendChild(remoteAudio);
      pc.addEventListener("track", (e) => {
        remoteAudio.srcObject = e.streams[0] || new MediaStream([e.track]);
        remoteAudio.play().catch(() => {});
      });

      pc.addEventListener("connectionstatechange", () => {
        if (token !== generation) return;
        if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
          emit("error", `voice disconnected (${pc.connectionState})`);
          stop("peer_" + pc.connectionState);
        }
      });

      dc = pc.createDataChannel("oai-events");
      dc.addEventListener("message", (e) => {
        if (token !== generation) return;
        let payload;
        try { payload = JSON.parse(e.data); } catch { return; }
        handleEvent(payload, token);
      });

      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      const offerSdp = pc.localDescription?.sdp || offer.sdp;

      const result = await window.greeno.realtimeCall({ offerSdp });
      if (token !== generation) return false;
      await pc.setRemoteDescription({ type: "answer", sdp: result.answerSdp });

      await waitForChannel(dc, token);
      if (token !== generation) return false;

      // The client owns the microphone, so the real verdict is sent now, over
      // the ordered channel, before anything else can arrive.
      //
      // Note what is NOT here: instructions. Realtime never generates for us, so
      // it never needs the persona, and the 26k-character session.update that
      // cost Braino ~900ms before every first word simply does not exist.
      send({
        type: "session.update",
        session: {
          type: "realtime",
          audio: {
            input: {
              noise_reduction: { type: verdict },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "medium",     // must match the server's opening value
                create_response: false,
                interrupt_response: true,
              },
            },
          },
        },
      });

      active = true;
      connecting = false;
      emit("ready", { noiseReduction: verdict, device: track?.label || "" });
      return true;
    } catch (err) {
      connecting = false;
      teardown();
      emit("error", String(err?.message || err));
      return false;
    }
  }

  function waitForChannel(channel, token) {
    if (channel.readyState === "open") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the voice channel did not open")), 12000);
      channel.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      channel.addEventListener("error", () => { clearTimeout(timer); reject(new Error("voice channel error")); }, { once: true });
      const poll = setInterval(() => {
        if (token !== generation) { clearInterval(poll); clearTimeout(timer); reject(new Error("stale")); }
      }, 250);
      channel.addEventListener("open", () => clearInterval(poll), { once: true });
    });
  }

  function handleEvent(event, token) {
    if (token !== generation) return;
    const type = event?.type;

    if (type === "input_audio_buffer.speech_started") {
      liveTranscript = "";
      clearTimeout(flushTimer);
      // THE barge-in. Trust the physical audio state, not a flag: `speaking`
      // goes stale while a long Fish stream is still audible, which used to make
      // interruptions land here and do nothing until the clip finished.
      emit("speechStart");
      return;
    }

    if (type === "input_audio_buffer.speech_stopped") {
      emit("speechStop");
      // A safety net only. `completed` normally arrives and flushes first; this
      // stops a dropped completion event from swallowing the whole phrase.
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => flush("speech_stopped_timeout"), 2500);
      return;
    }

    if (type === "conversation.item.input_audio_transcription.delta") {
      liveTranscript += String(event.delta || "");
      emit("partial", liveTranscript);
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      liveTranscript = String(event.transcript || liveTranscript || "");
      flush("completed");
      return;
    }

    if (type === "conversation.item.input_audio_transcription.failed") {
      liveTranscript = "";
      emit("error", event?.error?.message || "that did not transcribe");
      return;
    }

    if (type === "error") {
      emit("error", event?.error?.message || "realtime error");
    }
  }

  function flush(reason) {
    clearTimeout(flushTimer);
    const text = liveTranscript.trim();
    liveTranscript = "";
    if (!text) return;
    emit("final", text, reason);
  }

  function teardown() {
    clearTimeout(flushTimer);
    try { dc?.close(); } catch {}
    try { pc?.close(); } catch {}
    stream?.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    if (remoteAudio) {
      try { remoteAudio.pause(); remoteAudio.srcObject = null; remoteAudio.remove(); } catch {}
    }
    dc = null; pc = null; stream = null; remoteAudio = null;
    liveTranscript = "";
    active = false;
    connecting = false;
  }

  function stop(reason = "manual") {
    if (!active && !connecting) return;
    generation += 1;                 // everything in flight is now stale
    teardown();
    emit("closed", reason);
  }

  window.GreenoRealtime = {
    start, stop, send,
    get active() { return active; },
    get connecting() { return connecting; },
  };
})();
