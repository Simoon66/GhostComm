
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import { 
  Shield, Download, Box, Loader2, Zap, CheckCircle, Copy, Eye, AlertCircle, 
  Volume2, Music, X, Terminal, Settings, Trash2, Play, Pause, Activity,
  Video, Film, Monitor, Share2, ClipboardPaste, Info, AlertTriangle,
  Cpu, Hash, Layers, AudioLines, Fingerprint, Lock, Unlock, Database,
  Sparkles, Mic, StopCircle, RefreshCcw, FileUp, Globe
} from 'lucide-react';

const html = htm.bind(React.createElement);

// --- PROTOCOL CONSTANTS ---
const START_CHAR = 0x4E00; 
const ALPHABET_SIZE = 32768;
const MediaType = { IMAGE: 'I', AUDIO: 'A', VIDEO: 'V' };

// --- CORE UTILITIES ---
const calculateChecksum = (data) => {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36).substring(0, 4).toUpperCase();
};

const encodeBase32768 = (data) => {
  let encoded = "";
  let buffer = 0;
  let bitsInBuffer = 0;
  const lengthHeader = new Uint8Array(4);
  const view = new DataView(lengthHeader.buffer);
  view.setUint32(0, data.length);
  const combined = new Uint8Array(4 + data.length);
  combined.set(lengthHeader);
  combined.set(data, 4);
  
  for (let i = 0; i < combined.length; i++) {
    buffer = (buffer << 8) | combined[i];
    bitsInBuffer += 8;
    while (bitsInBuffer >= 15) {
      bitsInBuffer -= 15;
      const index = (buffer >> bitsInBuffer) & 0x7FFF;
      encoded += String.fromCharCode(START_CHAR + index);
    }
  }
  if (bitsInBuffer > 0) {
    const index = (buffer << (15 - bitsInBuffer)) & 0x7FFF;
    encoded += String.fromCharCode(START_CHAR + index);
  }
  return encoded;
};

const decodeBase32768 = (str) => {
  const indices = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= START_CHAR && code < START_CHAR + ALPHABET_SIZE) {
      indices.push(code - START_CHAR);
    }
  }
  const out = [];
  let buffer = 0;
  let bitsInBuffer = 0;
  for (const index of indices) {
    buffer = (buffer << 15) | index;
    bitsInBuffer += 15;
    while (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      out.push((buffer >> bitsInBuffer) & 0xFF);
    }
  }
  const fullData = new Uint8Array(out);
  if (fullData.length < 4) return new Uint8Array(0);
  const view = new DataView(fullData.buffer);
  const originalLength = view.getUint32(0);
  return fullData.slice(4, 4 + originalLength);
};

const compressBytes = async (data) => {
  const stream = new ReadableStream({ start(c) { c.enqueue(data); c.close(); } }).pipeThrough(new CompressionStream('deflate'));
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
};

const decompressBytes = async (data) => {
  const stream = new ReadableStream({ start(c) { c.enqueue(data); c.close(); } }).pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
};

const createWavFile = (int16Data, sampleRate) => {
  const buffer = new ArrayBuffer(44 + int16Data.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 32 + int16Data.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, int16Data.length * 2, true);
  for (let i = 0; i < int16Data.length; i++) view.setInt16(44 + i * 2, int16Data[i], true);
  return new Blob([buffer], { type: 'audio/wav' });
};

// --- MEDIA ENGINES ---
const processImage = async (file) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(480 / img.width, 1);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async b => resolve(new Uint8Array(await b.arrayBuffer())), 'image/webp', 0.25);
    };
    img.src = URL.createObjectURL(file);
  });
};

const transcodeVideo = async (file, onProgress) => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const sourceUrl = URL.createObjectURL(file);
    video.src = sourceUrl;
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      const canvas = document.createElement('canvas');
      const targetWidth = 160;
      const scale = targetWidth / video.videoWidth;
      canvas.width = targetWidth;
      canvas.height = video.videoHeight * scale;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(10); 
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 40000 });
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        resolve(new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()));
        URL.revokeObjectURL(sourceUrl);
      };
      video.onended = () => recorder.stop();
      video.play();
      recorder.start();
      const processFrame = () => {
        if (video.ended || video.paused) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (onProgress) onProgress((video.currentTime / video.duration) * 100);
        requestAnimationFrame(processFrame);
      };
      processFrame();
    };
    video.onerror = reject;
  });
};

const fastTranscodeAudio = async (file) => {
  const audioCtx = new AudioContext();
  const arrayBuffer = await file.arrayBuffer();
  const decoded = await audioCtx.decodeAudioData(arrayBuffer);
  const offlineCtx = new OfflineAudioContext(1, decoded.duration * 8000, 8000);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();
  const f32 = rendered.getChannelData(0);
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-1, Math.min(1, f32[i])) * 32767;
  return new Uint8Array(i16.buffer);
};

// --- COMPONENTS ---

const WaveformVisualizer = ({ isActive }) => {
  const [bars, setBars] = useState(new Array(16).fill(5));
  
  useEffect(() => {
    if (!isActive) {
      setBars(new Array(16).fill(5));
      return;
    }
    const interval = setInterval(() => {
      setBars(prev => prev.map(() => Math.floor(Math.random() * 40) + 10));
    }, 100);
    return () => clearInterval(interval);
  }, [isActive]);

  return html`
    <div className="flex items-end justify-center gap-1.5 h-16 w-full">
      ${bars.map((h, i) => html`
        <div 
          key=${i} 
          className="w-1.5 bg-emerald-500 rounded-full transition-all duration-100 ease-out shadow-[0_0_10px_rgba(16,185,129,0.5)]"
          style=${{ height: `${h}%`, opacity: isActive ? 1 : 0.2 }}
        />
      `)}
    </div>
  `;
};

const EncodingView = ({ persistentResult, setPersistentResult, persistentFile, setPersistentFile }) => {
  const [file, setFile] = useState(persistentFile);
  const [isRecording, setIsRecording] = useState(false);
  const [state, setState] = useState({ isProcessing: false, progress: 0, result: persistentResult, error: null });
  const [isCopied, setIsCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => setPersistentFile(file), [file]);
  useEffect(() => setPersistentResult(state.result), [state.result]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setFile(new File([blob], "recording.webm", { type: 'audio/webm' }));
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start();
      setIsRecording(true);
    } catch (e) {
      setState(s => ({ ...s, error: "Microphone Access Denied" }));
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
    setIsRecording(false);
  };

  const handleProcess = async () => {
    if (!file) return;
    setState(s => ({ ...s, isProcessing: true, progress: 1, error: null }));
    try {
      let type = MediaType.IMAGE;
      if (file.type.startsWith('audio/')) type = MediaType.AUDIO;
      else if (file.type.startsWith('video/')) type = MediaType.VIDEO;

      let raw;
      if (type === MediaType.VIDEO) {
        raw = await transcodeVideo(file, (p) => setState(s => ({ ...s, progress: p * 0.7 })));
      } else if (type === MediaType.AUDIO) {
        raw = await fastTranscodeAudio(file);
        setState(s => ({ ...s, progress: 50 }));
      } else {
        raw = await processImage(file);
        setState(s => ({ ...s, progress: 50 }));
      }

      const compressed = await compressBytes(raw);
      setState(s => ({ ...s, progress: 85 }));
      const encoded = encodeBase32768(compressed);
      setState(s => ({ ...s, progress: 100 }));
      
      const volume = `GC:${type}:1:0:${calculateChecksum(encoded)}:${encoded}`;
      setTimeout(() => setState(s => ({ ...s, isProcessing: false, result: [volume] })), 800);
    } catch (e) {
      setState({ isProcessing: false, progress: 0, result: null, error: "Transcode Failure: Incompatible Bitstream" });
    }
  };

  return html`
    <div className="space-y-8 animate-slide-up">
      <div className="glass rounded-[3.5rem] p-10 text-center shadow-emerald relative overflow-hidden flex flex-col items-center justify-center min-h-[500px]">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
        
        ${!file && !isRecording ? html`
          <div className="py-20 space-y-16 w-full animate-fade-in">
            <div className="w-36 h-36 bg-zinc-900/80 rounded-[3.5rem] flex items-center justify-center mx-auto border border-white/[0.05] shadow-2xl relative group tap-scale">
              <div className="absolute inset-0 bg-emerald-500/10 blur-[60px] rounded-full animate-pulse-slow" />
              <${Database} className="text-zinc-600 group-hover:text-emerald-500 transition-all duration-700" size={56} />
            </div>
            
            <div className="flex flex-col gap-6 px-4">
              <button onClick=${() => fileInputRef.current.click()} className="btn-emerald flex items-center justify-center gap-4">
                <${FileUp} size=${22} /> BROWSE ASSET
              </button>
              <button onClick=${startRecording} className="btn-outline flex items-center justify-center gap-4 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/5">
                <${Mic} size=${22} /> AUDIO CAPTURE
              </button>
            </div>
            
            <input type="file" ref=${fileInputRef} className="hidden" accept="audio/*,image/*,video/*" onChange=${e => setFile(e.target.files[0])} />
          </div>
        ` : isRecording ? html`
          <div className="py-20 space-y-12 w-full animate-fade-in text-center flex flex-col items-center">
             <div className="text-xl font-black text-emerald-500 tracking-[0.5em] uppercase mb-4 animate-pulse">Recording</div>
             <${WaveformVisualizer} isActive=${true} />
             <button onClick=${stopRecording} className="w-24 h-24 bg-red-600/10 border border-red-500/20 rounded-full flex items-center justify-center shadow-red-glow tap-scale transition-all">
                <${StopCircle} size=${40} className="text-red-500" />
             </button>
             <p className="text-[10px] font-black uppercase tracking-[0.6em] text-zinc-600">Awaiting Signal End</p>
          </div>
        ` : !state.result ? html`
          <div className="space-y-12 w-full animate-slide-up px-2">
            <div className="aspect-square w-full max-w-[320px] bg-black/50 rounded-[3.5rem] overflow-hidden border border-white/[0.05] flex items-center justify-center shadow-inner relative group mx-auto">
              ${state.isProcessing ? html`
                <div className="flex flex-col items-center gap-8">
                   <div className="relative w-32 h-32 flex items-center justify-center">
                     <div className="absolute inset-0 border-4 border-emerald-500/10 rounded-full" />
                     <div className="absolute inset-0 border-4 border-emerald-500 rounded-full border-t-transparent animate-spin" />
                     <div className="text-2xl font-black text-white">${Math.round(state.progress)}%</div>
                   </div>
                   <div className="text-[10px] font-black uppercase tracking-[0.6em] text-emerald-500 animate-pulse">Ghost Syncing</div>
                </div>
              ` : 
                file.type.startsWith('image/') ? 
                  html`<img src=${URL.createObjectURL(file)} className="w-full h-full object-contain p-8 animate-float" />` :
                file.type.startsWith('video/') ?
                  html`<video src=${URL.createObjectURL(file)} className="w-full h-full object-contain" muted />` :
                  html`<div className="flex flex-col items-center gap-6"><div className="p-16 bg-emerald-500/5 rounded-full shadow-2xl"><${Music} size=${72} className="text-emerald-500" /></div><p className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">${file.name}</p></div>`
              }
            </div>
            <div className="flex flex-col gap-6 px-6">
              <button onClick=${handleProcess} disabled=${state.isProcessing} className="btn-emerald">
                ${state.isProcessing ? "TRANSCODING..." : "COMMIT TO TEXT"}
              </button>
              <button onClick=${() => setFile(null)} className="text-[11px] font-black uppercase tracking-[0.6em] text-zinc-700 hover:text-white transition-all py-3">ABORT CIRCUIT</button>
            </div>
          </div>
        ` : html`
          <div className="space-y-10 w-full animate-slide-up px-2">
            <div className="bg-zinc-950 border border-emerald-500/10 p-10 rounded-[3.5rem] text-left relative overflow-hidden shadow-ghost-inner">
              <div className="flex items-center gap-6 mb-10">
                <div className="w-16 h-16 bg-emerald-600/10 rounded-[1.5rem] flex items-center justify-center border border-emerald-600/20 shadow-2xl">
                  <${Terminal} size=${30} className="text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-[12px] font-black uppercase tracking-[0.3em] text-white">Encrypted Ghost</h3>
                  <p className="text-[10px] font-black text-emerald-500/50 uppercase tracking-[0.4em] mt-2">${state.result[0].length.toLocaleString()} Segments</p>
                </div>
              </div>
              <div className="bg-black/80 p-10 rounded-[2.5rem] border border-white/[0.05] font-mono text-[13px] text-emerald-400 h-56 overflow-y-auto break-all relative shadow-inner custom-scrollbar leading-relaxed">
                <div className=${`transition-all duration-[1s] ease-out ${!showRaw && 'blur-3xl opacity-5 scale-95 translate-y-6'}`}>
                  ${state.result[0]}
                </div>
                ${!showRaw && html`
                  <div className="absolute inset-0 flex items-center justify-center">
                    <button onClick=${() => setShowRaw(true)} className="px-14 py-6 bg-zinc-900/95 backdrop-blur-3xl rounded-full text-[11px] font-black uppercase tracking-[0.7em] border border-emerald-500/20 shadow-terminal-unlock tap-scale">DECRYPT STREAM</button>
                  </div>
                `}
              </div>
            </div>
            <div className="flex gap-4 px-4">
              <button onClick=${() => { navigator.clipboard.writeText(state.result[0]); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }} 
                className=${`flex-1 py-8 rounded-[2.8rem] font-black text-xs uppercase tracking-[0.4em] tap-scale transition-all shadow-2xl border-b-4 ${isCopied ? 'bg-green-600 border-green-900 text-white' : 'bg-white text-black border-zinc-300'}`}>
                ${isCopied ? "BUFFER CACHED" : "COPY PACKET"}
              </button>
              <button onClick=${() => setShowRaw(!showRaw)} className="p-8 bg-zinc-900 rounded-[2.8rem] text-zinc-500 border border-white/[0.05] tap-scale hover:text-white transition-all"><${showRaw ? X : Eye} size=${32} /></button>
            </div>
            <button onClick=${() => {setFile(null); setState({result:null}); setShowRaw(false);}} className="text-[10px] font-black uppercase text-zinc-800 tracking-[0.8em] py-4 hover:text-white transition-all">WIPE & REBOOT</button>
          </div>
        `}
        ${state.error && html`<div className="mt-8 p-6 bg-red-950/20 border border-red-900/50 rounded-[2.5rem] text-red-500 text-[12px] font-black uppercase tracking-widest animate-bounce flex items-center justify-center gap-4"><${AlertCircle} size=${24}/> ${state.error}</div>`}
      </div>
    </div>
  `;
};

const DecodingView = ({ persistentMedia, setPersistentMedia }) => {
  const [input, setInput] = useState("");
  const [error, setError] = useState(null);

  const handleDecode = async (text) => {
    try {
      const segments = text.split("GC:").filter(s => s.trim());
      if (!segments.length) return;
      const parts = segments[0].split(":");
      const type = parts[0];
      const encoded = parts[parts.length - 1];
      const compressed = decodeBase32768(encoded);
      const raw = await decompressBytes(compressed);
      let url;
      if (type === MediaType.AUDIO) {
        url = URL.createObjectURL(createWavFile(new Int16Array(raw.buffer), 8000));
      } else if (type === MediaType.VIDEO) {
        url = URL.createObjectURL(new Blob([raw], { type: 'video/webm' }));
      } else {
        url = URL.createObjectURL(new Blob([raw], { type: 'image/webp' }));
      }
      setPersistentMedia({ type, url });
      setError(null);
    } catch (e) { setError("Handshake Integrity Breach"); }
  };

  return html`
    <div className="glass rounded-[3.5rem] p-10 animate-fade-in shadow-emerald min-h-[500px] flex flex-col justify-center relative border border-white/[0.08]">
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-emerald-600/5 blur-[200px] rounded-full pointer-events-none" />
      ${!persistentMedia ? html`
        <div className="space-y-16 text-center w-full animate-slide-up px-4">
          <div className="space-y-6">
            <h2 className="text-xl font-black uppercase tracking-[0.9em] text-white">Receive</h2>
            <p className="text-[11px] font-black uppercase tracking-[0.6em] opacity-30">Monitoring Transmission</p>
          </div>
          <div className="relative group">
            <textarea value=${input} onChange=${e => { setInput(e.target.value); handleDecode(e.target.value); }} 
              placeholder="PASTE CIPHER..." 
              className="w-full h-72 bg-black/60 border border-white/[0.05] rounded-[3.5rem] p-12 font-mono text-[14px] text-emerald-400 focus:border-emerald-500/30 outline-none transition-all shadow-inner leading-relaxed resize-none custom-scrollbar" />
            <button onClick=${async () => { const t = await navigator.clipboard.readText(); setInput(t); handleDecode(t); }} 
              className="absolute bottom-10 right-10 p-6 bg-zinc-900 rounded-[2rem] text-zinc-400 border border-white/10 tap-scale shadow-2xl hover:bg-zinc-800 transition-all">
               <${ClipboardPaste} size=${28} />
            </button>
          </div>
          <button onClick=${() => setInput("")} className="text-[11px] font-black uppercase opacity-20 hover:opacity-100 transition-opacity tracking-[0.8em] py-4">CLEAR BUFFER</button>
        </div>
      ` : html`
        <div className="space-y-16 text-center animate-slide-up w-full px-6">
          <div className="aspect-square bg-black/70 rounded-[4rem] overflow-hidden border border-white/[0.08] flex items-center justify-center shadow-ghost-inner relative p-12 group">
             ${persistentMedia.type === 'I' ? html`<img src=${persistentMedia.url} className="w-full h-full object-contain animate-float" />` : 
               persistentMedia.type === 'V' ? html`<video controls src=${persistentMedia.url} className="w-full h-full object-contain" />` :
               html`
                <div className="w-full flex flex-col items-center gap-14">
                  <div className="w-40 h-40 bg-emerald-500/10 rounded-full flex items-center justify-center border border-emerald-500/20 shadow-3xl animate-pulse-slow">
                    <${AudioLines} size=${84} className="text-emerald-500" />
                  </div>
                  <audio controls src=${persistentMedia.url} className="w-full custom-audio" />
                  <p className="text-[12px] font-black text-zinc-600 uppercase tracking-[0.6em]">Signal Intact</p>
                </div>
             `}
          </div>
          <div className="flex flex-col gap-6 px-6">
             <a href=${persistentMedia.url} download=${`GHOST_DECODED_${Date.now()}`}
               className="btn-emerald flex items-center justify-center gap-6">
               <${Download} size=${30} /> RECOVER ASSET
             </a>
             <button onClick=${() => { setPersistentMedia(null); setInput(""); }} className="text-[11px] font-black uppercase tracking-[0.8em] opacity-30 hover:opacity-100 transition-opacity py-4">TERMINATE CIRCUIT</button>
          </div>
        </div>
      `}
      ${error && html`<div className="mt-10 p-8 bg-red-950/20 border border-red-900/50 rounded-[3rem] text-red-500 text-[13px] font-black uppercase tracking-widest text-center animate-bounce flex items-center justify-center gap-6"><${AlertCircle} size=${24} /> ${error}</div>`}
    </div>
  `;
};

const App = () => {
  const [tab, setTab] = useState('encode');
  const [encodedResult, setEncodedResult] = useState(null);
  const [lastFile, setLastFile] = useState(null);
  const [media, setMedia] = useState(null);

  return html`
    <div className="min-h-screen bg-[#020617] text-white flex flex-col font-sans selection:bg-emerald-500/30 antialiased overflow-hidden relative">
      <div className="fixed top-[-10%] left-[-10%] w-[50%] h-[50%] bg-emerald-600/5 blur-[200px] rounded-full pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-600/5 blur-[200px] rounded-full pointer-events-none" />

      <header className="p-12 border-b border-white/[0.05] flex justify-between items-center bg-slate-950/80 backdrop-blur-3xl sticky top-0 z-50 shadow-2xl">
        <div className="flex items-center gap-10">
          <div className="w-22 h-22 bg-emerald-600 rounded-[2.5rem] flex items-center justify-center rotate-6 shadow-emerald-glow border border-white/20 transition-all duration-1000 hover:rotate-[-6deg] hover:scale-110"><${Shield} size=${48} /></div>
          <div>
            <h1 className="text-4xl font-black uppercase tracking-tighter leading-none">Ghost<span className="text-emerald-500">Comm</span></h1>
            <span className="text-[10px] font-black opacity-30 uppercase tracking-[1em] mt-3 block">Titan V4.0 Stable</span>
          </div>
        </div>
        <div className="w-18 h-18 rounded-full bg-slate-900/90 border border-white/[0.1] flex items-center justify-center cursor-pointer tap-scale transition-all hover:bg-slate-800"><${Settings} size=${32} className="text-zinc-600" /></div>
      </header>

      <main className="flex-1 p-12 max-w-2xl mx-auto w-full overflow-y-auto custom-scrollbar relative z-10">
        <div className="flex bg-slate-900/60 p-3 rounded-[3rem] border border-white/[0.08] mb-24 relative overflow-hidden shadow-2xl backdrop-blur-3xl">
          <div className=${`absolute top-3 bottom-3 left-3 w-[calc(50%-12px)] bg-slate-800 rounded-[2.2rem] transition-transform duration-[700ms] cubic-bezier(0.16, 1, 0.3, 1) shadow-2xl border border-white/[0.1] ${tab === 'decode' ? 'translate-x-full' : 'translate-x-0'}`} />
          <button onClick=${() => setTab('encode')} className=${`flex-1 py-7 rounded-[2rem] text-[14px] font-black uppercase tracking-[0.5em] transition-all relative z-10 ${tab === 'encode' ? 'text-white' : 'text-zinc-600'}`}>
            ASSEMBLE
          </button>
          <button onClick=${() => setTab('decode')} className=${`flex-1 py-7 rounded-[2rem] text-[14px] font-black uppercase tracking-[0.5em] transition-all relative z-10 ${tab === 'decode' ? 'text-white' : 'text-zinc-600'}`}>
            RECEIVE
          </button>
        </div>

        <div className="transition-all duration-1000 transform">
          ${tab === 'encode' ? html`<${EncodingView} persistentResult=${encodedResult} setPersistentResult=${setEncodedResult} persistentFile=${lastFile} setPersistentFile=${setLastFile} />` : 
          html`<${DecodingView} persistentMedia=${media} setPersistentMedia=${setMedia} />`}
        </div>
      </main>

      <footer className="p-16 border-t border-white/[0.05] text-center flex flex-col gap-8 bg-slate-950/80">
        <div className="flex items-center justify-center gap-16 mb-2 opacity-[0.08]">
          <${Layers} size=${28} />
          <${Globe} size=${28} />
          <${Fingerprint} size=${28} />
          <${Cpu} size=${28} />
        </div>
        <span className="text-[11px] font-black uppercase tracking-[1.2em] opacity-20">SECURE TITAN CLUSTER • GHOST PROTOCOL v4.0</span>
        <span className="text-[9px] font-black uppercase tracking-[0.9em] opacity-10">Optimized for Satellite Uplinks</span>
      </footer>

      <style>
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@700&family=Outfit:wght@400;900&display=swap');
        body { font-family: 'Outfit', sans-serif; background-color: #020617; }
        .custom-scrollbar::-webkit-scrollbar { width: 0; }
        * { -webkit-tap-highlight-color: transparent; outline: none; box-sizing: border-box; }
        .glass {
          background: rgba(15, 23, 42, 0.85);
          backdrop-filter: blur(80px) saturate(220%);
          border: 1px solid rgba(255, 255, 255, 0.12);
        }
        .shadow-emerald { shadow: 0 80px 180px -40px rgba(0,0,0,1), 0 0 80px rgba(16,185,129,0.05); }
        .shadow-ghost-inner { box-shadow: inset 0 2px 40px rgba(0,0,0,1), 0 1px 1px rgba(255,255,255,0.05); }
        .shadow-emerald-glow { box-shadow: 0 40px 100px rgba(16,185,129,0.5), 0 0 20px rgba(16,185,129,0.3); }
        .shadow-red-glow { box-shadow: 0 20px 60px rgba(239,68,68,0.4), 0 0 15px rgba(239,68,68,0.2); }
        
        .btn-emerald {
          width: 100%;
          padding: 2.2rem;
          background: linear-gradient(135deg, #10b981, #059669);
          border-radius: 3rem;
          font-weight: 900;
          font-size: 14px;
          letter-spacing: 0.5em;
          text-transform: uppercase;
          color: white;
          box-shadow: 0 30px 80px rgba(16,185,129,0.4), inset 0 1px 2px rgba(255,255,255,0.3);
          border-bottom: 5px solid #064e3b;
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .btn-emerald:active { transform: translateY(3px); border-bottom-width: 0; box-shadow: 0 15px 40px rgba(16,185,129,0.4); }
        
        .btn-outline {
          width: 100%;
          padding: 1.8rem;
          border-radius: 3rem;
          font-weight: 900;
          font-size: 13px;
          letter-spacing: 0.4em;
          text-transform: uppercase;
          border: 2px solid currentColor;
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .shadow-terminal-unlock { box-shadow: 0 50px 120px rgba(0,0,0,1), 0 0 30px rgba(16,185,129,0.15); }
        
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        .animate-fade-in { animation: fade-in 1.5s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes slide-up { from { transform: translateY(80px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .animate-slide-up { animation: slide-up 1.2s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes float { 0% { transform: translateY(0) scale(1); } 50% { transform: translateY(-25px) scale(1.05); } 100% { transform: translateY(0) scale(1); } }
        .animate-float { animation: float 8s infinite ease-in-out; }
        @keyframes pulseSlow { 0% { opacity: 0.6; transform: scale(1); } 50% { opacity: 1; transform: scale(1.03); } 100% { opacity: 0.6; transform: scale(1); } }
        .animate-pulse-slow { animation: pulseSlow 7s infinite ease-in-out; }
        .tap-scale { transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .tap-scale:active { transform: scale(0.9); }
        .custom-audio::-webkit-media-controls-panel { background: rgba(255,255,255,0.05); border-radius: 3rem; padding: 1.5rem; }
        .custom-audio::-webkit-media-controls-play-button { filter: invert(0.8) hue-rotate(90deg) brightness(2); }
      </style>
    </div>
  `;
};

const root = createRoot(document.getElementById('root'));
root.render(html`<${App} />`);
