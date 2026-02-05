
import React, { useState, useRef, useEffect } from 'react';
import { Box, Mic, Trash2, Loader2, Zap, Share2, StopCircle, CheckCircle, Copy, Eye, AlertCircle, Play, Pause, Volume2, Activity, Keyboard } from 'lucide-react';
import { processMedia, compressBytes } from '../services/mediaUtils';
import { encodeBase32768 } from '../services/encoding';
import { createVolumes } from '../services/chunker';
import { MediaType, ProcessingState, MESSENGER_LIMITS } from '../types';

interface EncodingViewProps {
  persistentResult: string[] | null;
  setPersistentResult: (res: string[] | null) => void;
  persistentFile: File | null;
  setPersistentFile: (f: File | null) => void;
}

const EncodingView: React.FC<EncodingViewProps> = ({ 
  persistentResult, setPersistentResult, 
  persistentFile, setPersistentFile 
}) => {
  const [file, setFile] = useState<File | null>(persistentFile);
  const [isRecording, setIsRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [isCopied, setIsCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [state, setState] = useState<ProcessingState>({
    isProcessing: false,
    progress: 0,
    error: null,
    result: persistentResult,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => { setPersistentFile(file); }, [file]);
  useEffect(() => { setPersistentResult(state.result); }, [state.result]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
      });
      
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyzer = audioCtx.createAnalyser();
      analyzer.fftSize = 128;
      source.connect(analyzer);
      audioCtxRef.current = audioCtx;
      analyzerRef.current = analyzer;

      const updateMicLevel = () => {
        const dataArray = new Uint8Array(analyzer.frequencyBinCount);
        analyzer.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setMicLevel(average);
        animationFrameRef.current = requestAnimationFrame(updateMicLevel);
      };
      updateMicLevel();

      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const recordedFile = new File([audioBlob], `VOICE_${Date.now()}.webm`, { type: 'audio/webm' });
        setFile(recordedFile);
        stream.getTracks().forEach(track => track.stop());
        if (audioCtxRef.current) audioCtxRef.current.close();
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      };

      recorder.start();
      setIsRecording(true);
      setRecordTime(0);
      timerRef.current = window.setInterval(() => setRecordTime(t => t + 1), 1000);
    } catch (err) { 
      setState(s => ({ ...s, error: "Access Denied: Microphone needed for recording." })); 
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const togglePlay = () => {
    if (!audioPreviewRef.current) return;
    if (isPlaying) {
      audioPreviewRef.current.pause();
    } else {
      audioPreviewRef.current.play().catch(e => console.error(e));
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) { console.error(err); }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Container with smooth entrance */}
      <div className="bg-[#111] border border-white/5 rounded-[2.5rem] p-6 shadow-2xl overflow-hidden animate-slide-up">
        {!isRecording && !file ? (
          <div className="py-12 flex flex-col items-center gap-8">
            <div className="relative">
              <div className="absolute inset-0 bg-blue-500 blur-[80px] opacity-20 animate-pulse" />
              <div className="w-20 h-20 bg-zinc-900 border border-white/5 rounded-full flex items-center justify-center relative shadow-inner">
                <Box className="text-zinc-600" size={32} />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-lg font-bold text-white tracking-tight uppercase">Ready for Input</h2>
              <p className="text-[9px] text-zinc-500 font-black uppercase tracking-[0.3em]">Select source to begin</p>
            </div>
            <div className="flex gap-4 w-full px-2">
              <button onClick={() => fileInputRef.current?.click()} className="flex-1 py-5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-2xl font-bold flex flex-col items-center gap-3 transition-all tap-scale border border-white/5 shadow-lg">
                <Box size={24} className="text-blue-500" />
                <span className="text-[8px] uppercase tracking-widest font-black">Browse Files</span>
              </button>
              <button onClick={startRecording} className="flex-1 py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold flex flex-col items-center gap-3 transition-all tap-scale border-b-4 border-blue-900 shadow-xl">
                <Mic size={24} />
                <span className="text-[8px] uppercase tracking-widest font-black">Record Voice</span>
              </button>
            </div>
          </div>
        ) : isRecording ? (
          <div className="py-12 flex flex-col items-center gap-10 animate-fade-in">
             <div className="flex items-center gap-1 h-16 w-full justify-center">
               {[...Array(15)].map((_, i) => (
                 <div 
                   key={i} 
                   className="w-1.5 bg-blue-500 rounded-full transition-all duration-75"
                   style={{ 
                     height: `${Math.max(10, (micLevel * (Math.random() * 0.8 + 0.5)))}%`,
                     opacity: 0.3 + (i / 15) * 0.7
                   }}
                 />
               ))}
             </div>
             
             <div className="text-center">
                <span className="text-5xl font-black text-white tracking-tighter tabular-nums">
                  {Math.floor(recordTime/60)}:{(recordTime%60).toString().padStart(2,'0')}
                </span>
                <div className="flex items-center justify-center gap-2 mt-3">
                   <div className="w-2 h-2 bg-red-500 rounded-full animate-ping" />
                   <span className="text-[8px] text-zinc-500 font-black uppercase tracking-[0.3em]">Live Feed Active</span>
                </div>
             </div>

             <button onClick={stopRecording} className="w-full py-5 bg-white text-black rounded-3xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 tap-scale transition-all shadow-2xl">
               <StopCircle size={20} fill="currentColor" /> Finish Recording
             </button>
          </div>
        ) : (
          <div className="space-y-8 animate-fade-in">
            <div className="bg-black border border-white/5 rounded-[2rem] p-6 relative group overflow-hidden shadow-inner">
               {file?.type.startsWith('audio/') ? (
                 <div className="py-8 flex flex-col items-center gap-6">
                    <div className="w-24 h-24 bg-blue-600/5 border border-blue-500/10 rounded-full flex items-center justify-center relative shadow-2xl">
                      {isPlaying ? <Activity className="text-blue-500 animate-pulse" size={32} /> : <Volume2 className="text-blue-500" size={32} />}
                    </div>
                    <div className="text-center w-full px-4">
                      <p className="text-white font-bold text-sm truncate max-w-xs mx-auto mb-1">{file.name}</p>
                      <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">Acoustic Buffer Loaded</p>
                    </div>
                    
                    <div className="w-full flex items-center gap-5 bg-zinc-900/50 p-5 rounded-3xl border border-white/5">
                       <button onClick={togglePlay} className="w-14 h-14 bg-white text-black rounded-2xl flex items-center justify-center tap-scale transition-all shadow-xl">
                          {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
                       </button>
                       <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                          <div className={`h-full bg-blue-500 transition-all ${isPlaying ? 'w-full duration-[5s]' : 'w-0'}`} />
                       </div>
                    </div>
                    <audio 
                      ref={audioPreviewRef} 
                      src={URL.createObjectURL(file)} 
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onEnded={() => setIsPlaying(false)}
                      className="hidden" 
                    />
                 </div>
               ) : (
                 <div className="aspect-square w-full bg-zinc-950 rounded-2xl flex items-center justify-center overflow-hidden border border-white/5 shadow-inner p-2">
                    {file?.type.startsWith('image/') ? (
                      <img src={URL.createObjectURL(file)} className="w-full h-full object-contain rounded-xl" />
                    ) : <Box size={48} className="text-zinc-800" />}
                 </div>
               )}
               <button onClick={() => { setFile(null); setState(s => ({...s, result: null})); }} className="absolute top-4 right-4 w-10 h-10 bg-red-600/10 text-red-500 hover:bg-red-600 hover:text-white rounded-xl flex items-center justify-center transition-all tap-scale border border-red-500/20"><Trash2 size={16} /></button>
            </div>

            {!state.result && (
              <button 
                onClick={async () => {
                  setState(s => ({...s, isProcessing: true}));
                  try {
                    let type = MediaType.IMAGE;
                    if (file?.type.startsWith('audio/')) type = MediaType.AUDIO;
                    else if (file?.type.startsWith('video/')) type = MediaType.VIDEO;
                    const raw = await processMedia(file!, type);
                    const compressed = await compressBytes(raw);
                    const encoded = encodeBase32768(compressed);
                    const volumes = createVolumes(type, encoded, MESSENGER_LIMITS[2].maxChars);
                    setState({ isProcessing: false, progress: 100, error: null, result: volumes });
                  } catch (e) {
                    setState({ isProcessing: false, progress: 0, error: "Encoding Failed", result: null });
                  }
                }} 
                disabled={state.isProcessing}
                className="w-full py-6 bg-blue-600 text-white rounded-3xl font-black text-xs uppercase tracking-[0.2em] flex items-center justify-center gap-3 transition-all tap-scale border-b-4 border-blue-900 disabled:opacity-50 shadow-2xl"
              >
                {state.isProcessing ? <Loader2 className="animate-spin" size={20} /> : <Zap size={20} fill="currentColor" />}
                {state.isProcessing ? "Processing Stream..." : "Compile Packets"}
              </button>
            )}
          </div>
        )}
      </div>

      {state.result && (
        <div className="bg-[#111] border-2 border-blue-600/20 rounded-[2.5rem] p-6 shadow-2xl space-y-6 animate-slide-up">
           <div className="flex items-center justify-between px-2">
              <div>
                <h3 className="text-white font-bold text-sm tracking-tight">Coded Transmission</h3>
                <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest mt-0.5">Packet Size: {state.result[0].length} Chars</p>
              </div>
              <div className="flex gap-2">
                 <button onClick={() => setShowRaw(!showRaw)} className={`p-2 rounded-xl transition-all ${showRaw ? 'bg-blue-600 text-white' : 'bg-zinc-900 text-zinc-500 border border-white/5'}`}><Eye size={18}/></button>
                 <button onClick={() => { if(navigator.share) navigator.share({text: state.result![0]}) }} className="p-2 bg-zinc-900 text-white rounded-xl border border-white/5 tap-scale"><Share2 size={18}/></button>
              </div>
           </div>

           <div className="relative group overflow-hidden">
              <div className={`bg-black rounded-[1.5rem] p-6 font-mono text-[10px] text-blue-400 break-all border border-white/5 h-40 overflow-y-auto leading-relaxed transition-all duration-700 ${showRaw ? 'blur-0' : 'blur-xl opacity-20'}`}>
                {state.result[0]}
              </div>
              {!showRaw && (
                <div className="absolute inset-0 flex items-center justify-center">
                   <button onClick={() => setShowRaw(true)} className="px-8 py-3 bg-zinc-800/80 backdrop-blur-md text-white text-[9px] font-black uppercase tracking-[0.2em] rounded-full border border-white/10 shadow-2xl tap-scale">Unlock Visualizer</button>
                </div>
              )}
           </div>

           <button 
             onClick={() => handleCopy(state.result![0])} 
             className={`w-full py-6 rounded-3xl font-black text-xs uppercase tracking-[0.2em] flex items-center justify-center gap-3 transition-all tap-scale shadow-2xl ${isCopied ? 'bg-green-600 text-white' : 'bg-white text-black'}`}
           >
             {isCopied ? <CheckCircle size={20} /> : <Copy size={20} />}
             {isCopied ? "Packet Copied" : "Copy Buffer"}
           </button>
        </div>
      )}

      {state.error && (
        <div className="p-5 bg-red-950/20 border border-red-500/30 rounded-3xl flex items-center gap-4 text-red-400 text-[10px] font-black uppercase tracking-widest animate-fade-in">
           <AlertCircle size={20} /> {state.error}
        </div>
      )}

      <input type="file" ref={fileInputRef} onChange={(e) => { setFile(e.target.files?.[0] || null); setState(s => ({...s, result: null})); }} className="hidden" />
    </div>
  );
};

export default EncodingView;
