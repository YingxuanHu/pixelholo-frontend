import React, { useCallback, useEffect, useRef, useState } from 'react';
import Header from './components/Header';
import StepCard from './components/StepCard';
import LogPanel from './components/LogPanel';
import {
  Profile,
  StepStatus,
  LogEntry,
  PreprocessStats,
  TrainStats,
  InferenceChunk,
  ProfileInfo,
} from './types';

type TrainFlags = {
  autoSelectEpoch: boolean;
  autoTuneProfile: boolean;
  autoBuildLexicon: boolean;
  selectThorough: boolean;
  selectUseWer: boolean;
  earlyStop: boolean;
};

type TrainParams = {
  batchSize: number;
  epochs: number;
  maxLen: number;
};

const createLog = (message: string, level: LogEntry['level'] = 'info'): LogEntry => ({
  id: Math.random().toString(36).slice(2, 10),
  timestamp: new Date().toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }),
  level,
  message,
});

const defaultFlags: TrainFlags = {
  autoSelectEpoch: true,
  autoTuneProfile: true,
  autoBuildLexicon: true,
  selectThorough: true,
  selectUseWer: false,
  earlyStop: true,
};

const defaultTrainParams: TrainParams = {
  batchSize: 2,
  epochs: 25,
  maxLen: 400,
};

const App: React.FC = () => {
  const [activeStep, setActiveStep] = useState(1);
  const [apiBase, setApiBase] = useState('http://127.0.0.1:8000');
  const [apiStatus, setApiStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [profile, setProfile] = useState<Profile>({ name: '', lastUploadedFile: null, fileSize: null });
  const [lastUploadedFilename, setLastUploadedFilename] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [profilesStatus, setProfilesStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>({
    upload: 'idle',
    preprocess: 'idle',
    train: 'idle',
    inference: 'idle',
  });
  const [preprocessLogs, setPreprocessLogs] = useState<LogEntry[]>([]);
  const [trainLogs, setTrainLogs] = useState<LogEntry[]>([]);
  const [preprocessStats, setPreprocessStats] = useState<PreprocessStats | null>(null);
  const [trainStats, setTrainStats] = useState<TrainStats | null>(null);
  const [trainFlags, setTrainFlags] = useState<TrainFlags>(defaultFlags);
  const [trainParams, setTrainParams] = useState<TrainParams>(defaultTrainParams);
  const [inferenceText, setInferenceText] = useState('');
  const [inferenceChunks, setInferenceChunks] = useState<InferenceChunk[]>([]);
  const [latency, setLatency] = useState<{ ttfa: number; total: number } | null>(null);
  const [modelOverride, setModelOverride] = useState('');
  const [refOverride, setRefOverride] = useState('');

  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const streamAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const cached = localStorage.getItem('voxclone_api_base');
    if (cached) setApiBase(cached);
  }, []);

  useEffect(() => {
    localStorage.setItem('voxclone_api_base', apiBase);
  }, [apiBase]);

  const loadProfiles = useCallback(async () => {
    setProfilesStatus('loading');
    try {
      const res = await fetch(`${apiBase}/profiles`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setProfiles(Array.isArray(data.profiles) ? data.profiles : []);
      setProfilesStatus('idle');
    } catch (err) {
      setProfilesStatus('error');
    }
  }, [apiBase]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setApiStatus('checking');
    fetch(`${apiBase}/docs`, { signal: controller.signal })
      .then((res) => {
        if (!cancelled) setApiStatus(res.ok ? 'online' : 'offline');
      })
      .catch(() => {
        if (!cancelled) setApiStatus('offline');
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiBase]);

  const currentProfileInfo = profiles.find((item) => item.name === profile.name);
  const hasTrainedProfile = Boolean(currentProfileInfo?.has_profile);
  const hasData = Boolean(currentProfileInfo?.has_data);

  const canProceedTo = (step: number) => {
    if (step === 1) return true;
    if (step === 2) return Boolean(profile.name);
    if (step === 3) return stepStatuses.preprocess === 'done' || hasData;
    if (step === 4) return stepStatuses.train === 'done' || hasTrainedProfile;
    return false;
  };

  const streamResponseLines = async (response: Response, onLine: (line: string) => void) => {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n');
      while (index !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) onLine(line);
        index = buffer.indexOf('\n');
      }
    }
    if (buffer.trim()) {
      onLine(buffer.trim());
    }
  };

  const handleUpload = async (file: File) => {
    if (!profile.name || !file) return;
    setStepStatuses(prev => ({ ...prev, upload: 'running' }));
    const form = new FormData();
    form.append('profile', profile.name);
    form.append('file', file);
    try {
      const res = await fetch(`${apiBase}/upload`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setProfile(prev => ({
        ...prev,
        lastUploadedFile: file.name,
        fileSize: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
      }));
      setLastUploadedFilename(data.filename);
      setStepStatuses(prev => ({ ...prev, upload: 'done' }));
      setActiveStep(2);
      loadProfiles();
    } catch (err) {
      setStepStatuses(prev => ({ ...prev, upload: 'error' }));
      setPreprocessLogs([createLog(`Upload failed: ${String(err)}`, 'error')]);
    }
  };

  const startPreprocess = async () => {
    if (!profile.name || !lastUploadedFilename) return;
    setStepStatuses(prev => ({ ...prev, preprocess: 'running' }));
    setPreprocessLogs([createLog('Pipeline starting...', 'info')]);
    setPreprocessStats(null);
    const payload = { profile: profile.name, filename: lastUploadedFilename };
    try {
      const res = await fetch(`${apiBase}/preprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      await streamResponseLines(res, line => {
        setPreprocessLogs(prev => [...prev, createLog(line, line.includes('Error') ? 'error' : 'info')]);
        const match = line.match(/Segments: raw=(\d+) merged=(\d+) kept=(\d+)/);
        if (match) {
          const raw = Number(match[1]);
          const merged = Number(match[2]);
          const kept = Number(match[3]);
          setPreprocessStats({
            duration: '—',
            segmentsKept: kept,
            segmentsFiltered: merged - kept,
            avgClipLength: '—',
            sampleRate: '24 kHz',
          });
        }
      });
      setStepStatuses(prev => ({ ...prev, preprocess: 'done' }));
      setActiveStep(3);
      loadProfiles();
    } catch (err) {
      setStepStatuses(prev => ({ ...prev, preprocess: 'error' }));
      setPreprocessLogs(prev => [...prev, createLog(`Preprocess failed: ${String(err)}`, 'error')]);
    }
  };

  const startTraining = async () => {
    if (!profile.name) return;
    setStepStatuses(prev => ({ ...prev, train: 'running' }));
    setTrainLogs([createLog('Launching trainer...', 'info')]);
    setTrainStats(null);

    const payload = {
      profile: profile.name,
      batch_size: trainParams.batchSize,
      epochs: trainParams.epochs,
      max_len: trainParams.maxLen,
      auto_select_epoch: trainFlags.autoSelectEpoch,
      auto_tune_profile: trainFlags.autoTuneProfile,
      auto_build_lexicon: trainFlags.autoBuildLexicon,
      select_thorough: trainFlags.selectThorough,
      select_use_wer: trainFlags.selectUseWer,
      early_stop: trainFlags.earlyStop,
    };

    try {
      const res = await fetch(`${apiBase}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      await streamResponseLines(res, line => {
        setTrainLogs(prev => [...prev, createLog(line, line.includes('Error') ? 'error' : 'info')]);
        const epochMatch = line.match(/Epoch \[(\d+)\/(\d+)\], Step \[(\d+)\/(\d+)\]/);
        if (epochMatch) {
          const currentEpoch = Number(epochMatch[1]);
          const totalEpochs = Number(epochMatch[2]);
          const step = Number(epochMatch[3]);
          setTrainStats(prev => ({
            currentEpoch,
            totalEpochs,
            steps: prev?.steps ? prev.steps + step : step,
            eta: `${Math.max(0, totalEpochs - currentEpoch)} epochs`,
            gpuMemory: 'GPU active',
            bestCheckpoint: `outputs/training/${profile.name}`,
          }));
        }
      });
      setStepStatuses(prev => ({ ...prev, train: 'done' }));
      setActiveStep(4);
      loadProfiles();
    } catch (err) {
      setStepStatuses(prev => ({ ...prev, train: 'error' }));
      setTrainLogs(prev => [...prev, createLog(`Training failed: ${String(err)}`, 'error')]);
    }
  };

  const ensureAudioContext = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
  };

  const resetAudio = async () => {
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }
    nextStartTimeRef.current = 0;
  };

  const scheduleBuffer = (buffer: AudioBuffer) => {
    if (!audioContextRef.current) return;
    const ctx = audioContextRef.current;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(ctx.destination);

    const attack = 0.01;
    const release = 0.01;
    const overlap = 0.008;
    const startAt = Math.max(ctx.currentTime + 0.05, nextStartTimeRef.current);
    const safeRelease = Math.min(release, Math.max(0.002, buffer.duration / 4));
    const safeAttack = Math.min(attack, Math.max(0.002, buffer.duration / 4));

    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(1, startAt + safeAttack);
    gain.gain.setValueAtTime(1, Math.max(startAt + safeAttack, startAt + buffer.duration - safeRelease));
    gain.gain.linearRampToValueAtTime(0, startAt + buffer.duration);

    source.start(startAt);
    nextStartTimeRef.current = startAt + buffer.duration - overlap;
  };

  const startInference = useCallback(async () => {
    if (!profile.name || !inferenceText) return;
    await ensureAudioContext();
    setStepStatuses(prev => ({ ...prev, inference: 'running' }));
    setInferenceChunks([]);
    setLatency(null);
    nextStartTimeRef.current = audioContextRef.current?.currentTime || 0;

    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
    }
    const controller = new AbortController();
    streamAbortRef.current = controller;

    const startTime = performance.now();
    let firstChunk = true;

    const payload = {
      speaker: profile.name,
      text: inferenceText,
      model_path: modelOverride || null,
      ref_wav_path: refOverride || null,
    };

    try {
      const res = await fetch(`${apiBase}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(await res.text());
      await streamResponseLines(res, async line => {
        const data = JSON.parse(line);
        if (data.event === 'done') {
          setLatency(prev => prev ? { ...prev, total: data.inference_ms ?? Math.round(performance.now() - startTime) } : null);
          setStepStatuses(prev => ({ ...prev, inference: 'done' }));
          return;
        }
        if (!data.audio_base64) return;
        if (firstChunk) {
          firstChunk = false;
          setLatency({ ttfa: Math.round(performance.now() - startTime), total: 0 });
        }
        const binary = atob(data.audio_base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        const buffer = await audioContextRef.current!.decodeAudioData(bytes.buffer);
        scheduleBuffer(buffer);
        setInferenceChunks(prev => [...prev, { index: data.chunk_index, duration: buffer.duration, receivedAt: Date.now() }]);
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setStepStatuses(prev => ({ ...prev, inference: 'error' }));
      }
    }
  }, [apiBase, inferenceText, modelOverride, profile.name, refOverride]);

  const stopInference = async () => {
    if (streamAbortRef.current) streamAbortRef.current.abort();
    await resetAudio();
    setStepStatuses(prev => ({ ...prev, inference: 'idle' }));
  };

  const trainingCommand = [
    'python src/train.py',
    `--dataset_path ./data/${profile.name || '<profile>'}`,
    `--batch_size ${trainParams.batchSize}`,
    `--epochs ${trainParams.epochs}`,
    `--max_len ${trainParams.maxLen}`,
    trainFlags.autoSelectEpoch ? '--auto_select_epoch' : '',
    trainFlags.selectThorough ? '--select_thorough' : '',
    trainFlags.selectUseWer ? '--select_use_wer' : '',
    trainFlags.autoTuneProfile ? '--auto_tune_profile' : '',
    trainFlags.autoBuildLexicon ? '--auto_build_lexicon' : '',
    trainFlags.earlyStop ? '--early_stop' : '--no_early_stop',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="min-h-screen pb-24 bg-[#FDFCF8]">
      <Header profile={profile} apiBase={apiBase} apiStatus={apiStatus} onApiChange={setApiBase} />

      <div className="max-w-7xl mx-auto px-6 pt-12">
        <div className="flex items-center justify-between relative mb-12">
          <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-100 -translate-y-1/2 -z-10"></div>
          {[1, 2, 3, 4].map((step) => (
            <button
              key={step}
              onClick={() => canProceedTo(step) && setActiveStep(step)}
              disabled={!canProceedTo(step)}
              className={`
                relative flex items-center justify-center w-12 h-12 rounded-full border-2 font-bold transition-all duration-300
                ${activeStep === step ? 'bg-teal-600 text-white border-teal-600 scale-110 shadow-lg shadow-teal-600/20' :
                  canProceedTo(step) ? 'bg-white text-teal-600 border-teal-600 cursor-pointer' : 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'}
              `}
            >
              {step}
              <span className={`absolute -bottom-7 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-widest font-bold whitespace-nowrap
                ${activeStep === step ? 'text-teal-600' : 'text-slate-400'}`}>
                {step === 1 ? 'Profile' : step === 2 ? 'Preprocess' : step === 3 ? 'Training' : 'Generation'}
              </span>
            </button>
          ))}
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          {activeStep === 1 && (
            <StepCard
              stepNumber={1}
              title="Profile & Identity Setup"
              description="Name your voice profile and upload clean audio or video."
              status={stepStatuses.upload}
              isActive={true}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="space-y-4">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Voice Identity Name</label>
                    <input
                      type="text"
                      value={profile.name}
                      onChange={(e) => setProfile(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g. Alvin Studio Master"
                      className="w-full bg-white border border-slate-200 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-teal-600 outline-none transition-all font-semibold"
                    />
                    <p className="text-[10px] text-slate-400 mt-2 italic">Used to organize your models and generated assets.</p>
                  </div>
                  <div className="bg-white border border-slate-100 rounded-xl p-4 text-xs text-slate-500">
                    <p className="uppercase tracking-widest text-[9px] font-bold text-slate-400">Paths</p>
                    <p>Dataset: <span className="font-semibold">data/{profile.name || '<profile>'}</span></p>
                    <p>Outputs: <span className="font-semibold">outputs/training/{profile.name || '<profile>'}</span></p>
                  </div>
                  <div className="bg-white border border-slate-100 rounded-xl p-4 text-xs text-slate-500 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="uppercase tracking-widest text-[9px] font-bold text-slate-400">Existing Profiles</p>
                      <button
                        onClick={loadProfiles}
                        className="text-[10px] font-bold text-teal-600"
                        type="button"
                      >
                        Refresh
                      </button>
                    </div>
                    {profilesStatus === 'loading' && <p>Loading profiles...</p>}
                    {profilesStatus === 'error' && <p className="text-rose-500">Failed to load profiles.</p>}
                    {profilesStatus === 'idle' && profiles.length === 0 && (
                      <p className="italic text-slate-400">No profiles found yet.</p>
                    )}
                    {profilesStatus === 'idle' && profiles.length > 0 && (
                      <div className="space-y-2 max-h-40 overflow-auto pr-1">
                        {profiles.map((item) => (
                          <button
                            key={item.name}
                            type="button"
                            onClick={() => {
                              setProfile(prev => ({ ...prev, name: item.name }));
                              setLastUploadedFilename(null);
                              setActiveStep(item.has_profile ? 4 : 2);
                            }}
                            className={`w-full flex items-center justify-between border rounded-lg px-3 py-2 text-left ${
                              profile.name === item.name
                                ? 'border-teal-600 bg-teal-50 text-teal-800'
                                : 'border-slate-200 bg-white text-slate-600'
                            }`}
                          >
                            <div>
                              <p className="text-xs font-bold">{item.name}</p>
                              <p className="text-[10px] text-slate-400">
                                {item.processed_wavs} clips · {item.raw_files} raw
                              </p>
                            </div>
                            <div className="text-[10px] font-bold">
                              {item.has_profile ? 'ready' : 'needs training'}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="relative group">
                    <input
                      type="file"
                      accept="audio/*,video/*"
                      onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
                      disabled={!profile.name}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
                    />
                    <div className={`border-2 border-dashed rounded-xl p-10 text-center transition-all ${!profile.name ? 'opacity-50 bg-slate-100 border-slate-200' : 'group-hover:border-teal-600 bg-white border-slate-200'}`}>
                      <svg className={`w-10 h-10 mx-auto mb-3 transition-colors ${!profile.name ? 'text-slate-300' : 'text-slate-400 group-hover:text-teal-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      <p className="text-sm font-bold text-slate-700">{profile.name ? 'Select High-Quality Audio/Video' : 'Enter Profile Name First'}</p>
                      <p className="text-xs text-slate-400 mt-1">Lossless formats preferred (.wav, .flac)</p>
                    </div>
                  </div>
                  {profile.lastUploadedFile && (
                    <div className="bg-teal-50 border border-teal-100 p-3 rounded-lg flex items-center justify-between">
                      <span className="text-xs font-bold text-teal-800 truncate">{profile.lastUploadedFile}</span>
                      <span className="text-[10px] font-bold text-teal-600 bg-white px-2 py-1 rounded shadow-sm">{profile.fileSize}</span>
                    </div>
                  )}
                </div>
              </div>
            </StepCard>
          )}

          {activeStep === 2 && (
            <StepCard
              stepNumber={2}
              title="Data Analysis & Preprocessing"
              description="Segmenting audio, removing silence, and transcribing with Whisper."
              status={stepStatuses.preprocess}
              isActive={true}
            >
              <div className="space-y-6">
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-xs text-slate-600">
                  <p className="uppercase tracking-widest text-[9px] font-bold text-slate-400">Input</p>
                  <p>Profile: <span className="font-semibold">{profile.name || '—'}</span></p>
                  <p>File: <span className="font-semibold">{profile.lastUploadedFile || 'Upload a file first'}</span></p>
                </div>
                {preprocessStats ? (
                  <div className="grid grid-cols-4 gap-4 animate-in fade-in zoom-in-95">
                    {[
                      { l: 'Raw Duration', v: preprocessStats.duration },
                      { l: 'Kept Segs', v: preprocessStats.segmentsKept },
                      { l: 'Filtered', v: preprocessStats.segmentsFiltered },
                      { l: 'Sample Rate', v: preprocessStats.sampleRate },
                    ].map((s, i) => (
                      <div key={i} className="bg-teal-600 text-white p-4 rounded-xl shadow-lg shadow-teal-600/10">
                        <p className="text-[9px] font-bold opacity-70 uppercase tracking-widest">{s.l}</p>
                        <p className="text-lg font-bold">{s.v}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <button
                    onClick={startPreprocess}
                    disabled={stepStatuses.preprocess === 'running' || !profile.name || !lastUploadedFilename}
                    className="w-full py-4 bg-teal-600 text-white font-bold rounded-xl hover:bg-teal-700 transition-all flex items-center justify-center gap-3 shadow-xl shadow-teal-600/20"
                  >
                    {stepStatuses.preprocess === 'running' ? 'Processing Pipeline...' : 'Commence Preprocessing'}
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
                  </button>
                )}
                <LogPanel logs={preprocessLogs} />
              </div>
            </StepCard>
          )}

          {activeStep === 3 && (
            <StepCard
              stepNumber={3}
              title="Voice Model Training"
              description="Fine-tune StyleTTS2 with your settings and flags."
              status={stepStatuses.train}
              isActive={true}
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-1 bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-6">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Training Hyperparams</p>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-600">Batch Size</span>
                        <input
                          type="number"
                          min={1}
                          value={trainParams.batchSize}
                          onChange={(e) => setTrainParams(prev => ({ ...prev, batchSize: Number(e.target.value) }))}
                          className="text-xs font-mono font-bold bg-white px-2 py-1 rounded w-20 text-right"
                        />
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-600">Epochs</span>
                        <input
                          type="number"
                          min={1}
                          value={trainParams.epochs}
                          onChange={(e) => setTrainParams(prev => ({ ...prev, epochs: Number(e.target.value) }))}
                          className="text-xs font-mono font-bold bg-white px-2 py-1 rounded w-20 text-right"
                        />
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-600">Max Len</span>
                        <input
                          type="number"
                          min={1}
                          value={trainParams.maxLen}
                          onChange={(e) => setTrainParams(prev => ({ ...prev, maxLen: Number(e.target.value) }))}
                          className="text-xs font-mono font-bold bg-white px-2 py-1 rounded w-20 text-right"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs font-semibold text-slate-600">
                    {[
                      ['Auto-select epoch', 'autoSelectEpoch'],
                      ['Auto-tune profile', 'autoTuneProfile'],
                      ['Build lexicon', 'autoBuildLexicon'],
                      ['Thorough selection', 'selectThorough'],
                      ['WER scoring', 'selectUseWer'],
                      ['Early stop', 'earlyStop'],
                    ].map(([label, key]) => (
                      <label key={key} className="flex items-center justify-between">
                        <span>{label}</span>
                        <input
                          type="checkbox"
                          checked={(trainFlags as any)[key]}
                          onChange={(e) => setTrainFlags(prev => ({ ...prev, [key]: e.target.checked }))}
                          className="accent-teal-600"
                        />
                      </label>
                    ))}
                  </div>

                  <button
                    onClick={startTraining}
                    disabled={stepStatuses.train === 'running'}
                    className="w-full py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-black transition-all shadow-lg"
                  >
                    {stepStatuses.train === 'running' ? 'Training...' : 'Launch Trainer'}
                  </button>
                  <div className="text-[10px] font-mono bg-white border border-slate-200 rounded-lg p-3 text-slate-500">
                    {trainingCommand}
                  </div>
                </div>

                <div className="md:col-span-2 space-y-4">
                  {trainStats ? (
                    <div className="bg-amber-50 border-2 border-amber-200 p-6 rounded-2xl space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-[10px] font-bold text-amber-700 uppercase">Training Progress</p>
                          <p className="text-3xl font-bold text-slate-900">{((trainStats.currentEpoch / trainStats.totalEpochs) * 100).toFixed(0)}%</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-bold text-amber-700 uppercase">Time Remaining</p>
                          <p className="text-lg font-bold text-slate-800">{trainStats.eta}</p>
                        </div>
                      </div>
                      <div className="h-4 bg-amber-200 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-600 transition-all duration-700" style={{ width: `${(trainStats.currentEpoch / trainStats.totalEpochs) * 100}%` }}></div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-xs font-bold">
                        <div className="bg-white p-2 rounded border border-amber-100">GPU: {trainStats.gpuMemory}</div>
                        <div className="bg-white p-2 rounded border border-amber-100">Steps: {trainStats.steps.toLocaleString()}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-400">
                      <svg className="w-12 h-12 mb-2 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" /></svg>
                      <p className="text-sm font-bold">Waiting to start session</p>
                    </div>
                  )}
                  <LogPanel logs={trainLogs} title="StyleTTS2 Local Worker Output" />
                </div>
              </div>
            </StepCard>
          )}

          {activeStep === 4 && (
            <StepCard
              stepNumber={4}
              title="Real-time Voice Generation"
              description="Stream audio as soon as the first chunk is ready."
              status={stepStatuses.inference}
              isActive={true}
            >
              <div className="space-y-6">
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-xs text-slate-600">
                  <p className="uppercase tracking-widest text-[9px] font-bold text-slate-400">Defaults</p>
                  <p>Profile: <span className="font-semibold">{profile.name || '—'}</span></p>
                  <p>Model/Ref: <span className="font-semibold">profile.json unless overridden</span></p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    value={modelOverride}
                    onChange={(e) => setModelOverride(e.target.value)}
                    placeholder="Model path override (optional)"
                    className="w-full bg-white border-2 border-slate-100 rounded-xl px-4 py-3 text-sm"
                  />
                  <input
                    value={refOverride}
                    onChange={(e) => setRefOverride(e.target.value)}
                    placeholder="Reference wav override (optional)"
                    className="w-full bg-white border-2 border-slate-100 rounded-xl px-4 py-3 text-sm"
                  />
                </div>
                <div className="relative">
                  <textarea
                    value={inferenceText}
                    onChange={(e) => setInferenceText(e.target.value)}
                    placeholder="Describe something amazing in your new cloned voice..."
                    className="w-full h-40 bg-white border-2 border-slate-100 rounded-2xl p-6 text-lg focus:ring-4 focus:ring-teal-600/10 focus:border-teal-600 outline-none transition-all font-medium resize-none shadow-sm"
                  />
                  <div className="absolute bottom-4 right-4 flex items-center gap-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{inferenceText.length} Characters</span>
                    <button
                      onClick={startInference}
                      disabled={!inferenceText || stepStatuses.inference === 'running'}
                      className="bg-teal-600 hover:bg-teal-700 disabled:bg-slate-200 text-white font-bold px-6 py-2.5 rounded-xl transition-all shadow-lg shadow-teal-600/20 flex items-center gap-2"
                    >
                      {stepStatuses.inference === 'running' ? 'Streaming...' : 'Stream Voice'}
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"></path></svg>
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={stopInference}
                    className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg"
                  >
                    Stop
                  </button>
                </div>

                {latency && (
                  <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-4">
                    <div className="bg-slate-900 p-6 rounded-2xl flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Time to First Audio</p>
                        <p className="text-2xl font-bold text-teal-400">{latency.ttfa}ms</p>
                      </div>
                    </div>
                    <div className="bg-slate-900 p-6 rounded-2xl flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Inference Chunks</p>
                        <p className="text-2xl font-bold text-slate-200">{inferenceChunks.length}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Low-Latency Audio Queue</p>
                    <span className="text-[10px] font-bold text-teal-600 bg-teal-50 px-2 py-1 rounded">Buffered Playback</span>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    {inferenceChunks.length === 0 ? (
                      <div className="w-full h-12 flex items-center justify-center border border-dashed border-slate-200 rounded-lg text-[11px] text-slate-400 font-bold italic">
                        Stream pending...
                      </div>
                    ) : (
                      inferenceChunks.map(c => (
                        <div key={c.index} className="flex-shrink-0 w-24 bg-white border border-slate-200 p-2 rounded-lg flex flex-col animate-in scale-in">
                          <span className="text-[9px] font-bold text-slate-400">CHUNK {c.index + 1}</span>
                          <span className="text-xs font-bold text-teal-600">{c.duration.toFixed(2)}s</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </StepCard>
          )}
        </div>
      </div>

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex gap-4">
        {activeStep > 1 && (
          <button
            onClick={() => setActiveStep(prev => prev - 1)}
            className="bg-white border-2 border-slate-100 text-slate-600 font-bold px-6 py-3 rounded-2xl shadow-xl hover:bg-slate-50 transition-all flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7" /></svg>
            Previous
          </button>
        )}
        {canProceedTo(activeStep + 1) && activeStep < 4 && (
          <button
            onClick={() => setActiveStep(prev => prev + 1)}
            className="bg-teal-600 text-white font-bold px-8 py-3 rounded-2xl shadow-xl shadow-teal-600/20 hover:bg-teal-700 transition-all flex items-center gap-2 animate-bounce-short"
          >
            Next Stage
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7" /></svg>
          </button>
        )}
      </div>
    </div>
  );
};

export default App;
