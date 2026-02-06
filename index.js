
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import { 
  Shield, Download, Box, Loader2, Zap, CheckCircle, Copy, Eye, AlertCircle, 
  Volume2, Music, X, Terminal, Settings, Trash2, Play, Pause, Activity,
  Video, Film, Monitor, Share2, ClipboardPaste, Info, AlertTriangle,
  Cpu, Hash, Layers, AudioLines, Fingerprint, Lock, Unlock, Database, CpuIcon
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

// --- INSTANT WAV ENCODER ---
const createWavFile = (int16Data, sampleRate) => {
  const buffer = new ArrayBuffer(44 + int16Data.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 32 + int16Data.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, int16Data.length * 2, true);

  for (let i = 0; i < int16Data.length; i++) {
    view.setInt16(44 + i * 2, int16Data[i], true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

const fastTranscodeAudio = async (file, onProgress) => {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const arrayBuffer = await file.arrayBuffer();
  const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  
  const targetSampleRate = 8000;
  const offlineCtx = new OfflineAudioContext(1, decodedBuffer.duration * targetSampleRate, targetSampleRate);
  
  const source = offlineCtx.createBufferSource();
  source.buffer = decodedBuffer;
  source.connect(offlineCtx.destination);
  source.start();
  
  if (onProgress) onProgress(40);
  const renderedBuffer = await offlineCtx.startRendering();
  if (onProgress) onProgress(80);
  
  const rawData = renderedBuffer.getChannelData(0);
  const int16Data = new Int16Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    int16Data[i] = Math.max(-1, Math.min(1, rawData[i])) * 32767;
  }
  
  if (onProgress) onProgress(100);
  return new Uint8Array(int16Data.buffer);
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

// --- UI COMPONENTS ---

const CircularProgress = ({ progress, size = 180 }) => {
  const radius = (size - 24) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return html`
    <div className="relative flex items-center justify-center animate-pulse-slow" style=${{ width: size, height: size }}>
      <svg className="transform -rotate-90" width=${size} height=${size}>
        <circle className="text-white/5" strokeWidth="6" stroke="currentColor" fill="transparent" r=${radius} cx=${size / 2} cy=${size / 2} />
        <circle className="text-blue-500 transition-all duration-700 ease-out shadow-blue-500/50" strokeWidth="6" strokeDasharray=${circumference} strokeDashoffset=${offset} strokeLinecap="round" stroke="currentColor" fill="transparent" r=${radius} cx=${size / 2} cy=${size / 2} />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-4xl font-black text-white tracking-tighter">${Math.round(progress)}%</span>
        <span className="text-[7px] font-black uppercase tracking-[0.4em] text-blue-500/60 mt-1">Syncing</span>
      </div>
    </div>
  `;
};

const EncodingView = ({ persistentResult, setPersistentResult, persistentFile, setPersistentFile }) => {
  const [file, setFile] = useState(persistentFile);
  const [state, setState] = useState({ isProcessing: false, progress: 0, result: persistentResult, error: null });
  const [isCopied, setIsCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => setPersistentFile(file), [file]);
  useEffect(() => setPersistentResult(state.result), [state.result]);

  const handleProcess = async () => {
    if (!file) return;
    setState(s => ({ ...s, isProcessing: true, progress: 0, error: null }));
    try {
      let type = file.type.startsWith('audio/') ? MediaType.AUDIO : MediaType.IMAGE;
      let raw;
      if (type === MediaType.AUDIO) {
        raw = await fastTranscodeAudio(file, (p) => setState(s => ({ ...s, progress: p * 0.4 })));
      } else {
        raw = new Uint8Array(await file.arrayBuffer());
        setState(s => ({ ...s, progress: 40 }));
      }
      const compressed = await compressBytes(raw);
      setState(s => ({ ...s, progress: 70 }));
      const encoded = encodeBase32768(compressed);
      setState(s => ({ ...s, progress: 95 }));
      const volumes = [`GC:${type}:1:0:${calculateChecksum(encoded)}:${encoded}`];
      setState({ isProcessing: false, progress: 100, result: volumes, error: null });
    } catch (e) {
      setState({ isProcessing: false, progress: 0, result: null, error: "Protocol Handshake Failed" });
    }
  };

  return html`
    <div className="space-y-8 animate-slide-up">
      <div className="glass rounded-[3.5rem] p-8 text-center shadow-[0_40px_100px_rgba(0,0,0,0.6)] relative overflow-hidden group min-h-[450px] flex flex-col items-center justify-center transition-all duration-700 hover:shadow-blue-900/10">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-600/30 to-transparent" />
        
        ${!file ? html`
          <div className="space-y-12 py-12 w-full">
            <div className="w-28 h-28 bg-zinc-900/60 rounded-[3rem] flex items-center justify-center mx-auto border border-white/5 shadow-inner relative transition-transform hover:scale-105 duration-500">
              <div className="absolute inset-0 bg-blue-600/5 blur-[40px] rounded-full animate-pulse" />
              <${Database} className="text-zinc-500 relative z-10" size={44} />
            </div>
            <div className="space-y-6 px-4">
              <button onClick=${() => fileInputRef.current.click()} className="w-full py-7 bg-blue-600 rounded-[2rem] font-black text-[12px] uppercase tracking-[0.4em] tap-scale shadow-[0_20px_60px_rgba(37,99,235,0.4)] hover:bg-blue-500 transition-all active:scale-95">
                Initialize Vault
              </button>
              <p className="text-[8px] font-black uppercase tracking-[0.7em] text-zinc-600">Ghost Protocol v3.0 Stable</p>
            </div>
            <input type="file" ref=${fileInputRef} className="hidden" accept="audio/*,image/*" onChange=${e => setFile(e.target.files[0])} />
          </div>
        ` : !state.result ? html`
          <div className="space-y-12 w-full animate-slide-up">
            <div className="aspect-square w-full bg-black/40 rounded-[3rem] overflow-hidden border border-white/5 flex items-center justify-center shadow-inner relative group transition-all duration-700">
              ${state.isProcessing ? html`<${CircularProgress} progress=${state.progress} />` : 
                file.type.startsWith('image/') ? 
                  html`<img src=${URL.createObjectURL(file)} className="w-full h-full object-contain p-6 animate-float" />` :
                  html`<div className="p-16 bg-blue-600/5 rounded-full border border-blue-500/10 shadow-2xl animate-pulse-slow"><${Music} size=${72} className="text-blue-500" /></div>`
              }
            </div>
            <div className="flex flex-col gap-5 px-4">
              <button onClick=${handleProcess} disabled=${state.isProcessing} className="w-full py-7 bg-blue-600 rounded-[2.2rem] font-black text-xs uppercase tracking-[0.4em] tap-scale shadow-2xl shadow-blue-900/40 transition-all disabled:opacity-40">
                ${state.isProcessing ? "Transcoding..." : "Begin Compression"}
              </button>
              <button onClick=${() => setFile(null)} className="text-[9px] font-black uppercase tracking-[0.5em] text-zinc-600 hover:text-white transition-colors py-2">Change Source</button>
            </div>
          </div>
        ` : html`
          <div className="space-y-10 w-full animate-slide-up">
            <div className="bg-zinc-900/40 border border-white/5 p-8 rounded-[3rem] text-left relative overflow-hidden">
              <div className="flex items-center gap-5 mb-8">
                <div className="w-14 h-14 bg-blue-600/10 rounded-2xl flex items-center justify-center border border-blue-600/20 shadow-xl">
                  <${Terminal} size=${26} className="text-blue-500" />
                </div>
                <div>
                  <h3 className="text-[11px] font-black uppercase tracking-widest text-white">Ghost Cipher v3</h3>
                  <p className="text-[8px] font-black text-zinc-600 uppercase tracking-[0.3em] mt-1">${state.result[0].length.toLocaleString()} Fragments</p>
                </div>
              </div>
              <div className="bg-black/80 p-8 rounded-[2.5rem] border border-white/5 font-mono text-[11px] text-blue-400 h-44 overflow-y-auto break-all relative shadow-inner custom-scrollbar">
                <div className=${`transition-all duration-1000 cubic-bezier(0.16, 1, 0.3, 1) ${!showRaw && 'blur-3xl opacity-5 scale-95'}`}>
                  ${state.result[0]}
                </div>
                ${!showRaw && html`
                  <div className="absolute inset-0 flex items-center justify-center">
                    <button onClick=${() => setShowRaw(true)} className="px-12 py-5 bg-zinc-800/90 backdrop-blur-3xl rounded-full text-[10px] font-black uppercase tracking-[0.4em] border border-white/10 shadow-[0_30px_60px_rgba(0,0,0,0.8)] tap-scale transition-all hover:bg-zinc-700">Unlock Cipher</button>
                  </div>
                `}
              </div>
            </div>
            <div className="flex gap-4 px-2">
              <button onClick=${() => { navigator.clipboard.writeText(state.result[0]); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }} 
                className=${`flex-1 py-7 rounded-[2.2rem] font-black text-xs uppercase tracking-[0.3em] tap-scale transition-all shadow-2xl ${isCopied ? 'bg-green-600 shadow-green-900/20' : 'bg-white text-black'}`}>
                ${isCopied ? "Cipher Copied" : "Copy Volume"}
              </button>
              <button onClick=${() => setShowRaw(!showRaw)} className="p-7 bg-zinc-900 rounded-[2.2rem] text-zinc-500 border border-white/5 tap-scale transition-all hover:text-white hover:bg-zinc-800"><${showRaw ? X : Eye} size=${28} /></button>
            </div>
            <button onClick=${() => {setFile(null); setState({result:null}); setShowRaw(false);}} className="text-[9px] font-black uppercase text-zinc-700 tracking-[0.5em] py-2 hover:text-white transition-colors">Abort & Wipe Local Cache</button>
          </div>
        `}
        ${state.error && html`<div className="mt-8 p-6 bg-red-950/20 border border-red-900/50 rounded-[2rem] text-red-500 text-[10px] font-black uppercase tracking-widest animate-pulse flex items-center gap-3"><${AlertCircle} size={16}/> ${state.error}</div>`}
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
        const int16 = new Int16Array(raw.buffer);
        const wavBlob = createWavFile(int16, 8000);
        url = URL.createObjectURL(wavBlob);
      } else {
        const blob = new Blob([raw], { type: 'image/webp' });
        url = URL.createObjectURL(blob);
      }
      setPersistentMedia({ type, url });
      setError(null);
    } catch (e) { setError("Data Stream Corrupted"); }
  };

  return html`
    <div className="glass rounded-[3.5rem] p-10 animate-fade-in shadow-2xl min-h-[450px] flex flex-col justify-center relative transition-all duration-700">
      <div className="absolute bottom-0 right-0 w-64 h-64 bg-blue-600/5 blur-[120px] rounded-full pointer-events-none" />
      
      ${!persistentMedia ? html`
        <div className="space-y-12 text-center w-full">
          <div className="space-y-4">
            <h2 className="text-base font-black uppercase tracking-[0.6em] text-white">Ghost Receiver</h2>
            <p className="text-[10px] font-black uppercase tracking-[0.4em] opacity-30">Listening for Handshake</p>
          </div>
          <div className="relative group">
            <textarea value=${input} onChange=${e => { setInput(e.target.value); handleDecode(e.target.value); }} 
              placeholder="PASTE CIPHER..." 
              className="w-full h-56 bg-black/60 border border-white/5 rounded-[3rem] p-10 font-mono text-[13px] text-blue-400 focus:border-blue-500/30 outline-none transition-all shadow-inner leading-relaxed resize-none custom-scrollbar" />
            <button onClick=${async () => { const t = await navigator.clipboard.readText(); setInput(t); handleDecode(t); }} 
              className="absolute bottom-8 right-8 p-5 bg-zinc-900 rounded-[1.5rem] text-zinc-400 border border-white/10 tap-scale shadow-2xl hover:bg-zinc-800 transition-all">
               <${ClipboardPaste} size=${24} />
            </button>
          </div>
          <button onClick=${() => setInput("")} className="text-[10px] font-black uppercase opacity-20 hover:opacity-100 transition-opacity tracking-[0.6em] py-2">Purge Handshake</button>
        </div>
      ` : html`
        <div className="space-y-14 text-center animate-slide-up w-full">
          <div className="aspect-square bg-black/60 rounded-[3.5rem] overflow-hidden border border-white/5 flex items-center justify-center shadow-inner relative group p-6">
             ${persistentMedia.type === 'I' ? html`<img src=${persistentMedia.url} className="w-full h-full object-contain animate-float" />` : 
               html`
                <div className="w-full flex flex-col items-center gap-12">
                  <div className="w-36 h-36 bg-blue-600/10 rounded-full flex items-center justify-center border border-blue-500/20 shadow-[0_0_80px_rgba(37,99,235,0.2)] animate-pulse-slow">
                    <${AudioLines} size=${64} className="text-blue-500" />
                  </div>
                  <audio controls src=${persistentMedia.url} className="w-full custom-audio" />
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.4em]">Signal Reconstructed</p>
                </div>
             `}
          </div>
          <div className="flex flex-col gap-5 px-4">
             <a href=${persistentMedia.url} download=${`SYNC_${Date.now()}.${persistentMedia.type === 'I' ? 'webp' : 'wav'}`}
               className="w-full py-8 bg-blue-600 rounded-[2.5rem] font-black text-xs uppercase tracking-[0.4em] flex items-center justify-center gap-5 tap-scale shadow-2xl shadow-blue-900/40 hover:bg-blue-500">
               <${Download} size=${26} /> Reconstruct Asset
             </a>
             <button onClick=${() => { setPersistentMedia(null); setInput(""); }} className="text-[10px] font-black uppercase tracking-[0.5em] opacity-30 hover:opacity-100 transition-opacity py-2">Reset Circuit</button>
          </div>
        </div>
      `}
      ${error && html`<div className="mt-8 p-6 bg-red-950/20 border border-red-900/50 rounded-[2rem] text-red-500 text-[11px] font-black uppercase tracking-widest text-center animate-bounce-slow">${error}</div>`}
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
      <header className="p-8 border-b border-white/5 flex justify-between items-center bg-black/70 backdrop-blur-3xl sticky top-0 z-50">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 bg-blue-600 rounded-[1.8rem] flex items-center justify-center rotate-6 shadow-[0_20px_50px_rgba(37,99,235,0.5)] border border-white/10 group transition-all duration-700 hover:rotate-[-6deg]"><${Shield} size=${32} /></div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tighter leading-none">Ghost<span className="text-blue-500">Comm</span></h1>
            <span className="text-[9px] font-black opacity-30 uppercase tracking-[0.8em] mt-1 block">Titan V3.0 Stable</span>
          </div>
        </div>
        <div className="w-14 h-14 rounded-full bg-zinc-900/80 border border-white/5 flex items-center justify-center cursor-pointer tap-scale transition-all hover:bg-zinc-800"><${Settings} size=${24} className="text-zinc-600" /></div>
      </header>

      <main className="flex-1 p-8 max-w-xl mx-auto w-full overflow-y-auto custom-scrollbar">
        <div className="flex bg-zinc-900/50 p-2.5 rounded-[2.5rem] border border-white/10 mb-16 relative overflow-hidden shadow-[0_30px_60px_rgba(0,0,0,0.5)]">
          <div className=${`absolute top-2.5 bottom-2.5 left-2.5 w-[calc(50%-10px)] bg-zinc-800 rounded-[1.8rem] transition-transform duration-700 cubic-bezier(0.16, 1, 0.3, 1) shadow-2xl border border-white/10 ${tab === 'decode' ? 'translate-x-full' : 'translate-x-0'}`} />
          <button onClick=${() => setTab('encode')} className=${`flex-1 py-5 rounded-2xl text-[12px] font-black uppercase tracking-[0.3em] transition-all relative z-10 ${tab === 'encode' ? 'text-white' : 'text-zinc-500'}`}>
            Assemble
          </button>
          <button onClick=${() => setTab('decode')} className=${`flex-1 py-5 rounded-2xl text-[12px] font-black uppercase tracking-[0.3em] transition-all relative z-10 ${tab === 'decode' ? 'text-white' : 'text-zinc-500'}`}>
            Reconstruct
          </button>
        </div>

        <div className="transition-all duration-1000 transform">
          ${tab === 'encode' ? html`<${EncodingView} persistentResult=${encodedResult} setPersistentResult=${setEncodedResult} persistentFile=${lastFile} setPersistentFile=${setLastFile} />` : 
          html`<${DecodingView} persistentMedia=${media} setPersistentMedia=${setMedia} />`}
        </div>
      </main>

      <footer className="p-12 border-t border-white/5 text-center flex flex-col gap-6 bg-black/60">
        <div className="flex items-center justify-center gap-14 mb-2 opacity-[0.06]">
          <${Layers} size=${20} />
          <${CpuIcon} size=${20} />
          <${Hash} size=${20} />
          <${Fingerprint} size=${20} />
        </div>
        <span className="text-[10px] font-black uppercase tracking-[0.8em] opacity-20">Secure Titan Host • Fragment Encrypted</span>
        <span className="text-[8px] font-black uppercase tracking-[0.6em] opacity-10">Optimized for Satellite Uplinks</span>
      </footer>

      <style>
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .animate-shimmer { animation: shimmer 2.5s infinite linear; }
        .custom-scrollbar::-webkit-scrollbar { width: 0; }
        * { -webkit-tap-highlight-color: transparent; outline: none; }
        .glass {
          background: rgba(12, 12, 12, 0.8);
          backdrop-filter: blur(50px) saturate(200%);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        .animate-fade-in { animation: fade-in 1.2s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes slide-up { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .animate-slide-up { animation: slide-up 1s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes float { 0% { transform: translateY(0); } 50% { transform: translateY(-15px); } 100% { transform: translateY(0); } }
        .animate-float { animation: float 6s infinite ease-in-out; }
        @keyframes pulseSlow { 0% { opacity: 0.8; transform: scale(1); } 50% { opacity: 1; transform: scale(1.02); } 100% { opacity: 0.8; transform: scale(1); } }
        .animate-pulse-slow { animation: pulseSlow 5s infinite ease-in-out; }
        @keyframes bounceSlow { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        .animate-bounce-slow { animation: bounceSlow 4s infinite ease-in-out; }
        .custom-audio::-webkit-media-controls-panel { background-color: rgba(255, 255, 255, 0.03); }
        .custom-audio::-webkit-media-controls-play-button { filter: invert(0.8) hue-rotate(180deg); }
        input[type="file"]::file-selector-button { display: none; }
      </style>
    </div>
  `;
};

const root = createRoot(document.getElementById('root'));
root.render(html`<${App} />`);
