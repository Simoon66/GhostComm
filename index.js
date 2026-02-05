
import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import { 
  Shield, Download, Box, Loader2, Zap, CheckCircle, Copy, Eye, AlertCircle, 
  Volume2, Music, X, Terminal, Settings, Trash2, Play, Pause, Activity,
  Video, Film, Monitor, Share2, ClipboardPaste, Info, AlertTriangle
} from 'lucide-react';

const html = htm.bind(React.createElement);

// --- ENCODING ALPHABET GENERATION ---
const generateAlphabet = () => {
  let chars = "";
  for (let i = 33; i <= 126; i++) {
    if (i !== 58) chars += String.fromCharCode(i);
  }
  for (let i = 161; i <= 255; i++) chars += String.fromCharCode(i);
  for (let i = 0x0370; i <= 0x03FF; i++) chars += String.fromCharCode(i);
  for (let i = 0x0400; i <= 0x04FF; i++) chars += String.fromCharCode(i);
  let currentCJK = 0x4E00;
  while (chars.length < 32768) {
    chars += String.fromCharCode(currentCJK++);
  }
  return chars.substring(0, 32768);
};

const ALPHABET = generateAlphabet();
const DECODE_MAP = new Map(Array.from(ALPHABET).map((c, i) => [c, i]));
const ALPHABET_SET = new Set(ALPHABET);

const MediaType = { IMAGE: 'I', AUDIO: 'A', VIDEO: 'V' };

// --- CORE LOGIC ---
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
      encoded += ALPHABET[index];
    }
  }
  if (bitsInBuffer > 0) {
    const index = (buffer << (15 - bitsInBuffer)) & 0x7FFF;
    encoded += ALPHABET[index];
  }
  return encoded;
};

const decodeBase32768 = (str) => {
  const indices = [];
  for (let i = 0; i < str.length; i++) {
    const index = DECODE_MAP.get(str[i]);
    if (index !== undefined) indices.push(index);
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

const transcodeVideo = async (file, onProgress) => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const sourceUrl = URL.createObjectURL(file);
    video.src = sourceUrl;
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      const canvas = document.createElement('canvas');
      const targetWidth = 320;
      const scale = targetWidth / video.videoWidth;
      canvas.width = targetWidth;
      canvas.height = video.videoHeight * scale;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(12);
      const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
      let selectedMime = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
      const recorder = new MediaRecorder(stream, {
        mimeType: selectedMime,
        videoBitsPerSecond: 100000 
      });
      const videoChunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) videoChunks.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(videoChunks, { type: selectedMime });
        const arrayBuffer = await blob.arrayBuffer();
        URL.revokeObjectURL(sourceUrl);
        resolve(new Uint8Array(arrayBuffer));
      };
      video.onended = () => { recorder.stop(); };
      video.play();
      recorder.start();
      const processFrame = () => {
        if (video.ended || video.paused) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (onProgress) { onProgress((video.currentTime / video.duration) * 100); }
        requestAnimationFrame(processFrame);
      };
      requestAnimationFrame(processFrame);
    };
    video.onerror = (e) => { URL.revokeObjectURL(sourceUrl); reject(e); };
  });
};

const processMedia = async (file, type, onProgress) => {
  if (type === MediaType.IMAGE) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(640 / img.width, 1);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(async b => resolve(new Uint8Array(await b.arrayBuffer())), 'image/webp', 0.2);
      };
      img.src = URL.createObjectURL(file);
    });
  }
  if (type === MediaType.VIDEO) { return await transcodeVideo(file, onProgress); }
  return new Uint8Array(await file.arrayBuffer());
};

const createVolumes = (type, encodedText, maxChars) => {
  const effectiveSize = maxChars - 60;
  const total = Math.ceil(encodedText.length / effectiveSize);
  return Array.from({ length: total }, (_, i) => {
    const payload = encodedText.substring(i * effectiveSize, (i + 1) * effectiveSize);
    return `GC:${type}:${total}:${i}:${calculateChecksum(payload)}:${payload}`;
  });
};

const extractChunks = (text) => {
  return text.split("GC:").filter(s => s.trim()).map(segment => {
    const parts = segment.split(":");
    if (parts.length < 5) return null;
    const type = parts[0];
    const total = parseInt(parts[1]);
    const index = parseInt(parts[2]);
    const checksum = parts[3];
    const rawPayload = parts.slice(4).join(":");
    let cleanedPayload = "";
    for (const char of rawPayload) { if (ALPHABET_SET.has(char)) cleanedPayload += char; }
    if (calculateChecksum(cleanedPayload) !== checksum) return null;
    return { type, total, index, checksum, payload: cleanedPayload };
  }).filter(c => c !== null);
};

// --- VIEWS ---

const EncodingView = ({ persistentResult, setPersistentResult, persistentFile, setPersistentFile }) => {
  const [file, setFile] = useState(persistentFile);
  const [state, setState] = useState({ 
    isProcessing: false, 
    progress: 0, 
    result: persistentResult, 
    error: null,
    warning: null
  });
  const [isCopied, setIsCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => setPersistentFile(file), [file]);
  useEffect(() => setPersistentResult(state.result), [state.result]);

  const handleProcess = async () => {
    setState(s => ({ ...s, isProcessing: true, progress: 0, error: null, warning: null }));
    try {
      let type = MediaType.IMAGE;
      if (file.type.startsWith('audio/')) type = MediaType.AUDIO;
      else if (file.type.startsWith('video/')) type = MediaType.VIDEO;

      const raw = await processMedia(file, type, (p) => {
        setState(s => ({ ...s, progress: p * 0.7 }));
      });
      
      setState(s => ({ ...s, progress: 75 }));
      const compressed = await compressBytes(raw);
      
      setState(s => ({ ...s, progress: 90 }));
      const encoded = encodeBase32768(compressed);
      
      const chunkLimit = 15000;
      const volumes = createVolumes(type, encoded, chunkLimit);
      
      let warning = null;
      if (volumes.length > 50) {
        warning = {
          level: 'critical',
          msg: "Extreme Volume Count Detected",
          suggestion: "This media is too large for practical transmission (50+ chunks). Please trim the video, use a shorter audio clip, or send a lower-resolution file."
        };
      } else if (volumes.length > 20) {
        warning = {
          level: 'warning',
          msg: "High Volume Transmission",
          suggestion: "This session requires 20+ manual copy-pastes. Consider if manual splitting or a direct link is more feasible for your recipient."
        };
      }

      setState({ isProcessing: false, progress: 100, result: volumes, error: null, warning });
    } catch (e) {
      console.error(e);
      setState({ isProcessing: false, progress: 0, result: null, error: "Protocol Error: Encoding Failed", warning: null });
    }
  };

  const getPreview = () => {
    if (!file) return null;
    const url = URL.createObjectURL(file);
    if (file.type.startsWith('image/')) return html`<img src=${url} className="w-full h-full object-contain" />`;
    if (file.type.startsWith('video/')) return html`<video src=${url} className="w-full h-full object-contain" muted autoplay loop />`;
    return html`<div className="flex flex-col items-center gap-4"><${Volume2} size=${64} className="text-blue-500" /><span className="text-[10px] font-black uppercase opacity-40">${file.name}</span></div>`;
  };

  return html`
    <div className="space-y-6">
      <div className="glass rounded-[2.5rem] p-8 text-center animate-slide-up shadow-2xl relative overflow-hidden">
        ${!file ? html`
          <div className="py-12 space-y-10">
            <div className="w-24 h-24 bg-blue-600/10 rounded-[2rem] flex items-center justify-center mx-auto border border-blue-500/20 shadow-inner">
              <${Box} className="text-zinc-600" size=${32} />
            </div>
            <div className="space-y-4">
              <button onClick=${() => fileInputRef.current.click()} className="w-full py-5 bg-blue-600 rounded-2xl font-black text-[11px] uppercase tracking-widest tap-scale shadow-xl shadow-blue-900/40">
                Open Media Vault
              </button>
              <p className="text-[8px] font-black uppercase tracking-[0.4em] opacity-30">Supports Image, Audio, Video</p>
            </div>
            <input type="file" ref=${fileInputRef} className="hidden" accept="image/*,audio/*,video/*" onChange=${e => setFile(e.target.files[0])} />
          </div>
        ` : !state.result ? html`
          <div className="space-y-8">
            <div className="aspect-square bg-black rounded-[2rem] overflow-hidden border border-white/5 flex items-center justify-center shadow-inner relative">
              ${getPreview()}
              ${state.isProcessing && html`
                <div className="absolute inset-0 bg-black/80 backdrop-blur-xl flex flex-col items-center justify-center p-8 z-30 animate-fade-in">
                  <${Loader2} className="animate-spin text-blue-500 mb-6" size=${48} />
                  <div className="w-full max-w-[220px] bg-zinc-800 h-1.5 rounded-full overflow-hidden mb-4 border border-white/5">
                    <div className="h-full bg-blue-500 transition-all duration-300 shadow-[0_0_15px_rgba(59,130,246,0.6)]" style=${{ width: `${state.progress}%` }} />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-400">Optimizing: ${Math.round(state.progress)}%</span>
                </div>
              `}
            </div>
            <div className="flex flex-col gap-4">
              <button onClick=${handleProcess} disabled=${state.isProcessing} className="w-full py-6 bg-blue-600 rounded-2xl font-black text-xs uppercase tracking-widest tap-scale flex items-center justify-center gap-3 shadow-2xl shadow-blue-900/40 disabled:opacity-50">
                <${Zap} size=${20} fill="currentColor" />
                ${state.isProcessing ? "Analyzing..." : "Begin Encoding"}
              </button>
              <button onClick=${() => {setFile(null); setState(s => ({...s, result: null}))}} className="text-[10px] uppercase font-black opacity-30 tracking-widest">Select Different Media</button>
            </div>
          </div>
        ` : html`
          <div className="space-y-6">
            <div className="bg-zinc-900/50 border border-white/5 p-5 rounded-3xl text-left animate-fade-in">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center border border-blue-500/20">
                  <${Activity} size=${18} className="text-blue-500" />
                </div>
                <div>
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-white">Transmission Profile</h3>
                  <p className="text-[8px] font-bold text-zinc-500 uppercase">${state.result.length} Packets Created</p>
                </div>
              </div>
              ${state.warning && html`
                <div className=${`p-4 rounded-2xl mb-4 flex gap-3 border ${state.warning.level === 'critical' ? 'bg-red-900/10 border-red-900/50 text-red-400' : 'bg-orange-900/10 border-orange-900/50 text-orange-400'}`}>
                   <${state.warning.level === 'critical' ? AlertCircle : AlertTriangle} size=${18} className="shrink-0" />
                   <div>
                     <p className="text-[9px] font-black uppercase tracking-widest mb-1">${state.warning.msg}</p>
                     <p className="text-[8px] font-medium leading-relaxed opacity-80">${state.warning.suggestion}</p>
                   </div>
                </div>
              `}
              <div className="bg-black p-4 rounded-2xl border border-white/5 font-mono text-[9px] text-blue-400 h-32 overflow-y-auto break-all relative">
                <div className=${`transition-all duration-700 ${!showRaw && 'blur-xl select-none opacity-20'}`}>
                   ${state.result[0]}
                </div>
                ${!showRaw && html`
                  <div className="absolute inset-0 flex items-center justify-center">
                    <button onClick=${() => setShowRaw(true)} className="px-5 py-2 bg-zinc-800 rounded-full text-[8px] font-black uppercase tracking-widest border border-white/10 shadow-xl tap-scale">View Packet 01</button>
                  </div>
                `}
              </div>
            </div>

            <div className="flex gap-3">
               <button onClick=${() => setShowRaw(!showRaw)} className="p-5 bg-zinc-900 rounded-2xl text-zinc-400 border border-white/5 tap-scale"><${showRaw ? X : Eye} size=${22} /></button>
               <button onClick=${() => { navigator.clipboard.writeText(state.result[0]); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }} 
                className=${`flex-1 py-6 rounded-2xl font-black text-xs uppercase tracking-widest tap-scale transition-all shadow-2xl ${isCopied ? 'bg-green-600 text-white' : 'bg-white text-black'}`}>
                ${isCopied ? "Buffer Saved" : "Copy Payload"}
              </button>
            </div>
            <button onClick=${() => {setFile(null); setState({result:null, warning: null});}} className="text-[10px] font-black uppercase opacity-30 tracking-widest">Start New Assembly</button>
          </div>
        `}
        ${state.error && html`<div className="mt-4 p-4 bg-red-950/20 border border-red-900/50 rounded-2xl text-red-500 text-[10px] font-black uppercase tracking-widest animate-pulse">${state.error}</div>`}
      </div>
    </div>
  `;
};

const DecodingView = ({ persistentChunks, setPersistentChunks, persistentMedia, setPersistentMedia }) => {
  const [input, setInput] = useState("");
  const [error, setError] = useState(null);
  const handleDecode = async (text) => {
    try {
      const chunks = extractChunks(text);
      if (!chunks.length) return;
      const newMap = new Map(persistentChunks);
      chunks.forEach(c => newMap.set(c.index, c));
      setPersistentChunks(newMap);
      const first = Array.from(newMap.values())[0];
      if (newMap.size >= first.total) {
        const sorted = Array.from(newMap.values()).sort((a,b) => a.index - b.index);
        const fullPayload = sorted.map(c => c.payload).join('');
        const compressed = decodeBase32768(fullPayload);
        const raw = await decompressBytes(compressed);
        let mime = 'image/webp';
        let ext = 'webp';
        if (first.type === 'A') { mime = 'audio/webm'; ext = 'webm'; }
        else if (first.type === 'V') { mime = 'video/webm'; ext = 'webm'; }
        const blob = new Blob([raw], { type: mime });
        setPersistentMedia({ type: first.type, url: URL.createObjectURL(blob), extension: ext });
      }
    } catch (e) { setError("Corrupted Packet Stream Detected"); }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInput(text);
      handleDecode(text);
    } catch (e) { setError("Clipboard Access Denied"); }
  };

  return html`
    <div className="glass rounded-[2.5rem] p-8 animate-slide-up shadow-2xl">
      ${!persistentMedia ? html`
        <div className="space-y-8 text-center">
          <div className="space-y-1">
            <h2 className="text-sm font-black uppercase tracking-widest text-white">Receiver Terminal</h2>
            <p className="text-[8px] font-black uppercase tracking-[0.3em] opacity-30">Waiting for Coded Stream</p>
          </div>
          <div className="relative">
            <textarea value=${input} onChange=${e => { setInput(e.target.value); handleDecode(e.target.value); }} 
              placeholder="PASTE BUFFER CONTENT..." 
              className="w-full h-48 bg-black border border-white/5 rounded-[2rem] p-8 font-mono text-[11px] text-blue-400 focus:border-blue-500/30 outline-none transition-all shadow-inner leading-relaxed resize-none" />
            <button onClick=${handlePaste} className="absolute bottom-4 right-4 p-3 bg-zinc-900 rounded-xl text-zinc-500 border border-white/5 tap-scale"><${ClipboardPaste} size=${18} /></button>
          </div>
          ${persistentChunks.size > 0 && html`
            <div className="bg-blue-600/5 border border-blue-500/20 p-5 rounded-3xl flex flex-col gap-4 animate-fade-in shadow-inner">
              <div className="flex justify-between items-center px-1">
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-blue-400">Syncing Packet Streams</span>
                <span className="text-[10px] font-bold text-white bg-blue-600 px-3 py-1 rounded-full border border-blue-400/30">${persistentChunks.size} Volumes Sync'd</span>
              </div>
              <div className="h-1 bg-zinc-900 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 w-full animate-shimmer bg-gradient-to-r from-blue-600 via-blue-300 to-blue-600 bg-[length:200%_100%]" />
              </div>
            </div>
          `}
          <button onClick=${() => { setPersistentChunks(new Map()); setInput(""); setError(null); }} className="text-[9px] font-black uppercase opacity-20 hover:opacity-100 transition-opacity tracking-widest">Clear Buffer Memory</button>
        </div>
      ` : html`
        <div className="space-y-10 text-center">
          <div className="aspect-square bg-black rounded-[2.5rem] overflow-hidden border border-white/5 flex items-center justify-center shadow-inner relative group">
             ${persistentMedia.type === 'I' ? html`<img src=${persistentMedia.url} className="w-full h-full object-contain p-4" />` : 
               persistentMedia.type === 'V' ? html`<video controls src=${persistentMedia.url} className="w-full h-full object-contain bg-black" />` : 
               html`
                <div className="w-full p-12">
                  <div className="w-24 h-24 bg-blue-600/10 rounded-full flex items-center justify-center mx-auto mb-8 border border-blue-500/20 shadow-2xl"><${Music} size={48} className="text-blue-500" /></div>
                  <audio controls src=${persistentMedia.url} className="w-full" />
                </div>
             `}
          </div>
          <div className="flex flex-col gap-4">
             <a href=${persistentMedia.url} download=${`Decrypted_${Date.now()}.${persistentMedia.extension}`}
               className="w-full py-6 bg-blue-600 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-4 tap-scale shadow-2xl shadow-blue-900/40">
               <${Download} size=${22} /> Save to Device
             </a>
             <button onClick=${() => { setPersistentChunks(new Map()); setPersistentMedia(null); setInput(""); }} className="text-[10px] font-black uppercase tracking-widest opacity-30 hover:opacity-100 transition-opacity">Reset Decoder Terminal</button>
          </div>
        </div>
      `}
      ${error && html`<div className="mt-6 p-4 bg-red-950/20 border border-red-900/50 rounded-2xl text-red-500 text-[10px] font-black uppercase tracking-widest text-center animate-bounce flex items-center justify-center gap-3"><${AlertCircle} size=${16} /> ${error}</div>`}
    </div>
  `;
};

const App = () => {
  const [tab, setTab] = useState('encode');
  const [encodedResult, setEncodedResult] = useState(null);
  const [lastFile, setLastFile] = useState(null);
  const [chunks, setChunks] = useState(new Map());
  const [media, setMedia] = useState(null);

  return html`
    <div className="min-h-screen bg-[#050505] text-white flex flex-col font-sans selection:bg-blue-600/30">
      <header className="p-6 border-b border-white/5 flex justify-between items-center bg-black/50 backdrop-blur-2xl sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center rotate-3 shadow-xl shadow-blue-900/40 border border-white/10"><${Shield} size=${22} /></div>
          <div>
            <h1 className="text-lg font-black uppercase tracking-tighter leading-none">Ghost<span className="text-blue-500">Comm</span></h1>
            <span className="text-[7px] font-black opacity-30 uppercase tracking-[0.6em]">Titan Protocol v2.6.0</span>
          </div>
        </div>
        <div className="w-10 h-10 rounded-full bg-zinc-900 border border-white/5 flex items-center justify-center cursor-pointer tap-scale"><${Settings} size=${16} className="text-zinc-500" /></div>
      </header>

      <main className="flex-1 p-6 max-w-lg mx-auto w-full">
        <div className="flex bg-zinc-900/40 p-1.5 rounded-2xl border border-white/5 mb-10 relative overflow-hidden">
          <div className=${`absolute top-1.5 bottom-1.5 left-1.5 w-[calc(50%-6px)] bg-zinc-800 rounded-xl transition-transform duration-500 ease-in-out shadow-xl border border-white/5 ${tab === 'decode' ? 'translate-x-full' : 'translate-x-0'}`} />
          <button onClick=${() => setTab('encode')} className=${`flex-1 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all relative z-10 ${tab === 'encode' ? 'text-white' : 'text-zinc-500'}`}>Encode</button>
          <button onClick=${() => setTab('decode')} className=${`flex-1 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all relative z-10 ${tab === 'decode' ? 'text-white' : 'text-zinc-500'}`}>Decode</button>
        </div>

        <div className="animate-fade-in">
          ${tab === 'encode' ? html`
            <${EncodingView} persistentResult=${encodedResult} setPersistentResult=${setEncodedResult} persistentFile=${lastFile} setPersistentFile=${setLastFile} />
          ` : html`
            <${DecodingView} persistentChunks=${chunks} setPersistentChunks=${setChunks} persistentMedia=${media} setPersistentMedia=${setMedia} />
          `}
        </div>
      </main>

      <footer className="p-8 border-t border-white/5 text-center flex flex-col gap-2">
        <span className="text-[8px] font-black uppercase tracking-[0.5em] opacity-20">Secure Terminal • Offline Optimized</span>
        <span className="text-[7px] font-black uppercase tracking-[0.3em] opacity-10">End-to-End Cryptography Active</span>
      </footer>

      <style>
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .animate-shimmer { animation: shimmer 2s infinite linear; }
        .custom-scrollbar::-webkit-scrollbar { width: 0; }
      </style>
    </div>
  `;
};

const root = createRoot(document.getElementById('root'));
root.render(html`<${App} />`);
