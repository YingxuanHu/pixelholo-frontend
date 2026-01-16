const apiBase = () => document.getElementById("apiBase").value.trim();

const state = {
  lastUpload: null,
  streamAbort: null,
  audioCtx: null,
  nextStart: 0,
};

const uploadBtn = document.getElementById("uploadBtn");
const uploadFile = document.getElementById("uploadFile");
const uploadProfile = document.getElementById("uploadProfile");
const uploadStatus = document.getElementById("uploadStatus");

const preprocessBtn = document.getElementById("preprocessBtn");
const preprocessLog = document.getElementById("preprocessLog");

const trainBtn = document.getElementById("trainBtn");
const trainLog = document.getElementById("trainLog");

const streamBtn = document.getElementById("streamBtn");
const stopBtn = document.getElementById("stopBtn");
const streamLog = document.getElementById("streamLog");
const streamStatus = document.getElementById("streamStatus");
const streamTiming = document.getElementById("streamTiming");

const setLog = (el, text) => {
  el.textContent = text;
  el.scrollTop = el.scrollHeight;
};

const appendLog = (el, text) => {
  el.textContent += text;
  el.scrollTop = el.scrollHeight;
};

const base64ToArrayBuffer = (base64) => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

const ensureAudioContext = async () => {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.audioCtx.state === "suspended") {
    await state.audioCtx.resume();
  }
};

const scheduleBuffer = (buffer) => {
  if (!state.audioCtx) return;
  const source = state.audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(state.audioCtx.destination);
  const startAt = Math.max(state.nextStart, state.audioCtx.currentTime + 0.05);
  source.start(startAt);
  state.nextStart = startAt + buffer.duration;
};

const streamTextResponse = async (response, onChunk) => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        onChunk(line);
      }
      index = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) {
    onChunk(buffer.trim());
  }
};

uploadBtn.addEventListener("click", async () => {
  const profile = uploadProfile.value.trim();
  const file = uploadFile.files[0];
  if (!profile || !file) {
    uploadStatus.textContent = "Provide a profile name and a file.";
    return;
  }
  uploadStatus.textContent = "Uploading...";
  const form = new FormData();
  form.append("profile", profile);
  form.append("file", file);
  try {
    const res = await fetch(`${apiBase()}/upload`, { method: "POST", body: form });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    state.lastUpload = { profile, filename: data.filename };
    uploadStatus.textContent = `Uploaded to ${data.saved_path}`;
  } catch (err) {
    uploadStatus.textContent = `Upload failed: ${err}`;
  }
});

preprocessBtn.addEventListener("click", async () => {
  if (!state.lastUpload) {
    setLog(preprocessLog, "Upload a file first.");
    return;
  }
  setLog(preprocessLog, "Starting preprocess...\n");
  const payload = {
    profile: state.lastUpload.profile,
    filename: state.lastUpload.filename,
  };
  try {
    const res = await fetch(`${apiBase()}/preprocess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    await streamTextResponse(res, (line) => appendLog(preprocessLog, line + "\n"));
  } catch (err) {
    appendLog(preprocessLog, `\nError: ${err}`);
  }
});

trainBtn.addEventListener("click", async () => {
  const profile = uploadProfile.value.trim() || document.getElementById("inferProfile").value.trim();
  if (!profile) {
    setLog(trainLog, "Provide a profile name.");
    return;
  }
  const payload = {
    profile,
    batch_size: Number(document.getElementById("trainBatch").value || 2),
    epochs: Number(document.getElementById("trainEpochs").value || 25),
    max_len: Number(document.getElementById("trainMaxLen").value || 400),
    auto_select_epoch: document.getElementById("flagSelectEpoch").checked,
    auto_tune_profile: document.getElementById("flagTuneProfile").checked,
    auto_build_lexicon: document.getElementById("flagLexicon").checked,
    select_thorough: document.getElementById("flagSelectThorough").checked,
    select_use_wer: document.getElementById("flagSelectWer").checked,
    early_stop: document.getElementById("flagEarlyStop").checked,
  };
  setLog(trainLog, "Starting training...\n");
  try {
    const res = await fetch(`${apiBase()}/train`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    await streamTextResponse(res, (line) => appendLog(trainLog, line + "\n"));
  } catch (err) {
    appendLog(trainLog, `\nError: ${err}`);
  }
});

const stopStream = () => {
  if (state.streamAbort) {
    state.streamAbort.abort();
    state.streamAbort = null;
  }
  streamStatus.textContent = "Stopped.";
};

stopBtn.addEventListener("click", stopStream);

streamBtn.addEventListener("click", async () => {
  const profile = document.getElementById("inferProfile").value.trim();
  const text = document.getElementById("inferText").value.trim();
  if (!profile || !text) {
    streamStatus.textContent = "Provide profile name and text.";
    return;
  }
  streamStatus.textContent = "Streaming...";
  streamTiming.textContent = "";
  setLog(streamLog, "");
  await ensureAudioContext();
  state.nextStart = state.audioCtx.currentTime + 0.1;

  const payload = {
    speaker: profile,
    text,
    model_path: document.getElementById("inferModel").value.trim() || null,
    ref_wav_path: document.getElementById("inferRef").value.trim() || null,
  };

  const controller = new AbortController();
  state.streamAbort = controller;
  const start = performance.now();
  let firstChunkTime = null;

  try {
    const res = await fetch(`${apiBase()}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(await res.text());
    await streamTextResponse(res, async (line) => {
      try {
        const data = JSON.parse(line);
        if (data.event === "done") {
          const totalMs = (performance.now() - start).toFixed(0);
          streamTiming.textContent = `Total: ${totalMs} ms`;
          streamStatus.textContent = "Done.";
          return;
        }
        if (!data.audio_base64) return;
        if (!firstChunkTime) {
          firstChunkTime = performance.now() - start;
          streamTiming.textContent = `First audio: ${firstChunkTime.toFixed(0)} ms`;
        }
        const arrayBuffer = base64ToArrayBuffer(data.audio_base64);
        const buffer = await state.audioCtx.decodeAudioData(arrayBuffer);
        scheduleBuffer(buffer);
        appendLog(streamLog, `Chunk ${data.chunk_index} (${buffer.duration.toFixed(2)}s)\n`);
      } catch (err) {
        appendLog(streamLog, `Parse error: ${err}\n`);
      }
    });
  } catch (err) {
    if (err.name !== "AbortError") {
      streamStatus.textContent = `Error: ${err}`;
    }
  }
});
