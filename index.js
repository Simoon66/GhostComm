
import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import { 
  Shield, Download, Box, Loader2, Zap, CheckCircle, Copy, Eye, AlertCircle, 
  Volume2, Music, X, Terminal, Settings, Trash2, Play, Pause, Activity,
  Video, Film, Monitor, Share2, ClipboardPaste, Info, AlertTriangle,
  Cpu, Hash, Layers, AudioLines
} from 'lucide-react';

const html = htm.bind(React.createElement);

// --- ADVANCED ENCODING ALPHABET GENERATION ---
const generateAlphabet = () => {
  let chars = "";
  const addRange = (start, end, exclude = []) => {
    for (let i = start; i <= end; i++) {
      if (!exclude.includes(i)) chars += String.fromCharCode(i);
    }
  };

  addRange(33, 126, [58]); // Printable ASCII
  addRange(161, 255);      // Latin-1
  addRange(0x0100, 0x017F); // Latin Extended-A
  addRange(0x2100, 0x214F); // Symbols
  addRange(0x2190, 0x21FF); // Arrows
  addRange(0x2200, 0x22FF); // Math
  addRange(0x2500, 0x257F); // Box Drawing
  addRange(0x2600, 0x26FF); // Misc Symbols
  addRange(0x0370, 0x03FF); // Greek
  addRange(0x0400, 0x04FF); // Cyrillic
  
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

// --- AUDIO TRANSCODING (Robust Implementation) ---
const transcodeAudio = async (file, onProgress) => {
  return new Promise(async (resolve, reject) => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuffer = await file.arrayBuffer();
      const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      const source = audioCtx.createBufferSource();
      source.buffer = decodedBuffer;
      
      const destination = audioCtx.createMediaStreamDestination();
      source.connect(destination);
      
      const recorder = new MediaRecorder(destination.stream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 16000 
      });
      
      const audioChunks = [];
      recorder.ondataavailable = (e) => audioChunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const finalBuffer = await blob.arrayBuffer();
        resolve(new Uint8Array(finalBuffer));
        audioCtx.close();
      };
      
      recorder.start();
      source.start();
      
      const duration = decodedBuffer.duration;
      const startTime = Date.now();
      
      const progressInterval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const p = Math.min(99, (elapsed / duration) * 100);
        if (onProgress) onProgress(p);
        if (elapsed >= duration) {
          clearInterval(progressInterval);
          source.stop();
          recorder.stop();
        }
      }, 100);
      
    } catch (e) {
      reject(e);
    }
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
      const targetWidth = 320;
      const scale = targetWidth / video.videoWidth;
      canvas.width = targetWidth;
      canvas.height = video.videoHeight * scale;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(12);
      const recorder = new MediaRecorder(stream, {
        mimeType: 'video/webm',
        videoBitsPerSecond: 100000 
      });
      const videoChunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) videoChunks.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(videoChunks, { type: 'video/webm' });
        resolve(new Uint8Array(await blob.arrayBuffer()));
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
  if (type === MediaType.VIDEO) return await transcodeVideo(file, onProgress);
  if (type === MediaType.AUDIO) return await transcodeAudio(file, onProgress);
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

// --- COMPONENTS ---

const EncodingView = ({ persistentResult, setPersistentResult, persistentFile, setPersistentFile }) => {
  const [file, setFile] = useState(persistentFile);
  const [state, setState] = useState({ 
    isProcessing: false, progress: 0, result: persistentResult, error: null, warning: null, metrics: null
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
      
      const metrics = {
        origSize: file.size,
        compressedSize: compressed.length,
        ratio: (file.size / (compressed.length || 1)).toFixed(1),
        charDensity: (15 / 8).toFixed(2)
      };

      let warning = null;
      if (volumes.length > 50) warning = { level: 'critical', msg: "Extreme Payload Detected", suggestion: "Consider a shorter clip for offline sync." };
      else if (volumes.length > 15) warning = { level: 'warning', msg: "High Density Stream", suggestion: "Multi-packet sync required." };

      setState({ isProcessing: false, progress: 100, result: volumes, error: null, warning, metrics });
    } catch (e) {
      console.error(e);
      setState({ isProcessing: false, progress: 0, result: null, error: "Transcoding Failed: Ensure system codecs are supported.", warning: null });
    }
  };

  const getPreview = () => {
    if (!file) return null;
    const url = URL.createObjectURL(file);
    if (file.type.startsWith('image/')) return html`<img src=${url} className="w-full h-full object-contain animate-float" />`;
    if (file.type.startsWith('video/')) return html`<video src=${url} className="w-full h-full object-contain bg-black" muted autoplay loop />`;
    return html`<div className="flex flex-col items-center gap-6"><div className="p-10 bg-blue-500/10 rounded-full border border-blue-500/20 shadow-[0_0_50px_rgba(59,130,246,0.2)] animate-pulse-slow"><${Music} size=${64} className="text-blue-500" /></div><span className="text-[10px] font-black uppercase opacity-40">${file.name}</span></div>`;
  };

  return html`
    <div className="space-y-6">
      <div className="glass rounded-[3rem] p-10 text-center animate-slide-up shadow-2xl relative overflow-hidden group">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-blue-600/10 blur-[120px] rounded-full pointer-events-none group-hover:bg-blue-600/25 transition-all duration-1000" />
        
        ${!file ? html`
          <div className="py-12 space-y-12">
            <div className="w-24 h-24 bg-zinc-900 rounded-[2.5rem] flex items-center justify-center mx-auto border border-white/5 shadow-2xl relative transition-transform hover:scale-105 duration-500">
              <div className="absolute inset-0 bg-blue-500/5 blur-3xl rounded-full" />
              <${Box} className="text-zinc-500" size=${36} />
            </div>
            <div className="space-y-6">
              <button onClick=${() => fileInputRef.current.click()} className="w-full py-6 bg-blue-600 rounded-2xl font-black text-xs uppercase tracking-widest tap-scale shadow-2xl shadow-blue-900/40 hover:bg-blue-500 transition-all duration-300 transform active:scale-95">
                Open Secure Vault
              </button>
              <p className="text-[9px] font-black uppercase tracking-[0.5em] opacity-30">Ghost Protocol v2.9.1</p>
            </div>
            <input type="file" ref=${fileInputRef} className="hidden" accept="image/*,audio/*,video/*" onChange=${e => setFile(e.target.files[0])} />
          </div>
        ` : !state.result ? html`
          <div className="space-y-10">
            <div className="aspect-square bg-black/40 rounded-[2.5rem] overflow-hidden border border-white/5 flex items-center justify-center shadow-inner relative transition-all duration-700">
              ${getPreview()}
              ${state.isProcessing && html`
                <div className="absolute inset-0 bg-black/85 backdrop-blur-3xl flex flex-col items-center justify-center p-8 z-30 animate-fade-in">
                  <${Loader2} className="animate-spin text-blue-500 mb-8" size=${48} />
                  <div className="w-full max-w-[240px] bg-zinc-900 h-2 rounded-full overflow-hidden mb-6 border border-white/5">
                    <div className="h-full bg-blue-500 transition-all duration-700 cubic-bezier(0.16, 1, 0.3, 1) shadow-[0_0_20px_rgba(59,130,246,0.9)]" style=${{ width: `${state.progress}%` }} />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-400">Titan Core Processing: ${Math.round(state.progress)}%</span>
                </div>
              `}
            </div>
            <div className="flex flex-col gap-5">
              <button onClick=${handleProcess} disabled=${state.isProcessing} className="w-full py-6 bg-blue-600 rounded-3xl font-black text-xs uppercase tracking-widest tap-scale flex items-center justify-center gap-4 shadow-2xl shadow-blue-900/40 disabled:opacity-50 hover:bg-blue-500 transition-all">
                <${Zap} size=${20} fill="currentColor" />
                ${state.isProcessing ? "Transcoding..." : "Begin Ghost Handshake"}
              </button>
              <button onClick=${() => {setFile(null); setState(s => ({...s, result: null}))}} className="text-[10px] uppercase font-black opacity-30 tracking-widest hover:opacity-100 transition-opacity">Abort Archive Selection</button>
            </div>
          </div>
        ` : html`
          <div className="space-y-8 animate-fade-in">
            <div className="bg-zinc-900/40 border border-white/5 p-8 rounded-[2.5rem] text-left relative overflow-hidden">
               <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/5 blur-[60px] rounded-full pointer-events-none" />
              <div className="flex items-center justify-between mb-8 relative z-10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center border border-blue-500/20 shadow-xl">
                    <${Activity} size=${22} className="text-blue-500" />
                  </div>
                  <div>
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-white">Transmission Profile</h3>
                    <p className="text-[9px] font-bold text-zinc-500 uppercase">${state.result.length} Packets Allocated</p>
                  </div>
                </div>
                ${state.metrics && html`
                   <div className="flex gap-6">
                     <div className="text-right">
                       <p className="text-[8px] font-black text-zinc-600 uppercase mb-1">Compression</p>
                       <p className="text-[11px] font-black text-blue-500">${state.metrics.ratio}x</p>
                     </div>
                     <div className="text-right">
                       <p className="text-[8px] font-black text-zinc-600 uppercase mb-1">Density</p>
                       <p className="text-[11px] font-black text-green-500">${state.metrics.charDensity} b/c</p>
                     </div>
                   </div>
                `}
              </div>
              
              ${state.warning && html`
                <div className=${`p-5 rounded-3xl mb-6 flex gap-4 border transition-all duration-500 ${state.warning.level === 'critical' ? 'bg-red-950/20 border-red-900/50 text-red-400' : 'bg-orange-950/20 border-orange-900/50 text-orange-400'}`}>
                   <${state.warning.level === 'critical' ? AlertCircle : AlertTriangle} size=${20} className="shrink-0" />
                   <div>
                     <p className="text-[10px] font-black uppercase tracking-widest mb-1">${state.warning.msg}</p>
                     <p className="text-[9px] font-medium leading-relaxed opacity-75">${state.warning.suggestion}</p>
                   </div>
                </div>
              `}

              <div className="bg-black/60 p-6 rounded-[2rem] border border-white/5 font-mono text-[10px] text-blue-400 h-40 overflow-y-auto break-all relative shadow-inner group/code">
                <div className=${`transition-all duration-[1.2s] ease-out ${!showRaw && 'blur-2xl select-none opacity-10 scale-95 translate-y-4'}`}>
                   ${state.result[0]}
                </div>
                ${!showRaw && html`
                  <div className="absolute inset-0 flex items-center justify-center">
                    <button onClick=${() => setShowRaw(true)} className="px-10 py-4 bg-zinc-900/90 backdrop-blur-2xl rounded-full text-[9px] font-black uppercase tracking-[0.3em] border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] tap-scale transition-all hover:bg-zinc-800 hover:border-blue-500/30">Unlock Transmission Cipher</button>
                  </div>
                `}
              </div>
            </div>

            <div className="flex gap-4">
               <button onClick=${() => setShowRaw(!showRaw)} className="p-6 bg-zinc-900 rounded-3xl text-zinc-400 border border-white/5 tap-scale hover:bg-zinc-800 transition-all"><${showRaw ? X : Eye} size=${24} /></button>
               <button onClick=${() => { navigator.clipboard.writeText(state.result[0]); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }} 
                className=${`flex-1 py-7 rounded-3xl font-black text-xs uppercase tracking-widest tap-scale transition-all shadow-2xl ${isCopied ? 'bg-green-600 text-white shadow-green-900/40' : 'bg-white text-black hover:bg-zinc-100'}`}>
                ${isCopied ? "Cipher Copied" : "Copy Volume 01"}
              </button>
            </div>
            <button onClick=${() => {setFile(null); setState({result:null, warning: null, metrics: null});}} className="text-[10px] font-black uppercase opacity-20 tracking-widest hover:opacity-100 transition-opacity">Reset Handshake</button>
          </div>
        `}
        ${state.error && html`<div className="mt-6 p-5 bg-red-950/30 border border-red-900/50 rounded-3xl text-red-500 text-[10px] font-black uppercase tracking-widest animate-pulse flex items-center justify-center gap-3"><${AlertCircle} size=${18}/> ${state.error}</div>`}
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
    } catch (e) { setError("Data Corruption in Fragment Stream"); }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInput(text);
      handleDecode(text);
    } catch (e) { setError("Permission Blocked: Clipboard Access Required"); }
  };

  return html`
    <div className="glass rounded-[3rem] p-10 animate-slide-up shadow-2xl relative group">
      <div className="absolute bottom-0 right-0 w-48 h-48 bg-blue-600/5 blur-[100px] rounded-full pointer-events-none transition-all duration-1000 group-hover:bg-blue-600/10" />
      
      ${!persistentMedia ? html`
        <div className="space-y-10 text-center">
          <div className="space-y-2">
            <h2 className="text-sm font-black uppercase tracking-[0.4em] text-white">Ghost Terminal</h2>
            <p className="text-[9px] font-black uppercase tracking-[0.5em] opacity-30">Listening for Packet Burst</p>
          </div>
          <div className="relative group/input">
            <textarea value=${input} onChange=${e => { setInput(e.target.value); handleDecode(e.target.value); }} 
              placeholder="PASTE CIPHER STRING..." 
              className="w-full h-52 bg-black/60 border border-white/5 rounded-[2.5rem] p-10 font-mono text-[12px] text-blue-400 focus:border-blue-500/30 outline-none transition-all duration-500 shadow-inner leading-relaxed resize-none group-focus-within/input:border-blue-500/40" />
            <button onClick=${handlePaste} className="absolute bottom-6 right-6 p-4 bg-zinc-900 rounded-2xl text-zinc-400 border border-white/10 tap-scale hover:bg-zinc-800 transition-colors shadow-2xl">
               <${ClipboardPaste} size=${20} />
            </button>
          </div>
          ${persistentChunks.size > 0 && html`
            <div className="bg-blue-600/5 border border-blue-500/20 p-8 rounded-[2.5rem] flex flex-col gap-6 animate-fade-in shadow-inner relative overflow-hidden">
               <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />
              <div className="flex justify-between items-center px-2">
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-400">Syncing Data Planes</span>
                <span className="text-[11px] font-bold text-white bg-blue-600 px-5 py-1.5 rounded-full border border-blue-400/30 shadow-2xl shadow-blue-900/40 transition-transform hover:scale-105">${persistentChunks.size} Sync'd</span>
              </div>
              <div className="h-2 bg-zinc-900 rounded-full overflow-hidden relative border border-white/5 shadow-inner">
                <div className="h-full bg-blue-500 w-full animate-shimmer bg-gradient-to-r from-blue-600 via-blue-200 to-blue-600 bg-[length:200%_100%] shadow-[0_0_20px_rgba(59,130,246,0.6)]" />
              </div>
            </div>
          `}
          <button onClick=${() => { setPersistentChunks(new Map()); setInput(""); setError(null); }} className="text-[9px] font-black uppercase opacity-20 hover:opacity-100 transition-opacity tracking-[0.5em] py-2">Purge Local Memory</button>
        </div>
      ` : html`
        <div className="space-y-12 text-center animate-fade-in">
          <div className="aspect-square bg-black/60 rounded-[3rem] overflow-hidden border border-white/5 flex items-center justify-center shadow-inner relative group/media">
             <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover/media:opacity-100 transition-opacity duration-1000" />
             ${persistentMedia.type === 'I' ? html`<img src=${persistentMedia.url} className="w-full h-full object-contain p-8 group-hover/media:scale-[1.03] transition-transform duration-[2s] cubic-bezier(0.16, 1, 0.3, 1)" />` : 
               persistentMedia.type === 'V' ? html`<video controls src=${persistentMedia.url} className="w-full h-full object-contain bg-black shadow-2xl" />` : 
               html`
                <div className="w-full p-16">
                  <div className="w-32 h-32 bg-blue-600/10 rounded-full flex items-center justify-center mx-auto mb-10 border border-blue-500/20 shadow-2xl animate-pulse-slow">
                    <${Music} size={56} className="text-blue-500" />
                  </div>
                  <audio controls src=${persistentMedia.url} className="w-full custom-audio" />
                </div>
             `}
          </div>
          <div className="flex flex-col gap-5">
             <a href=${persistentMedia.url} download=${`TITAN_RECOVERY_${Date.now()}.${persistentMedia.extension}`}
               className="w-full py-8 bg-blue-600 rounded-[2rem] font-black text-xs uppercase tracking-widest flex items-center justify-center gap-5 tap-scale shadow-2xl shadow-blue-900/40 hover:bg-blue-500 transition-all transform active:scale-95">
               <${Download} size=${26} /> Reconstruct Payload
             </a>
             <button onClick=${() => { setPersistentChunks(new Map()); setPersistentMedia(null); setInput(""); }} className="text-[10px] font-black uppercase tracking-widest opacity-20 hover:opacity-100 transition-opacity py-2">Reset Receiver Circuit</button>
          </div>
        </div>
      `}
      ${error && html`<div className="mt-8 p-6 bg-red-950/30 border border-red-900/50 rounded-3xl text-red-500 text-[11px] font-black uppercase tracking-widest text-center animate-bounce-slow flex items-center justify-center gap-4"><${AlertCircle} size=${20} /> ${error}</div>`}
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
    <div className="min-h-screen bg-[#020202] text-white flex flex-col font-sans selection:bg-blue-600/45 antialiased">
      <header className="p-8 border-b border-white/5 flex justify-between items-center bg-black/70 backdrop-blur-3xl sticky top-0 z-50">
        <div className="flex items-center gap-5">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center rotate-6 shadow-[0_10px_40px_rgba(37,99,235,0.3)] border border-white/10 group transition-transform duration-700 hover:rotate-[-6deg]"><${Shield} size=${26} /></div>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight leading-none">Ghost<span className="text-blue-500">Comm</span></h1>
            <span className="text-[8px] font-black opacity-30 uppercase tracking-[0.8em]">Titan Protocol v2.9.5 Stable</span>
          </div>
        </div>
        <div className="w-12 h-12 rounded-full bg-zinc-900 border border-white/5 flex items-center justify-center cursor-pointer tap-scale hover:bg-zinc-800 transition-colors shadow-inner"><${Settings} size=${20} className="text-zinc-600" /></div>
      </header>

      <main className="flex-1 p-8 max-w-xl mx-auto w-full">
        <div className="flex bg-zinc-900/40 p-2 rounded-[2.2rem] border border-white/5 mb-12 relative overflow-hidden shadow-2xl group/tabs">
          <div className=${`absolute top-2 bottom-2 left-2 w-[calc(50%-8px)] bg-zinc-800 rounded-2xl transition-transform duration-700 cubic-bezier(0.16, 1, 0.3, 1) shadow-xl border border-white/10 ${tab === 'decode' ? 'translate-x-full' : 'translate-x-0'}`} />
          <button onClick=${() => setTab('encode')} className=${`flex-1 py-5 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all relative z-10 ${tab === 'encode' ? 'text-white' : 'text-zinc-500'}`}>Assemble</button>
          <button onClick=${() => setTab('decode')} className=${`flex-1 py-5 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all relative z-10 ${tab === 'decode' ? 'text-white' : 'text-zinc-500'}`}>Reconstruct</button>
        </div>

        <div className="transition-all duration-1000 transform">
          ${tab === 'encode' ? html`<${EncodingView} persistentResult=${encodedResult} setPersistentResult=${setEncodedResult} persistentFile=${lastFile} setPersistentFile=${setLastFile} />` : 
          html`<${DecodingView} persistentChunks=${chunks} setPersistentChunks=${setChunks} persistentMedia=${media} setPersistentMedia=${setMedia} />`}
        </div>
      </main>

      <footer className="p-10 border-t border-white/5 text-center flex flex-col gap-6">
        <div className="flex items-center justify-center gap-10 mb-2 opacity-[0.03] transition-opacity hover:opacity-20 duration-1000 cursor-default">
          <${Layers} size=${18} />
          <${Cpu} size=${18} />
          <${Hash} size=${18} />
          <${AudioLines} size=${18} />
        </div>
        <span className="text-[10px] font-black uppercase tracking-[0.7em] opacity-20">Secure Titan Terminal • Encrypted Fragment Host</span>
        <span className="text-[8px] font-black uppercase tracking-[0.5em] opacity-10">Optimized for Low-Bandwidth Satellite Links</span>
      </footer>

      <style>
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .animate-shimmer { animation: shimmer 2.5s infinite linear; }
        @keyframes float { 0% { transform: translateY(0); } 50% { transform: translateY(-12px); } 100% { transform: translateY(0); } }
        .animate-float { animation: float 5s infinite cubic-bezier(0.4, 0, 0.2, 1); }
        @keyframes pulseSlow { 0% { opacity: 0.1; } 50% { opacity: 0.3; } 100% { opacity: 0.1; } }
        .animate-pulse-slow { animation: pulseSlow 4s infinite ease-in-out; }
        @keyframes bounceSlow { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        .animate-bounce-slow { animation: bounceSlow 3s infinite ease-in-out; }
        .custom-audio::-webkit-media-controls-panel { background-color: rgba(255, 255, 255, 0.03); }
        .custom-audio::-webkit-media-controls-play-button { filter: invert(0.8); }
        .custom-scrollbar::-webkit-scrollbar { width: 0; }
        input[type="file"]::file-selector-button { display: none; }
        * { -webkit-tap-highlight-color: transparent; }
      </style>
    </div>
  `;
};

const root = createRoot(document.getElementById('root'));
root.render(html`<${App} />`);
