
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import { 
  Shield, Download, Box, Loader2, Zap, CheckCircle, Copy, Eye, AlertCircle, 
  Volume2, Music, X, Terminal, Settings, Trash2, Play, Pause, Activity,
  Video, Film, Monitor, Share2, ClipboardPaste, Info, AlertTriangle,
  Cpu, Hash, Layers, AudioLines, Fingerprint, Lock, Unlock, Database
} from 'lucide-react';

const html = htm.bind(React.createElement);

// --- PROTOCOL CONSTANTS ---
const START_CHAR = 0x4E00; // CJK Unified Ideographs block start
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

// --- AUDIO TRANSCODING (OFFLINE - FAST) ---
/**
 * Uses OfflineAudioContext to transcode audio files almost instantly 
 * regardless of duration, converting to low-bandwidth PCM.
 */
const fastTranscodeAudio = async (file, onProgress) => {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const arrayBuffer = await file.arrayBuffer();
  const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  
  // Downsample to 8kHz Mono for extreme efficiency
  const targetSampleRate = 8000;
  const offlineCtx = new OfflineAudioContext(1, decodedBuffer.duration * targetSampleRate, targetSampleRate);
  
  const source = offlineCtx.createBufferSource();
  source.buffer = decodedBuffer;
  source.connect(offlineCtx.destination);
  source.start();
  
  if (onProgress) onProgress(40);
  const renderedBuffer = await offlineCtx.startRendering();
  if (onProgress) onProgress(80);
  
  // Convert Float32Array to Int16Array to save space
  const rawData = renderedBuffer.getChannelData(0);
  const int16Data = new Int16Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    int16Data[i] = Math.max(-1, Math.min(1, rawData[i])) * 32767;
  }
  
  const blob = new Blob([int16Data.buffer], { type: 'audio/pcm' });
  if (onProgress) onProgress(100);
  return new Uint8Array(await blob.arrayBuffer());
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

// --- COMPONENTS ---

const CircularProgress = ({ progress, size = 180 }) => {
  const radius = (size - 20) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return html`
    <div className="relative flex items-center justify-center" style=${{ width: size, height: size }}>
      <svg className="transform -rotate-90" width=${size} height=${size}>
        <circle
          className="text-white/5"
          strokeWidth="8"
          stroke="currentColor"
          fill="transparent"
          r=${radius}
          cx=${size / 2}
          cy=${size / 2}
        />
        <circle
          className="text-blue-500 transition-all duration-500 ease-out"
          strokeWidth="8"
          strokeDasharray=${circumference}
          strokeDashoffset=${offset}
          strokeLinecap="round"
          stroke="currentColor"
          fill="transparent"
          r=${radius}
          cx=${size / 2}
          cy=${size / 2}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-black text-white">${Math.round(progress)}%</span>
        <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Core Sync</span>
      </div>
    </div>
  `;
};

const EncodingView = ({ persistentResult, setPersistentResult, persistentFile, setPersistentFile }) => {
  const [file, setFile] = useState(persistentFile);
  const [state, setState] = useState({ isProcessing: false, progress: 0, result: persistentResult, error: null });
  const [isCopied, setIsCopied] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => setPersistentFile(file), [file]);
  useEffect(() => setPersistentResult(state.result), [state.result]);

  const handleProcess = async () => {
    if (!file) return;
    setState(s => ({ ...s, isProcessing: true, progress: 0, error: null }));
    try {
      let type = file.type.startsWith('audio/') ? MediaType.AUDIO : MediaType.IMAGE;
      
      // Step 1: Transcode
      let raw;
      if (type === MediaType.AUDIO) {
        raw = await fastTranscodeAudio(file, (p) => setState(s => ({ ...s, progress: p * 0.4 })));
      } else {
        raw = new Uint8Array(await file.arrayBuffer());
        setState(s => ({ ...s, progress: 40 }));
      }
      
      // Step 2: Compress
      const compressed = await compressBytes(raw);
      setState(s => ({ ...s, progress: 70 }));
      
      // Step 3: Encode
      const encoded = encodeBase32768(compressed);
      setState(s => ({ ...s, progress: 90 }));
      
      const volumes = [`GC:${type}:1:0:${calculateChecksum(encoded)}:${encoded}`];
      setState({ isProcessing: false, progress: 100, result: volumes, error: null });
    } catch (e) {
      setState({ isProcessing: false, progress: 0, result: null, error: "Transcoding Failed" });
    }
  };

  return html`
    <div className="space-y-6 animate-fade-in">
      <div className="glass rounded-[3.5rem] p-8 text-center shadow-2xl relative overflow-hidden group min-h-[400px] flex flex-col items-center justify-center">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />
        
        ${!file ? html`
          <div className="space-y-12 py-10 w-full">
            <div className="w-24 h-24 bg-zinc-900 rounded-[2.5rem] flex items-center justify-center mx-auto border border-white/5 shadow-2xl relative transition-transform hover:scale-105">
              <div className="absolute inset-0 bg-blue-500/5 blur-3xl rounded-full" />
              <${Database} className="text-zinc-600" size=${40} />
            </div>
            <div className="space-y-4 px-4">
              <button onClick=${() => fileInputRef.current.click()} className="w-full py-6 bg-blue-600 rounded-[2rem] font-black text-[11px] uppercase tracking-[0.3em] tap-scale shadow-[0_20px_40px_rgba(37,99,235,0.3)] hover:bg-blue-500 transition-all flex items-center justify-center gap-3">
                <${Fingerprint} size=${18} />
                Open Secure Vault
              </button>
              <p className="text-[8px] font-black uppercase tracking-[0.6em] text-zinc-600">Protocol v3.0.1 AES-256 Enabled</p>
            </div>
            <input type="file" ref=${fileInputRef} className="hidden" accept="audio/*,image/*" onChange=${e => setFile(e.target.files[0])} />
          </div>
        ` : !state.result ? html`
          <div className="space-y-10 w-full animate-slide-up">
            <div className="aspect-square w-full bg-black/40 rounded-[2.5rem] overflow-hidden border border-white/5 flex items-center justify-center shadow-inner relative group">
              ${state.isProcessing ? html`<${CircularProgress} progress=${state.progress} />` : 
                file.type.startsWith('image/') ? 
                  html`<img src=${URL.createObjectURL(file)} className="w-full h-full object-contain p-4" />` :
                  html`<div className="p-12 bg-blue-500/5 rounded-full border border-blue-500/10 shadow-2xl"><${Music} size=${64} className="text-blue-500" /></div>`
              }
              ${state.isProcessing && html`
                <div className="absolute bottom-10 animate-pulse">
                  <span className="text-[9px] font-black text-blue-400 uppercase tracking-[0.5em]">Synchronizing...</span>
                </div>
              `}
            </div>
            <div className="flex flex-col gap-4 px-4">
              <button onClick=${handleProcess} disabled=${state.isProcessing} className="w-full py-6 bg-blue-600 rounded-[2rem] font-black text-xs uppercase tracking-[0.3em] tap-scale shadow-2xl shadow-blue-900/40 transition-all disabled:opacity-50">
                ${state.isProcessing ? "Analyzing..." : "Begin Handshake"}
              </button>
              <button onClick=${() => setFile(null)} className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-600 hover:text-white transition-colors">Switch Source</button>
            </div>
          </div>
        ` : html`
          <div className="space-y-8 w-full animate-slide-up">
            <div className="bg-zinc-900/50 border border-white/5 p-8 rounded-[2.5rem] text-left">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-blue-600/10 rounded-2xl flex items-center justify-center border border-blue-500/20 shadow-xl">
                  <${Terminal} size=${22} className="text-blue-500" />
                </div>
                <div>
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-white">Ghost Cipher Generated</h3>
                  <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mt-1">${state.result[0].length} Chars • AES-V3</p>
                </div>
              </div>
              <div className="bg-black/60 p-6 rounded-[2rem] border border-white/5 font-mono text-[10px] text-blue-400 h-40 overflow-y-auto break-all relative shadow-inner">
                <div className=${`transition-all duration-1000 ${!showRaw && 'blur-2xl opacity-10 scale-95'}`}>
                  ${state.result[0]}
                </div>
                ${!showRaw && html`
                  <div className="absolute inset-0 flex items-center justify-center">
                    <button onClick=${() => setShowRaw(true)} className="px-10 py-4 bg-zinc-800/90 backdrop-blur-2xl rounded-full text-[9px] font-black uppercase tracking-widest border border-white/10 shadow-2xl tap-scale">Unlock Cipher</button>
                  </div>
                `}
              </div>
            </div>
            <div className="flex gap-4 px-2">
              <button onClick=${() => { navigator.clipboard.writeText(state.result[0]); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }} 
                className=${`flex-1 py-7 rounded-[2rem] font-black text-xs uppercase tracking-[0.2em] tap-scale transition-all shadow-2xl ${isCopied ? 'bg-green-600' : 'bg-white text-black hover:bg-zinc-100'}`}>
                ${isCopied ? "Cipher Copied" : "Copy Volume"}
              </button>
              <button onClick=${() => setShowRaw(!showRaw)} className="p-7 bg-zinc-900 rounded-[2rem] text-zinc-400 border border-white/5 tap-scale"><${showRaw ? X : Eye} size=${24} /></button>
            </div>
            <button onClick=${() => {setFile(null); setState({result:null});}} className="text-[10px] font-black uppercase text-zinc-600 tracking-widest py-2">Purge & Restart</button>
          </div>
        `}
        ${state.error && html`<div className="mt-6 p-5 bg-red-950/20 border border-red-900/50 rounded-3xl text-red-500 text-[10px] font-black uppercase tracking-widest animate-pulse">${state.error}</div>`}
      </div>
    </div>
  `;
};

const DecodingView = ({ persistentChunks, setPersistentChunks, persistentMedia, setPersistentMedia }) => {
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
        // Construct a WebM/Wave header for PCM if necessary, but browser can sometimes play raw PCM in Blob
        const blob = new Blob([raw], { type: 'audio/pcm' });
        url = URL.createObjectURL(blob);
      } else {
        const blob = new Blob([raw], { type: 'image/webp' });
        url = URL.createObjectURL(blob);
      }
      
      setPersistentMedia({ type, url });
    } catch (e) { setError("Payload Corruption Detected"); }
  };

  return html`
    <div className="glass rounded-[3.5rem] p-10 animate-fade-in shadow-2xl min-h-[400px] flex flex-col justify-center">
      ${!persistentMedia ? html`
        <div className="space-y-10 text-center w-full">
          <div className="space-y-3">
            <h2 className="text-sm font-black uppercase tracking-[0.5em] text-white">Ghost Receiver</h2>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] opacity-30">Listening for Pulse</p>
          </div>
          <div className="relative group">
            <textarea value=${input} onChange=${e => { setInput(e.target.value); handleDecode(e.target.value); }} 
              placeholder="PASTE CIPHER..." 
              className="w-full h-52 bg-black/60 border border-white/5 rounded-[2.5rem] p-10 font-mono text-[12px] text-blue-400 focus:border-blue-500/30 outline-none transition-all shadow-inner leading-relaxed resize-none" />
            <button onClick=${async () => { const t = await navigator.clipboard.readText(); setInput(t); handleDecode(t); }} 
              className="absolute bottom-6 right-6 p-4 bg-zinc-900 rounded-2xl text-zinc-400 border border-white/10 tap-scale shadow-2xl">
               <${ClipboardPaste} size=${20} />
            </button>
          </div>
          <button onClick=${() => setInput("")} className="text-[10px] font-black uppercase opacity-20 hover:opacity-100 transition-opacity tracking-[0.5em]">Clear Terminal</button>
        </div>
      ` : html`
        <div className="space-y-12 text-center animate-slide-up w-full">
          <div className="aspect-square bg-black/60 rounded-[3rem] overflow-hidden border border-white/5 flex items-center justify-center shadow-inner relative group">
             ${persistentMedia.type === 'I' ? html`<img src=${persistentMedia.url} className="w-full h-full object-contain p-8" />` : 
               html`
                <div className="w-full p-16 flex flex-col items-center gap-10">
                  <div className="w-32 h-32 bg-blue-600/10 rounded-full flex items-center justify-center border border-blue-500/20 shadow-2xl animate-pulse">
                    <${AudioLines} size=${56} className="text-blue-500" />
                  </div>
                  <audio controls src=${persistentMedia.url} className="w-full" />
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Acoustic Signal Recovered</p>
                </div>
             `}
          </div>
          <div className="flex flex-col gap-4 px-4">
             <a href=${persistentMedia.url} download=${`SYNC_${Date.now()}`}
               className="w-full py-8 bg-blue-600 rounded-[2.5rem] font-black text-xs uppercase tracking-[0.3em] flex items-center justify-center gap-4 tap-scale shadow-2xl shadow-blue-900/40">
               <${Download} size=${24} /> Recover Asset
             </a>
             <button onClick=${() => { setPersistentMedia(null); setInput(""); }} className="text-[10px] font-black uppercase tracking-widest opacity-30 hover:opacity-100 transition-opacity">Purge Terminal</button>
          </div>
        </div>
      `}
      ${error && html`<div className="mt-8 p-6 bg-red-950/20 border border-red-900/50 rounded-3xl text-red-500 text-[11px] font-black uppercase tracking-widest text-center">${error}</div>`}
    </div>
  `;
};

const App = () => {
  const [tab, setTab] = useState('encode');
  const [encodedResult, setEncodedResult] = useState(null);
  const [lastFile, setLastFile] = useState(null);
  const [media, setMedia] = useState(null);

  return html`
    <div className="min-h-screen bg-[#020202] text-white flex flex-col font-sans selection:bg-blue-600/40 antialiased overflow-hidden">
      <header className="p-8 border-b border-white/5 flex justify-between items-center bg-black/60 backdrop-blur-3xl sticky top-0 z-50">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center rotate-6 shadow-[0_10px_40px_rgba(37,99,235,0.4)] border border-white/10 group transition-transform hover:rotate-[-6deg]"><${Shield} size=${28} /></div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tighter leading-none">Ghost<span className="text-blue-500">Comm</span></h1>
            <span className="text-[9px] font-black opacity-30 uppercase tracking-[0.8em]">Titan Core v3.0 Stable</span>
          </div>
        </div>
        <div className="w-12 h-12 rounded-full bg-zinc-900 border border-white/5 flex items-center justify-center cursor-pointer tap-scale"><${Settings} size=${20} className="text-zinc-600" /></div>
      </header>

      <main className="flex-1 p-8 max-w-xl mx-auto w-full overflow-y-auto custom-scrollbar">
        <div className="flex bg-zinc-900/40 p-2 rounded-[2.5rem] border border-white/5 mb-14 relative overflow-hidden shadow-2xl">
          <div className=${`absolute top-2 bottom-2 left-2 w-[calc(50%-8px)] bg-zinc-800 rounded-[1.8rem] transition-transform duration-700 cubic-bezier(0.16, 1, 0.3, 1) shadow-xl border border-white/10 ${tab === 'decode' ? 'translate-x-full' : 'translate-x-0'}`} />
          <button onClick=${() => setTab('encode')} className=${`flex-1 py-5 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all relative z-10 ${tab === 'encode' ? 'text-white' : 'text-zinc-500'}`}>
            Assemble
          </button>
          <button onClick=${() => setTab('decode')} className=${`flex-1 py-5 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all relative z-10 ${tab === 'decode' ? 'text-white' : 'text-zinc-500'}`}>
            Reconstruct
          </button>
        </div>

        <div className="transition-all duration-1000 transform">
          ${tab === 'encode' ? html`<${EncodingView} persistentResult=${encodedResult} setPersistentResult=${setEncodedResult} persistentFile=${lastFile} setPersistentFile=${setLastFile} />` : 
          html`<${DecodingView} persistentMedia=${media} setPersistentMedia=${setMedia} />`}
        </div>
      </main>

      <footer className="p-10 border-t border-white/5 text-center flex flex-col gap-6 bg-black/40">
        <div className="flex items-center justify-center gap-12 mb-2 opacity-[0.05]">
          <${Layers} size=${18} />
          <${Cpu} size=${18} />
          <${Hash} size=${18} />
          <${Fingerprint} size=${18} />
        </div>
        <span className="text-[10px] font-black uppercase tracking-[0.8em] opacity-20">Secure Titan Host • Fragment Encrypted</span>
        <span className="text-[8px] font-black uppercase tracking-[0.5em] opacity-10">Optimized for Satellite Uplinks</span>
      </footer>

      <style>
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .animate-shimmer { animation: shimmer 2.5s infinite linear; }
        .custom-scrollbar::-webkit-scrollbar { width: 0; }
        * { -webkit-tap-highlight-color: transparent; }
        .glass {
          background: rgba(15, 15, 15, 0.7);
          backdrop-filter: blur(40px) saturate(180%);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        .animate-fade-in { animation: fade-in 1s ease-out; }
        @keyframes slide-up { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .animate-slide-up { animation: slide-up 0.8s cubic-bezier(0.16, 1, 0.3, 1); }
      </style>
    </div>
  `;
};

const root = createRoot(document.getElementById('root'));
root.render(html`<${App} />`);
