
import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import { 
  Shield, Share2, Download, Terminal, Settings, Box, Mic, Trash2, 
  Loader2, Zap, StopCircle, CheckCircle, Copy, Eye, AlertCircle, 
  Play, Pause, Volume2, Activity, Keyboard, ClipboardPaste, Music, 
  CheckCircle2, X 
} from 'lucide-react';

const html = htm.bind(React.createElement);

// --- ENCODING ALPHABET GENERATION ---
const generateAlphabet = () => {
  let chars = "";
  // 1. All printable ASCII (33 to 126) EXCLUDING ':' (58) to avoid delimiter split issues
  for (let i = 33; i <= 126; i++) {
    if (i !== 58) chars += String.fromCharCode(i);
  }
  
  // 2. Extended Latin and common symbols (161 to 1024)
  for (let i = 161; i <= 1024; i++) {
    chars += String.fromCharCode(i);
  }

  // 3. Mathematical Operators & Misc Symbols (0x2100 to 0x2BFF)
  for (let i = 0x2100; i <= 0x2BFF; i++) chars += String.fromCharCode(i);

  // 4. CJK Unified Ideographs
  let current = 0x4E00;
  while (chars.length < 32768) {
    chars += String.fromCharCode(current++);
  }
  return chars;
};

const ALPHABET = generateAlphabet();
const DECODE_MAP = new Map(Array.from(ALPHABET).map((c, i) => [c, i]));
const ALPHABET_SET = new Set(ALPHABET);

const MediaType = { IMAGE: 'I', AUDIO: 'A', VIDEO: 'V' };

// --- SERVICES ---
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

const processMedia = async (file, type) => {
  if (type === MediaType.IMAGE) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(800 / img.width, 1);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(async b => resolve(new Uint8Array(await b.arrayBuffer())), 'image/webp', 0.25);
      };
      img.src = URL.createObjectURL(file);
    });
  }
  return new Uint8Array(await file.arrayBuffer());
};

const createVolumes = (type, encodedText, maxChars) => {
  const headerEstimate = 50;
  const effectiveSize = maxChars - headerEstimate;
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
    for (const char of rawPayload) {
      if (ALPHABET_SET.has(char)) cleanedPayload += char;
    }
    if (calculateChecksum(cleanedPayload) !== checksum) return null;
    return { type, total, index, checksum, payload: cleanedPayload };
  }).filter(c => c !== null);
};

// --- UI COMPONENTS ---

const EncodingView = ({ persistentResult, setPersistentResult, persistentFile, setPersistentFile }) => {
  const [file, setFile] = useState(persistentFile);
  const [state, setState] = useState({ isProcessing: false, result: persistentResult, error: null });
  const [isCopied, setIsCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => setPersistentFile(file), [file]);
  useEffect(() => setPersistentResult(state.result), [state.result]);

  const handleProcess = async () => {
    setState(s => ({ ...s, isProcessing: true }));
    try {
      const type = file.type.startsWith('audio/') ? MediaType.AUDIO : MediaType.IMAGE;
      const raw = await processMedia(file, type);
      const compressed = await compressBytes(raw);
      const encoded = encodeBase32768(compressed);
      const volumes = createVolumes(type, encoded, 15000); // 15k is the sweet spot for most messengers
      setState({ isProcessing: false, result: volumes, error: null });
    } catch (e) {
      setState({ isProcessing: false, result: null, error: "Encoding Failed" });
    }
  };

  return html`
    <div className="space-y-6">
      <div className="glass rounded-[2rem] p-8 text-center animate-slide-up">
        ${!file ? html`
          <div className="py-10 space-y-8">
            <div className="w-20 h-20 bg-blue-600/10 rounded-full flex items-center justify-center mx-auto border border-blue-500/20">
              <${Box} className="text-blue-500" size=${32} />
            </div>
            <button onClick=${() => fileInputRef.current.click()} className="w-full py-5 bg-blue-600 rounded-2xl font-black text-xs uppercase tracking-widest tap-scale shadow-xl shadow-blue-900/20">
              Select Media File
            </button>
            <input type="file" ref=${fileInputRef} className="hidden" onChange=${e => setFile(e.target.files[0])} />
          </div>
        ` : !state.result ? html`
          <div className="space-y-6">
            <div className="aspect-square bg-black rounded-2xl overflow-hidden border border-white/5 flex items-center justify-center">
              ${file.type.startsWith('image/') ? html`<img src=${URL.createObjectURL(file)} className="w-full h-full object-contain" />` : html`<${Volume2} size=${48} className="text-blue-500" />`}
            </div>
            <button onClick=${handleProcess} disabled=${state.isProcessing} className="w-full py-5 bg-blue-600 rounded-2xl font-black text-xs uppercase tracking-widest tap-scale flex items-center justify-center gap-2 shadow-xl shadow-blue-900/20">
              ${state.isProcessing ? html`<${Loader2} className="animate-spin" />` : html`<${Zap} size=${18} fill="currentColor" />`}
              ${state.isProcessing ? "Processing..." : "Encode Data"}
            </button>
            <button onClick=${() => setFile(null)} className="text-[10px] uppercase font-black opacity-40">Cancel</button>
          </div>
        ` : html`
          <div className="space-y-6">
            <div className="bg-black p-4 rounded-xl font-mono text-[9px] text-blue-400 break-all h-40 overflow-y-auto border border-white/5 text-left leading-relaxed ${!showRaw && 'blur-sm select-none opacity-30'} transition-all">
              ${state.result[0]}
            </div>
            <div className="flex gap-2">
               <button onClick=${() => setShowRaw(!showRaw)} className="p-4 bg-zinc-900 rounded-2xl text-zinc-400 border border-white/5"><${showRaw ? Eye : X} size=${18} /></button>
               <button onClick=${() => { navigator.clipboard.writeText(state.result[0]); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }} 
                className=${`flex-1 py-6 rounded-2xl font-black text-xs uppercase tracking-widest tap-scale transition-all shadow-2xl ${isCopied ? 'bg-green-600' : 'bg-white text-black'}`}>
                ${isCopied ? "Success" : "Copy Packet"}
              </button>
            </div>
            <button onClick=${() => {setFile(null); setState({result:null});}} className="text-[10px] font-black uppercase opacity-40">New Session</button>
          </div>
        `}
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
        const ext = first.type === 'A' ? 'webm' : 'webp';
        const blob = new Blob([raw], { type: first.type === 'A' ? 'audio/webm' : 'image/webp' });
        setPersistentMedia({ type: first.type, url: URL.createObjectURL(blob), extension: ext });
      }
    } catch (e) { setError("Data Mismatch: Check Packet Integrity"); }
  };

  return html`
    <div className="glass rounded-[2.5rem] p-8 animate-slide-up">
      ${!persistentMedia ? html`
        <div className="space-y-6 text-center">
          <h2 className="text-sm font-black uppercase tracking-widest text-zinc-500">Decryption Terminal</h2>
          <textarea value=${input} onChange=${e => { setInput(e.target.value); handleDecode(e.target.value); }} 
            placeholder="PASTE BUFFER HERE..." 
            className="w-full h-44 bg-black border border-white/5 rounded-3xl p-6 font-mono text-[11px] text-blue-400 focus:border-blue-500/30 outline-none transition-all" />
          ${persistentChunks.size > 0 && html`
            <div className="bg-blue-600/10 border border-blue-500/20 p-4 rounded-2xl flex justify-between items-center animate-pulse">
              <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">Syncing Packet Streams</span>
              <span className="text-xs font-bold text-white">${persistentChunks.size} Chunks</span>
            </div>
          `}
        </div>
      ` : html`
        <div className="space-y-8 text-center">
          <div className="aspect-square bg-black rounded-[2rem] overflow-hidden border border-white/5 flex items-center justify-center shadow-inner">
             ${persistentMedia.type === 'I' ? html`<img src=${persistentMedia.url} className="w-full h-full object-contain" />` : html`
                <div className="w-full p-8">
                  <${Music} size=${48} className="mx-auto mb-6 text-blue-500" />
                  <audio controls src=${persistentMedia.url} className="w-full" />
                </div>
             `}
          </div>
          
          <div className="space-y-4">
            <a href=${persistentMedia.url} download=${`GHOST_COMM_${Date.now()}.${persistentMedia.extension}`} 
              className="w-full py-6 bg-blue-600 rounded-3xl text-[11px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-3 tap-scale shadow-2xl shadow-blue-900/30 transition-all border-b-4 border-blue-800">
              <${Download} size=${20} /> Save to Device
            </a>
            
            <button onClick=${() => { setPersistentChunks(new Map()); setPersistentMedia(null); setInput(""); }} 
              className="w-full py-4 bg-zinc-900 rounded-2xl text-[9px] font-black uppercase tracking-widest tap-scale border border-white/10 opacity-60">
              Clear Workspace
            </button>
          </div>
        </div>
      `}
      ${error && html`<div className="mt-4 text-red-500 text-[10px] font-black uppercase text-center flex items-center justify-center gap-2"><${AlertCircle} size=${14} /> ${error}</div>`}
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
    <div className="min-h-screen bg-[#050505] text-white flex flex-col font-sans">
      <header className="p-6 border-b border-white/5 flex justify-between items-center bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center rotate-3 shadow-lg shadow-blue-900/40"><${Shield} size=${20} /></div>
          <div>
            <h1 className="text-sm font-black uppercase tracking-tighter leading-none">Ghost<span className="text-blue-500">Comm</span></h1>
            <span className="text-[7px] font-black opacity-30 uppercase tracking-[0.4em]">Protocol Stable v1.7.1</span>
          </div>
        </div>
        <div className="w-8 h-8 rounded-full bg-zinc-900 border border-white/5 flex items-center justify-center"><${Settings} size={14} className="text-zinc-500" /></div>
      </header>

      <main className="flex-1 p-6 max-w-lg mx-auto w-full">
        <div className="flex bg-zinc-900/40 p-1.5 rounded-2xl border border-white/5 mb-8">
          <button onClick=${() => setTab('encode')} className=${`flex-1 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tab === 'encode' ? 'bg-zinc-800 text-white shadow-xl' : 'text-zinc-500'}`}>Encode</button>
          <button onClick=${() => setTab('decode')} className=${`flex-1 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tab === 'decode' ? 'bg-zinc-800 text-white shadow-xl' : 'text-zinc-500'}`}>Decode</button>
        </div>

        <div className="animate-fade-in relative">
          ${tab === 'encode' ? html`
            <${EncodingView} 
              persistentResult=${encodedResult} 
              setPersistentResult=${setEncodedResult} 
              persistentFile=${lastFile} 
              setPersistentFile=${setLastFile} />
          ` : html`
            <${DecodingView} 
              persistentChunks=${chunks} 
              setPersistentChunks=${setChunks} 
              persistentMedia=${media} 
              setPersistentMedia=${setMedia} />
          `}
        </div>
      </main>

      <footer className="p-6 border-t border-white/5 text-center opacity-20">
        <span className="text-[8px] font-black uppercase tracking-[0.5em]">Secure Terminal • No Internet Required</span>
      </footer>
    </div>
  `;
};

const root = createRoot(document.getElementById('root'));
root.render(html`<${App} />`);
