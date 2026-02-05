
import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, Trash2, CheckCircle2, Zap, Loader2, Download, X, Search, Music, Play, Pause, Volume2, ClipboardPaste, Keyboard } from 'lucide-react';
import { extractAllChunks } from '../services/chunker';
import { decodeBase32768 } from '../services/encoding';
import { decompressBytes } from '../services/mediaUtils';
import { Chunk, DecodedMedia, MediaType } from '../types';

interface DecodingViewProps {
  persistentChunks: Map<number, Chunk>;
  setPersistentChunks: (m: Map<number, Chunk>) => void;
  persistentMedia: DecodedMedia | null;
  setPersistentMedia: (m: DecodedMedia | null) => void;
}

const DecodingView: React.FC<DecodingViewProps> = ({ 
  persistentChunks, setPersistentChunks, 
  persistentMedia, setPersistentMedia 
}) => {
  const [error, setError] = useState<string | null>(null);
  const [isReconstructing, setIsReconstructing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [boostActive, setBoostActive] = useState(true);
  const [manualInput, setManualInput] = useState("");
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const processText = (text: string) => {
    if (!text || !text.trim()) return;
    try {
      const chunks = extractAllChunks(text);
      if (chunks.length === 0) {
        if (text.includes("GC:")) setError("Missing GC Protocol signature.");
        return;
      }
      
      const newMap = new Map<number, Chunk>(persistentChunks);
      chunks.forEach(c => newMap.set(c.index, c));
      setPersistentChunks(newMap);
      setManualInput(""); 
      setError(null);
      
      const first = chunks[0];
      if (newMap.size >= first.total) {
        handleRebuild(newMap);
      } else {
        setError(`Syncing: ${newMap.size}/${first.total} Packets Received`);
      }
    } catch (e: any) {
      setError("Protocol mismatch: Data corruption.");
    }
  };

  const handleClipboardAuto = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) processText(text);
      else setError("Clipboard Buffer Empty");
    } catch (err) {
      setError("Clipboard access denied by OS.");
    }
  };

  const handleRebuild = async (map: Map<number, Chunk>) => {
    setIsReconstructing(true);
    setError(null);
    try {
      const sortedIndices = Array.from(map.keys()).sort((a, b) => a - b);
      const combinedPayload = sortedIndices.map(i => map.get(i)!.payload).join('');
      const firstChunk = map.get(sortedIndices[0])!;
      const compressed = decodeBase32768(combinedPayload);
      const raw = await decompressBytes(compressed);
      
      let mime = 'image/webp';
      if (firstChunk.type === MediaType.AUDIO) mime = 'audio/webm';
      if (firstChunk.type === MediaType.VIDEO) mime = 'video/mp4';
      
      setPersistentMedia({
        type: firstChunk.type,
        dataUrl: URL.createObjectURL(new Blob([raw], { type: mime })),
        size: raw.length
      });
    } catch (e: any) {
      setError("Checksum Failed: Integrity Error.");
    } finally {
      setIsReconstructing(false);
    }
  };

  const setupAudioContext = () => {
    if (!audioRef.current || audioCtxRef.current) return;
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioCtx.createMediaElementSource(audioRef.current);
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = boostActive ? 3.0 : 1.0;
    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    audioCtxRef.current = audioCtx;
    gainNodeRef.current = gainNode;
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    setupAudioContext();
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
      audioRef.current.play().catch(() => setError("Hardware blocked audio output."));
    }
  };

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(boostActive ? 3.0 : 1.0, audioCtxRef.current?.currentTime || 0, 0.1);
    }
  }, [boostActive]);

  return (
    <div className="space-y-6 pb-20">
      {!persistentMedia ? (
        <div className="bg-[#111] border border-white/5 rounded-[2.5rem] p-6 shadow-2xl space-y-8 overflow-hidden animate-slide-up">
           <div className="pt-6 flex flex-col items-center gap-4">
             <div className="w-20 h-20 bg-blue-600/5 rounded-3xl flex items-center justify-center border border-blue-500/10 shadow-2xl relative">
                <div className="absolute inset-0 bg-blue-500/10 blur-3xl rounded-full" />
                <Zap className="text-blue-500 relative z-10" size={32} />
             </div>
             <div className="text-center">
               <h2 className="text-lg font-bold text-white uppercase tracking-tight">Sync Protocol</h2>
               <p className="text-[9px] text-zinc-500 font-black uppercase tracking-[0.3em] mt-1">Ready for decryption</p>
             </div>
           </div>

           <div className="space-y-6 px-2">
              <div className="relative group">
                 <div className="absolute -top-3 left-6 px-3 bg-[#111] text-[8px] font-black text-blue-500 uppercase tracking-[0.3em] z-10 border border-white/5 rounded-full">Manual Terminal</div>
                 <textarea
                    value={manualInput}
                    onChange={(e) => { setManualInput(e.target.value); processText(e.target.value); }}
                    placeholder="LONG PRESS TO PASTE..."
                    className="w-full h-36 bg-black border border-zinc-900 focus:border-blue-600/30 rounded-[2rem] p-6 text-[11px] font-mono text-blue-400 outline-none transition-all resize-none shadow-inner leading-relaxed"
                 />
                 <div className="absolute bottom-5 right-6 flex items-center gap-2 opacity-20 group-focus-within:opacity-100 transition-opacity">
                    <Keyboard size={14} className="text-zinc-500" />
                    <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Input Locked</span>
                 </div>
              </div>

              <div className="flex items-center gap-3">
                 <div className="h-[1px] flex-1 bg-zinc-900" />
                 <span className="text-[8px] font-black text-zinc-700 uppercase tracking-widest">or</span>
                 <div className="h-[1px] flex-1 bg-zinc-900" />
              </div>

              <button 
                onClick={handleClipboardAuto}
                className="w-full py-5 bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 rounded-3xl font-black text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-3 tap-scale transition-all border border-white/5 shadow-xl"
              >
                <ClipboardPaste size={18} />
                Auto-Link Clipboard
              </button>
           </div>

           {persistentChunks.size > 0 && (
             <div className="bg-black/40 border border-white/5 p-6 rounded-[2.5rem] space-y-4 animate-fade-in mx-2 shadow-inner">
                <div className="flex justify-between items-center text-[9px] font-black text-zinc-500 uppercase tracking-widest">
                   <span className="flex items-center gap-2">
                     <Loader2 size={12} className="animate-spin text-blue-500" /> 
                     {isReconstructing ? 'Compiling Media...' : 'Receiving Chunks...'}
                   </span>
                   <span className="text-blue-400 bg-blue-900/20 px-3 py-1 rounded-full border border-blue-500/10">{persistentChunks.size} Volumes Sync'd</span>
                </div>
                <div className="h-1 bg-zinc-900 rounded-full overflow-hidden relative">
                   <div className="h-full bg-blue-500 w-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-blue-600 via-blue-300 to-blue-600 bg-[length:200%_100%]" />
                </div>
                <button onClick={() => { setPersistentChunks(new Map()); setError(null); }} className="text-red-500/40 hover:text-red-500 text-[8px] font-black uppercase tracking-[0.2em] flex items-center gap-1.5 mx-auto transition-all py-1">
                  <Trash2 size={10}/> Clear Sync Buffer
                </button>
             </div>
           )}
        </div>
      ) : (
        <div className="bg-[#111] border border-white/5 rounded-[3rem] p-8 text-center shadow-2xl space-y-10 animate-smooth-in overflow-hidden relative">
           <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-green-500/50 to-transparent" />
           
           <div className="flex flex-col items-center gap-5">
             <div className="w-24 h-24 bg-green-500/5 rounded-full flex items-center justify-center border border-green-500/10 shadow-[0_0_80px_rgba(34,197,94,0.1)]">
               <CheckCircle2 className="text-green-500" size={48} />
             </div>
             <h2 className="text-xl font-black text-white tracking-tight uppercase">Media Decrypted</h2>
           </div>

           <div className="bg-black border border-white/5 rounded-[2.5rem] overflow-hidden relative shadow-2xl">
              {persistentMedia.type === MediaType.IMAGE && <img src={persistentMedia.dataUrl} className="w-full h-auto p-4 transition-transform duration-700 hover:scale-110" />}
              
              {persistentMedia.type === MediaType.AUDIO && (
                <div className="p-8 space-y-10 flex flex-col items-center">
                   <div className="w-28 h-28 bg-zinc-950 border border-white/5 rounded-[2.5rem] flex items-center justify-center shadow-2xl relative overflow-hidden group">
                      <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                      {isPlaying ? (
                        <div className="flex items-end gap-1.5 h-12 relative z-10">
                           <div className="w-2 h-8 bg-blue-500 animate-[bounce_0.6s_infinite]" />
                           <div className="w-2 h-12 bg-blue-400 animate-[bounce_0.8s_infinite] delay-75" />
                           <div className="w-2 h-6 bg-blue-600 animate-[bounce_0.5s_infinite] delay-150" />
                        </div>
                      ) : <Music className="text-blue-500 relative z-10" size={48} />}
                   </div>
                   
                   <div className="w-full space-y-8">
                      <div className="flex items-center gap-5 bg-zinc-900/60 p-5 rounded-[2rem] border border-white/5 shadow-inner">
                         <button onClick={togglePlay} className="w-16 h-16 bg-white text-black rounded-[1.5rem] flex items-center justify-center tap-scale transition-all shadow-xl">
                            {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}
                         </button>
                         <div className="flex-1 space-y-3">
                            <div className="h-1.5 bg-zinc-950 rounded-full overflow-hidden">
                               <div className="h-full bg-blue-500 transition-all duration-300 shadow-[0_0_15px_rgba(59,130,246,0.5)]" style={{ width: `${audioProgress}%` }} />
                            </div>
                            <div className="flex justify-between items-center px-1">
                               <p className="text-[8px] text-zinc-500 font-black uppercase tracking-[0.2em]">Live Stream</p>
                               <span className="text-[9px] font-mono text-zinc-400">{Math.round(audioProgress)}%</span>
                            </div>
                         </div>
                      </div>

                      <div 
                        onClick={() => setBoostActive(!boostActive)}
                        className={`p-5 rounded-3xl border transition-all cursor-pointer flex items-center justify-between tap-scale shadow-lg ${boostActive ? 'bg-blue-600/10 border-blue-600/30 text-blue-400' : 'bg-zinc-900/50 border-white/5 text-zinc-500'}`}
                      >
                         <div className="flex items-center gap-4">
                           <Zap size={20} fill={boostActive ? "currentColor" : "none"} className={boostActive ? 'animate-pulse' : ''} />
                           <span className="text-[10px] font-black uppercase tracking-[0.2em]">Amplifier: 3.5x Boost</span>
                         </div>
                         <div className={`w-11 h-6 rounded-full relative transition-all ${boostActive ? 'bg-blue-600' : 'bg-zinc-800'}`}>
                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-md ${boostActive ? 'right-1' : 'left-1'}`} />
                         </div>
                      </div>
                   </div>
                   
                   <audio 
                     ref={audioRef}
                     src={persistentMedia.dataUrl} 
                     onTimeUpdate={() => setAudioProgress((audioRef.current!.currentTime / audioRef.current!.duration) * 100)}
                     onPlay={() => setIsPlaying(true)}
                     onPause={() => setIsPlaying(false)}
                     onEnded={() => { setIsPlaying(false); setAudioProgress(0); }}
                     className="hidden"
                   />
                </div>
              )}
           </div>

           <div className="flex flex-col gap-5 px-2 pb-4">
              <a href={persistentMedia.dataUrl} download={`GHOSTCOMM_SYNC_${Date.now()}`} className="w-full py-6 bg-blue-600 hover:bg-blue-500 text-white rounded-3xl font-black text-xs uppercase tracking-[0.3em] flex items-center justify-center gap-3 border-b-4 border-blue-900 shadow-2xl tap-scale transition-all">
                <Download size={22} /> Save Payload
              </a>
              <button onClick={() => { setPersistentChunks(new Map()); setPersistentMedia(null); }} className="text-zinc-500 hover:text-white text-[9px] font-black uppercase tracking-[0.4em] transition-all py-2 tap-scale">Initiate New Assembly</button>
           </div>
        </div>
      )}

      {error && (
        <div className="p-5 bg-red-950/20 border border-red-500/30 rounded-3xl flex items-center gap-4 text-red-400 text-[10px] font-black uppercase tracking-widest animate-fade-in mx-2">
           <AlertCircle size={20} />
           <span className="flex-1">{error}</span>
           <button onClick={() => setError(null)} className="p-1 tap-scale opacity-50"><X size={16}/></button>
        </div>
      )}
    </div>
  );
};

export default DecodingView;
