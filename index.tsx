
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom';
import { 
  Shield, Share2, Download, Terminal, Settings, Box, Mic, Trash2, 
  Loader2, Zap, StopCircle, CheckCircle, Copy, Eye, AlertCircle, 
  Play, Pause, Volume2, Activity, Keyboard, ClipboardPaste, Music, 
  CheckCircle2, X 
} from 'lucide-react';

// --- CONSTANTS & TYPES ---
const MediaType = { IMAGE: 'I', AUDIO: 'A', VIDEO: 'V' };
const START_CHAR = 0x4E00;
const ALPHABET_SIZE = 32768;
const MESSENGER_LIMITS = [
  { id: 'safe', name: 'Safe (4k)', maxChars: 4000 },
  { id: 'high', name: 'Fast (15k)', maxChars: 15000 },
  { id: 'titan', name: 'Titan (64k)', maxChars: 64000 }
];

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
  const combined = new Uint8Array(lengthHeader.length + data.length);
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

const processMedia = async (file, type) => {
  if (type === MediaType.IMAGE) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(600 / img.width, 1);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(async b => resolve(new Uint8Array(await b.arrayBuffer())), 'image/webp', 0.2);
      };
      img.src = URL.createObjectURL(file);
    });
  }
  return new Uint8Array(await file.arrayBuffer());
};

const createVolumes = (type, encodedText, maxChars) => {
  const effectiveSize = maxChars - 40;
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
    const payload = parts.slice(4).join(":");
    return { type: parts[0], total: parseInt(parts[1]), index: parseInt(parts[2]), checksum: parts[3], payload };
  }).filter(c => c !== null);
};

// --- COMPONENTS ---

const EncodingView = ({ persistentResult, setPersistentResult, persistentFile, setPersistentFile }) => {
  const [file, setFile] = useState(persistentFile);
  const [isRecording, setIsRecording] = useState(false);
  const [state, setState] = useState({ isProcessing: false, result: persistentResult, error: null });
  const [isCopied, setIsCopied] = useState(false);
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
      const volumes = createVolumes(type, encoded, 15000);
      setState({ isProcessing: false, result: volumes, error: null });
    } catch (e) {
      setState({ isProcessing: false, result: null, error: "Encoding Failed" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass rounded-[2rem] p-8 text-center animate-slide-up">
        {!file && !isRecording ? (
          <div className="py-10 space-y-8">
            <div className="w-20 h-20 bg-blue-600/10 rounded-full flex items-center justify-center mx-auto border border-blue-500/20">
              <Box className="text-blue-500" size={32} />
            </div>
            <div className="flex gap-4">
              <button onClick={() => fileInputRef.current.click()} className="flex-1 py-4 bg-zinc-900 rounded-2xl font-bold text-[10px] uppercase tracking-widest border border-white/5 tap-scale">Select File</button>
              <button onClick={() => setIsRecording(true)} className="flex-1 py-4 bg-blue-600 rounded-2xl font-bold text-[10px] uppercase tracking-widest tap-scale">Mic Record</button>
            </div>
            <input type="file" ref={fileInputRef} className="hidden" onChange={e => setFile(e.target.files[0])} />
          </div>
        ) : file && !state.result ? (
          <div className="space-y-6">
            <div className="aspect-square bg-black rounded-2xl overflow-hidden border border-white/5">
              {file.type.startsWith('image/') ? <img src={URL.createObjectURL(file)} className="w-full h-full object-contain" /> : <div className="flex items-center justify-center h-full"><Volume2 size={48} /></div>}
            </div>
            <button onClick={handleProcess} disabled={state.isProcessing} className="w-full py-5 bg-blue-600 rounded-2xl font-black text-xs uppercase tracking-widest tap-scale flex items-center justify-center gap-2">
              {state.isProcessing ? <Loader2 className="animate-spin" /> : <Zap size={18} fill="currentColor" />}
              {state.isProcessing ? "Processing..." : "Encode Data"}
            </button>
          </div>
        ) : state.result ? (
          <div className="space-y-6">
            <div className="bg-black p-4 rounded-xl font-mono text-[9px] text-blue-400 break-all h-32 overflow-y-auto border border-white/5">
              {state.result[0]}
            </div>
            <button onClick={() => { navigator.clipboard.writeText(state.result[0]); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }} className={`w-full py-5 rounded-2xl font-black text-xs uppercase tracking-widest tap-scale transition-colors ${isCopied ? 'bg-green-600' : 'bg-white text-black'}`}>
              {isCopied ? "Copied!" : "Copy Packet"}
            </button>
            <button onClick={() => {setFile(null); setState({result:null});}} className="text-[9px] text-zinc-500 uppercase tracking-widest font-black">Reset</button>
          </div>
        ) : null}
      </div>
    </div>
  );
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
      
      if (newMap.size >= chunks[0].total) {
        // Fix: Added type casting to avoid "unknown" property access errors in TSX environment for Map values
        const sorted = (Array.from(newMap.values()) as any[]).sort((a: any, b: any) => a.index - b.index);
        // Fix: Added type casting to ensure the mapped items are accessible as any to avoid "unknown" type errors
        const fullPayload = (sorted as any[]).map((c: any) => c.payload).join('');
        const compressed = decodeBase32768(fullPayload);
        const raw = await decompressBytes(compressed);
        const blob = new Blob([raw], { type: chunks[0].type === 'A' ? 'audio/webm' : 'image/webp' });
        setPersistentMedia({ type: chunks[0].type, url: URL.createObjectURL(blob) });
      }
    } catch (e) { setError("Corruption Detected"); }
  };

  return (
    <div className="glass rounded-[2rem] p-8 animate-slide-up">
      {!persistentMedia ? (
        <div className="space-y-6 text-center">
          <h2 className="text-lg font-bold uppercase tracking-widest">Receive Terminal</h2>
          <textarea value={input} onChange={e => { setInput(e.target.value); handleDecode(e.target.value); }} placeholder="PASTE PACKET HERE..." className="w-full h-40 bg-black border border-white/5 rounded-2xl p-4 font-mono text-[10px] text-blue-400 focus:border-blue-500/50 outline-none" />
          {persistentChunks.size > 0 && <div className="text-[10px] font-black text-blue-500 uppercase">Packets: {persistentChunks.size} Synced</div>}
        </div>
      ) : (
        <div className="space-y-8 text-center">
          <div className="aspect-square bg-black rounded-2xl overflow-hidden">
             {persistentMedia.type === 'I' ? <img src={persistentMedia.url} className="w-full h-full object-contain" /> : <audio controls src={persistentMedia.url} className="w-full mt-20" />}
          </div>
          <button onClick={() => { setPersistentChunks(new Map()); setPersistentMedia(null); }} className="w-full py-4 bg-zinc-900 rounded-xl text-[10px] font-black uppercase tracking-widest tap-scale">Clear and Restart</button>
        </div>
      )}
    </div>
  );
};

const App = () => {
  const [tab, setTab] = useState('encode');
  const [encodedResult, setEncodedResult] = useState(null);
  const [lastFile, setLastFile] = useState(null);
  const [chunks, setChunks] = useState(new Map());
  const [media, setMedia] = useState(null);

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col font-sans">
      <header className="p-6 border-b border-white/5 flex justify-between items-center bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center rotate-3 shadow-lg shadow-blue-900/20"><Shield size={18} /></div>
          <h1 className="text-sm font-black uppercase tracking-tighter">Ghost<span className="text-blue-500">Comm</span></h1>
        </div>
        <div className="w-8 h-8 rounded-full bg-zinc-900 border border-white/5 flex items-center justify-center"><Settings size={14} className="text-zinc-500" /></div>
      </header>

      <main className="flex-1 p-6 max-w-lg mx-auto w-full">
        <div className="flex bg-zinc-900/50 p-1 rounded-2xl border border-white/5 mb-8">
          <button onClick={() => setTab('encode')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tab === 'encode' ? 'bg-zinc-800 text-white shadow-xl' : 'text-zinc-500'}`}>Encode</button>
          <button onClick={() => setTab('decode')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tab === 'decode' ? 'bg-zinc-800 text-white shadow-xl' : 'text-zinc-500'}`}>Decode</button>
        </div>

        {tab === 'encode' ? (
          <EncodingView persistentResult={encodedResult} setPersistentResult={setEncodedResult} persistentFile={lastFile} setPersistentFile={setLastFile} />
        ) : (
          <DecodingView persistentChunks={chunks} setPersistentChunks={setChunks} persistentMedia={media} setPersistentMedia={setMedia} />
        )}
      </main>

      <footer className="p-4 border-t border-white/5 text-center opacity-30">
        <span className="text-[8px] font-black uppercase tracking-[0.4em]">Secure Offline Protocol v1.5</span>
      </footer>
    </div>
  );
};

const root = createRoot(document.getElementById('root'));
root.render(<App />);
