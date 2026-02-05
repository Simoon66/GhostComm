
import { MediaType } from '../types';

/**
 * Ultra-Aggressive Compression to fit in Single Volume
 * This ensures the binary size is small enough that the encoded text 
 * fits in one single Messenger message.
 */
export const processMedia = async (file: File, type: MediaType): Promise<Uint8Array> => {
  if (type === MediaType.IMAGE) {
    // Target binary size < 40KB (roughly 22k CJK characters)
    let quality = 0.25; 
    let width = 720;

    if (file.size > 2 * 1024 * 1024) { 
      quality = 0.15;
      width = 500;
    }
    
    return processImage(file, width, quality);
  }

  if (type === MediaType.VIDEO) {
    return compressVideo(file);
  }
  
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
};

export const processImage = async (file: File, maxWidth: number, quality: number): Promise<Uint8Array> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(maxWidth / img.width, 1);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject('Canvas error');
      
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      canvas.toBlob(async b => {
        if (!b) return reject('Blob error');
        resolve(new Uint8Array(await b.arrayBuffer()));
      }, 'image/webp', quality);
    };
    img.onerror = () => reject('Image load error');
    img.src = URL.createObjectURL(file);
  });
};

export const compressVideo = async (file: File): Promise<Uint8Array> => {
  // Video is inherently large, we attempt a very low res version
  return new Promise(async (resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      const canvas = document.createElement('canvas');
      const targetHeight = 320; 
      const scale = Math.min(targetHeight / video.videoHeight, 1);
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;
      const ctx = canvas.getContext('2d');

      const stream = canvas.captureStream(10); 
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') 
        ? 'video/webm;codecs=vp9' 
        : 'video/webm';

      const recorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        videoBitsPerSecond: 300000 
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        URL.revokeObjectURL(url);
        const blob = new Blob(chunks, { type: 'video/webm' });
        resolve(new Uint8Array(await blob.arrayBuffer()));
      };

      video.play();
      recorder.start();
      
      const drawFrame = () => {
        if (video.ended || video.paused) {
          recorder.stop();
          return;
        }
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
        requestAnimationFrame(drawFrame);
      };
      drawFrame();
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject('Video Load Error');
    };
  });
};

export const compressBytes = async (data: Uint8Array): Promise<Uint8Array> => {
  const stream = new ReadableStream({ start(c) { c.enqueue(data); c.close(); } })
    .pipeThrough(new CompressionStream('deflate'));
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

export const decompressBytes = async (data: Uint8Array): Promise<Uint8Array> => {
  try {
    const stream = new ReadableStream({ start(c) { c.enqueue(data); c.close(); } })
      .pipeThrough(new DecompressionStream('deflate'));
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
  } catch (e) {
    throw new Error("Corrupted Data");
  }
};
