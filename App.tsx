
import React, { useState } from 'react';
import { Shield, Share2, Download, Terminal, Settings } from 'lucide-react';
import EncodingView from './components/EncodingView';
import DecodingView from './components/DecodingView';
import { Chunk, DecodedMedia } from './types';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'encode' | 'decode'>('encode');
  
  // Persistent state for Encoding
  const [encodedResult, setEncodedResult] = useState<string[] | null>(null);
  const [lastEncodedFile, setLastEncodedFile] = useState<File | null>(null);

  // Persistent state for Decoding
  const [receivedChunks, setReceivedChunks] = useState<Map<number, Chunk>>(new Map());
  const [decodedMedia, setDecodedMedia] = useState<DecodedMedia | null>(null);

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 flex flex-col font-sans selection:bg-blue-500/30 overflow-hidden">
      {/* Premium Sticky Header */}
      <header className="bg-[#0a0a0a]/80 border-b border-white/5 sticky top-0 z-50 backdrop-blur-2xl">
        <div className="max-w-xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20 transform rotate-3">
              <Shield className="text-white" size={20} />
            </div>
            <div>
              <h1 className="text-md font-black tracking-tight leading-none uppercase">Ghost<span className="text-blue-500">Comm</span></h1>
              <span className="text-[7px] font-black text-zinc-500 uppercase tracking-[0.4em]">Protocol Stable v1.2</span>
            </div>
          </div>
          <button className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center border border-white/5 tap-scale">
            <Settings size={14} className="text-zinc-500" />
          </button>
        </div>
      </header>

      {/* Main View Area with Scroll Lock Logic */}
      <main className="flex-1 overflow-y-auto pt-6 px-4 custom-scrollbar">
        {/* Modern Tab Control - Floating Style */}
        <div className="max-w-xl mx-auto mb-10 bg-zinc-900/40 p-1.5 rounded-2xl border border-white/5 flex gap-1 relative overflow-hidden">
          <div 
            className={`absolute top-1.5 bottom-1.5 left-1.5 w-[calc(50%-6px)] bg-zinc-800 rounded-xl transition-transform duration-500 cubic-bezier(0.16, 1, 0.3, 1) border border-white/10 shadow-xl ${activeTab === 'decode' ? 'translate-x-full' : 'translate-x-0'}`}
          />
          <button 
            onClick={() => setActiveTab('encode')}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors duration-300 relative z-10 ${
              activeTab === 'encode' ? 'text-white' : 'text-zinc-500'
            }`}
          >
            <Share2 size={14} />
            Encode
          </button>
          <button 
            onClick={() => setActiveTab('decode')}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors duration-300 relative z-10 ${
              activeTab === 'decode' ? 'text-white' : 'text-zinc-500'
            }`}
          >
            <Download size={14} />
            Decode
          </button>
        </div>

        {/* View Transition Container */}
        <div className="max-w-xl mx-auto relative min-h-[400px]">
           <div key={activeTab} className="animate-smooth-in">
              {activeTab === 'encode' ? (
                <EncodingView 
                  persistentResult={encodedResult} 
                  setPersistentResult={setEncodedResult}
                  persistentFile={lastEncodedFile}
                  setPersistentFile={setLastEncodedFile}
                />
              ) : (
                <DecodingView 
                  persistentChunks={receivedChunks} 
                  setPersistentChunks={setReceivedChunks}
                  persistentMedia={decodedMedia}
                  setPersistentMedia={setDecodedMedia}
                />
              )}
           </div>
        </div>
      </main>

      {/* Modern Status Footer */}
      <footer className="bg-[#0a0a0a] border-t border-white/5 py-4 px-6">
        <div className="max-w-xl mx-auto flex justify-between items-center opacity-40">
           <div className="flex items-center gap-2">
             <Terminal size={10} />
             <span className="text-[7px] font-black uppercase tracking-widest">Buffer Status: Clean</span>
           </div>
           <div className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
              <span className="text-[7px] font-black uppercase tracking-widest">End-to-End Ready</span>
           </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
