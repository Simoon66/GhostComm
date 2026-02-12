import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import * as Lucide from 'lucide-react';

const html = htm.bind(React.createElement);
const { 
  Shield, Download, Zap, Copy, Eye, AlertCircle, Music, X, 
  Settings, Trash2, Play, Pause, Activity, Video, Share2, 
  ClipboardPaste, Cpu, Hash, Layers, AudioLines, Fingerprint, 
  Plus, RefreshCcw, CheckCircle2, ChevronRight, Mic, StopCircle, Loader2
} = Lucide;

// --- PROTOCOL CORE ---
const START_CHAR = 0x4E00; 
const ALPHABET_SIZE = 32768;
const MediaType = { IMAGE: 'I', AUDIO: 'A', VIDEO: 'V' };
const MAX_CHUNK_SIZE = 15000; // Messenger safe limit

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
  new DataView(lengthHeader.buffer).setUint32(0, data.length);
  const combined = new Uint8Array(4 + data.length);
  combined.set(lengthHeader);
  combined.set(data, 4);
  
  for (let i = 0; i < combined.length; i++) {
    buffer = (buffer << 8) | combined[i];
    bitsInBuffer += 8;
    while (bitsInBuffer >= 15) {
      bitsInBuffer -= 15;
      encoded += String.fromCharCode(START_CHAR + ((buffer >> bitsInBuffer) & 0x7FFF));
    }
  }
  if (bitsInBuffer > 0) encoded += String.fromCharCode(START_CHAR + ((buffer << (15 - bitsInBuffer)) & 0x7FFF));
  return encoded;
};

const decodeBase32768 = (str) => {
  const indices = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= START_CHAR && code < START_CHAR + ALPHABET_SIZE) indices.push(code - START_CHAR);
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
  const originalLength = new DataView(fullData.buffer).getUint32(0);
  return fullData.slice(4, 4 + originalLength);
};

// --- TURBO MEDIA ENGINES ---
const turboImage = async (file) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(480 / img.width, 1);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async b => resolve(new Uint8Array(await b.arrayBuffer())), 'image/webp', 0.4);
    };
    img.src = URL.createObjectURL(file);
  });
};

const turboVideo = async (file, onProgress) => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const sourceUrl = URL.createObjectURL(file);
    video.src = sourceUrl;
    video.muted = false; 
    video.volume = 0;    
    video.playsInline = true;
    
    video.onloadedmetadata = () => {
      const canvas = document.createElement('canvas');
      const targetWidth = 240;
      canvas.width = targetWidth;
      canvas.height = (video.videoHeight / video.videoWidth) * targetWidth;
      const ctx = canvas.getContext('2d');
      const canvasStream = canvas.captureStream(10); 
      
      let combinedStream;
      try {
        const videoStream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
        combinedStream = new MediaStream([
          canvasStream.getVideoTracks()[0],
          ...videoStream.getAudioTracks()
        ]);
      } catch (e) {
        combinedStream = canvasStream;
      }

      const recorder = new MediaRecorder(combinedStream, { 
        mimeType: 'video/webm;codecs=vp8,opus', 
        videoBitsPerSecond: 64000,
        audioBitsPerSecond: 16000 
      });
      
      const chunks = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = async () => {
        resolve(new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()));
        URL.revokeObjectURL(sourceUrl);
      };

      video.play();
      recorder.start();
      
      const draw = () => {
        if (video.currentTime >= video.duration - 0.1) { 
          recorder.stop(); 
          return; 
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (onProgress) onProgress((video.currentTime / video.duration) * 100);
        requestAnimationFrame(draw);
      };
      draw();
    };
    video.onerror = reject;
  });
};

const turboAudio = async (file) => {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await audioCtx.decodeAudioData(await file.arrayBuffer());
  const sampleRate = 22050; // Enhanced sample rate
  const offlineCtx = new OfflineAudioContext(1, Math.min(decoded.duration, 30) * sampleRate, sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();
  const i16 = new Int16Array(rendered.length);
  const f32 = rendered.getChannelData(0);
  for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-1, Math.min(1, f32[i])) * 32767;
  return new Uint8Array(i16.buffer);
};

const compress = async (data) => {
  const stream = new ReadableStream({ start(c) { c.enqueue(data); c.close(); } }).pipeThrough(new CompressionStream('deflate'));
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
};

const decompress = async (data) => {
  const stream = new ReadableStream({ start(c) { c.enqueue(data); c.close(); } }).pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
};

// --- COMPONENTS ---

const ActionButton = ({ onClick, children, variant = 'primary', className = '', disabled = false }) => {
  const variants = {
    primary: "bg-indigo-600 text-white shadow-[0_0_20px_rgba(99,102,241,0.2)] active:bg-indigo-700",
    secondary: "bg-zinc-800/50 text-zinc-400 border border-white/5 active:bg-zinc-700",
    danger: "bg-red-500/10 text-red-500 border border-red-500/20 active:bg-red-500/20"
  };
  return html`
    <button onClick=${onClick} disabled=${disabled} className=${`h-10 px-4 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 tap-scale transition-all ${variants[variant]} ${disabled ? 'opacity-30' : ''} ${className}`}>
      ${children}
    </button>
  `;
};

const EncodingView = ({ persistentResult, setPersistentResult, persistentFile, setPersistentFile }) => {
  const [file, setFile] = useState(persistentFile);
  const [isRecording, setIsRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [state, setState] = useState({ processing: false, stage: 'IDLE', progress: 0, result: persistentResult });
  const [copiedIndex, setCopiedIndex] = useState(null);
  
  const fileRef = useRef();
  const mediaRecorderRef = useRef(null);
  const timerRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => setPersistentFile(file), [file]);
  useEffect(() => setPersistentResult(state.result), [state.result]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = e => audioChunksRef.current.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setFile(new File([blob], `RECORD_${Date.now()}.webm`, { type: 'audio/webm' }));
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start();
      setIsRecording(true);
      setRecordTime(0);
      timerRef.current = setInterval(() => setRecordTime(t => t + 1), 1000);
    } catch (e) { console.error(e); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
    setIsRecording(false);
    clearInterval(timerRef.current);
  };

  const run = async () => {
    if (!file) return;
    setState(s => ({ ...s, processing: true, stage: 'TRANSCODING', progress: 5 }));
    try {
      let raw;
      const type = file.type.startsWith('video/') ? MediaType.VIDEO : (file.type.startsWith('audio/') ? MediaType.AUDIO : MediaType.IMAGE);
      
      if (type === MediaType.VIDEO) raw = await turboVideo(file, p => setState(s => ({ ...s, progress: p })));
      else if (type === MediaType.AUDIO) raw = await turboAudio(file);
      else raw = await turboImage(file);

      setState(s => ({ ...s, stage: 'COMPRESSING', progress: 100 }));
      const compressed = await compress(raw);
      
      setState(s => ({ ...s, stage: 'ENCODING', progress: 100 }));
      const encoded = encodeBase32768(compressed);
      
      // Multi-volume chunking for videos
      const volumes = [];
      const total = Math.ceil(encoded.length / MAX_CHUNK_SIZE);
      for(let i = 0; i < total; i++) {
        const payload = encoded.substring(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE);
        volumes.push(`GC:${type}:${total}:${i}:${calculateChecksum(payload)}:${payload}`);
      }
      
      setState({ processing: false, stage: 'DONE', progress: 100, result: volumes });
    } catch (e) {
      console.error(e);
      setState(s => ({ ...s, processing: false, stage: 'ERROR', progress: 0 }));
    }
  };

  return html`
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="obsidian-glass rounded-2xl p-4 overflow-hidden relative">
        ${isRecording ? html`
          <div className="py-12 flex flex-col items-center gap-6 animate-pulse">
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center border border-red-500/40">
               <div className="w-4 h-4 bg-red-500 rounded-full" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-2xl font-black tabular-nums text-white">${Math.floor(recordTime / 60)}:${(recordTime % 60).toString().padStart(2, '0')}</p>
              <p className="text-[8px] font-bold text-red-500 uppercase tracking-widest">Recording Signal...</p>
            </div>
            <${ActionButton} onClick=${stopRecording} variant="danger" className="w-full">
               <${StopCircle} size=${16} /> Stop Recording
            <//>
          </div>
        ` : !file ? html`
          <div className="py-12 flex flex-col items-center gap-6">
            <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-white/5 flex items-center justify-center shadow-inner">
              <${Plus} size=${20} className="text-zinc-600" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Ghost Uplink</p>
              <p className="text-[9px] font-medium text-zinc-500 uppercase tracking-widest text-balance">Select or record asset</p>
            </div>
            <div className="flex gap-2 w-full">
               <${ActionButton} onClick=${() => fileRef.current.click()} className="flex-1">
                  Pick File <${ChevronRight} size=${12} />
               <//>
               <${ActionButton} onClick=${startRecording} variant="secondary" className="w-12 px-0"><${Mic} size=${16} /><//>
            </div>
            <input type="file" ref=${fileRef} className="hidden" onChange=${e => setFile(e.target.files[0])} />
          </div>
        ` : !state.result ? html`
          <div className="space-y-4">
            <div className="aspect-video w-full bg-black/40 rounded-xl border border-white/5 flex items-center justify-center relative overflow-hidden group">
               ${state.processing && html`
                 <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-20 flex flex-col items-center justify-center gap-3">
                    <${Loader2} className="text-indigo-500 animate-spin" size=${32} />
                    <div className="text-center">
                       <p className="text-[8px] font-black text-indigo-400 uppercase tracking-[0.3em] mb-1">${state.stage}</p>
                       <p className="text-xl font-black text-white">${Math.round(state.progress)}%</p>
                    </div>
                    <div className="w-32 h-1 bg-zinc-900 rounded-full overflow-hidden">
                       <div className="h-full bg-indigo-600 transition-all duration-300" style=${{width: `${state.progress}%`}} />
                    </div>
                 </div>
               `}
               ${file.type.startsWith('image/') ? html`<img src=${URL.createObjectURL(file)} className="w-full h-full object-contain p-2" />` :
                 file.type.startsWith('video/') ? html`<video src=${URL.createObjectURL(file)} className="w-full h-full object-contain" muted />` :
                 html`<div className="flex flex-col items-center gap-2"><${Music} className="text-indigo-500" size=${40} /><p className="text-[9px] text-zinc-600 font-bold uppercase truncate max-w-[120px]">${file.name}</p></div>`
               }
            </div>
            <div className="flex gap-2">
               <${ActionButton} onClick=${run} disabled=${state.processing} className="flex-1">Transform Asset<//>
               <${ActionButton} onClick=${() => setFile(null)} variant="secondary" className="w-10 px-0"><${X} size=${16} /><//>
            </div>
          </div>
        ` : html`
          <div className="space-y-4">
             <div className="flex justify-between items-center">
                <span className="text-[8px] font-black text-indigo-500 uppercase tracking-widest">${state.result.length} Volumes Generated</span>
             </div>
             <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
                ${state.result.map((v, i) => html`
                   <div key=${i} className="bg-black/80 p-3 rounded-xl border border-white/5 relative group">
                      <div className="font-mono text-[8px] text-indigo-400/60 break-all leading-tight mb-2">
                         ${v.substring(0, 100)}...
                      </div>
                      <${ActionButton} onClick=${() => { navigator.clipboard.writeText(v); setCopiedIndex(i); setTimeout(() => setCopiedIndex(null), 2000); }} 
                        className="w-full h-8" variant=${copiedIndex === i ? 'secondary' : 'primary'}>
                        ${copiedIndex === i ? html`<${CheckCircle2} size=${10} /> Copied` : html`<${Copy} size=${10} /> Copy Vol ${i+1}`}
                      <//>
                   </div>
                `)}
             </div>
             <${ActionButton} onClick=${() => { setFile(null); setState({result:null, stage: 'IDLE', progress: 0}); }} variant="secondary" className="w-full">
                <${RefreshCcw} size=${14} /> New Uplink
             <//>
          </div>
        `}
      </div>
    </div>
  `;
};

const DecodingView = ({ persistentMedia, setPersistentMedia, persistentChunks, setPersistentChunks }) => {
  const [input, setInput] = useState("");
  const [error, setError] = useState(null);

  const decode = async (text) => {
    if (!text.includes("GC:")) return;
    try {
      const parts = text.split("GC:").filter(s => s.trim())[0].split(":");
      const type = parts[0];
      const total = parseInt(parts[1]);
      const index = parseInt(parts[2]);
      const payload = parts[parts.length - 1].trim();
      
      const newMap = new Map(persistentChunks);
      newMap.set(index, payload);
      setPersistentChunks(newMap);
      setInput(""); // Clear for next paste

      if (newMap.size >= total) {
        const sorted = Array.from(newMap.keys()).sort((a,b) => a-b);
        const fullEncoded = sorted.map(k => newMap.get(k)).join('');
        const raw = await decompress(decodeBase32768(fullEncoded));
        let url;
        if (type === MediaType.AUDIO) url = URL.createObjectURL(new Blob([raw], { type: 'audio/wav' }));
        else if (type === MediaType.VIDEO) url = URL.createObjectURL(new Blob([raw], { type: 'video/webm' }));
        else url = URL.createObjectURL(new Blob([raw], { type: 'image/webp' }));
        setPersistentMedia({ type, url });
        setError(null);
      } else {
        setError(`Syncing: ${newMap.size}/${total} Vols`);
      }
    } catch (e) { setError("Signal Integrity Lost"); }
  };

  return html`
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="obsidian-glass rounded-2xl p-4">
        ${!persistentMedia ? html`
          <div className="space-y-4">
            <div className="relative group">
              <textarea value=${input} onChange=${e => { setInput(e.target.value); decode(e.target.value); }} 
                placeholder="PASTE VOLUME..." 
                className="w-full h-44 bg-black/60 border border-white/5 rounded-xl p-4 font-mono text-[11px] text-indigo-400 focus:border-indigo-500/30 outline-none transition-all shadow-inner leading-relaxed resize-none custom-scrollbar" />
              <button onClick=${async () => { const t = await navigator.clipboard.readText(); setInput(t); decode(t); }} 
                className="absolute bottom-3 right-3 p-2.5 bg-zinc-900/80 rounded-lg text-zinc-500 border border-white/10 active:bg-indigo-600 active:text-white transition-all tap-scale shadow-xl">
                 <${ClipboardPaste} size=${16} />
              </button>
            </div>
            ${persistentChunks.size > 0 && html`
               <div className="flex items-center justify-between text-[8px] font-black uppercase tracking-widest text-indigo-500 bg-indigo-500/10 p-2 rounded-lg border border-indigo-500/20">
                  <span>${persistentChunks.size} Volumes Synced</span>
                  <button onClick=${() => setPersistentChunks(new Map())} className="text-zinc-600 hover:text-white transition-colors"><${Trash2} size=${12} /></button>
               </div>
            `}
            <p className="text-center text-[8px] font-black uppercase tracking-[0.5em] text-zinc-700">Awaiting Byte-Stream Buffer</p>
          </div>
        ` : html`
          <div className="space-y-4">
            <div className="aspect-square bg-black rounded-xl overflow-hidden border border-white/5 flex items-center justify-center p-2 relative">
               ${persistentMedia.type === 'I' ? html`<img src=${persistentMedia.url} className="w-full h-full object-contain" />` : 
                 persistentMedia.type === 'V' ? html`<video controls src=${persistentMedia.url} className="w-full h-full object-contain" />` :
                 html`<div className="flex flex-col items-center gap-4"><${AudioLines} size=${48} className="text-indigo-500 animate-pulse" /><audio controls src=${persistentMedia.url} className="w-full max-w-[200px]" /></div>`}
            </div>
            <div className="flex gap-2">
               <a href=${persistentMedia.url} download="ghost_reconstructed" className="flex-1 h-10 bg-indigo-600 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg active:bg-indigo-700 transition-all tap-scale">
                  <${Download} size=${14} /> Recover Asset
               </a>
               <${ActionButton} onClick=${() => { setPersistentMedia(null); setPersistentChunks(new Map()); setInput(""); }} variant="secondary" className="w-10 px-0"><${Trash2} size=${16} /><//>
            </div>
          </div>
        `}
        ${error && html`<div className="mt-3 p-3 bg-red-950/20 border border-red-900/30 rounded-lg text-red-500 text-[9px] font-bold uppercase tracking-widest text-center animate-shake">${error}</div>`}
      </div>
    </div>
  `;
};

const App = () => {
  const [tab, setTab] = useState('encode');
  const [res, setRes] = useState(null);
  const [file, setFile] = useState(null);
  const [media, setMedia] = useState(null);
  const [chunks, setChunks] = useState(new Map());

  return html`
    <div className="h-screen w-full flex flex-col bg-[#020202] relative overflow-hidden">
      <div className="fixed top-0 left-0 w-full h-[300px] bg-gradient-to-b from-indigo-600/10 to-transparent pointer-events-none" />
      <div className="fixed bottom-0 left-0 w-full h-[200px] bg-gradient-to-t from-violet-600/5 to-transparent pointer-events-none" />

      <header className="p-4 flex justify-between items-center bg-black/40 backdrop-blur-xl border-b border-white/[0.03] shrink-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.4)] border border-white/10 rotate-3 transition-transform hover:rotate-0"><${Shield} size=${18} /></div>
          <div>
            <h1 className="text-sm font-black uppercase tracking-tighter leading-none text-white">Ghost<span className="text-indigo-500">Comm</span></h1>
            <p className="text-[7px] font-bold text-zinc-500 uppercase tracking-[0.4em] mt-1">Obsidian v4.5.1</p>
          </div>
        </div>
        <div className="flex gap-2">
           <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-white/5 flex items-center justify-center tap-scale cursor-pointer hover:bg-zinc-800 transition-colors"><${Settings} size=${14} className="text-zinc-600" /></div>
        </div>
      </header>

      <main className="flex-1 p-5 max-w-md mx-auto w-full overflow-y-auto custom-scrollbar relative">
        <div className="flex bg-zinc-900/40 p-1 rounded-xl border border-white/5 mb-8 relative">
          <div className=${`absolute top-1 bottom-1 left-1 w-[calc(50%-2px)] bg-indigo-600 rounded-lg transition-transform duration-[400ms] cubic-bezier(0.2, 0, 0, 1) shadow-lg ${tab === 'decode' ? 'translate-x-full' : 'translate-x-0'}`} />
          <button onClick=${() => setTab('encode')} className=${`flex-1 py-2 text-[9px] font-black uppercase tracking-widest transition-all relative z-10 ${tab === 'encode' ? 'text-white' : 'text-zinc-500'}`}>Encode</button>
          <button onClick=${() => setTab('decode')} className=${`flex-1 py-2 text-[9px] font-black uppercase tracking-widest transition-all relative z-10 ${tab === 'decode' ? 'text-white' : 'text-zinc-500'}`}>Decode</button>
        </div>

        <div className="pb-10">
          ${tab === 'encode' ? html`<${EncodingView} persistentResult=${res} setPersistentResult=${setRes} persistentFile=${file} setPersistentFile=${setFile} />` : 
          html`<${DecodingView} persistentMedia=${media} setPersistentMedia=${setMedia} persistentChunks=${chunks} setPersistentChunks=${setChunks} />`}
        </div>

        <div className="mt-8 p-4 obsidian-glass rounded-xl flex items-center justify-between opacity-40">
           <div className="flex gap-4"><${Cpu} size=${12} /><${Hash} size=${12} /><${Fingerprint} size=${12} /></div>
           <span className="text-[7px] font-black uppercase tracking-widest">Security Core Online</span>
        </div>
      </main>

      <footer className="p-4 border-t border-white/[0.03] text-center bg-black/40 backdrop-blur-md shrink-0">
        <span className="text-[8px] font-black uppercase tracking-[1em] text-zinc-800">Titan Offline Signal</span>
      </footer>
    </div>
  `;
};

const root = createRoot(document.getElementById('root'));
root.render(html`<${App} />`);
