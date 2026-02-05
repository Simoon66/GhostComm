
import { Chunk, MediaType } from '../types';
import { calculateChecksum } from './encoding';

const APP_PREFIX = "GC"; 

export const createVolumes = (type: MediaType, encodedText: string, maxChars: number): string[] => {
  const headerEstimate = 40;
  const effectivePayloadSize = maxChars - headerEstimate; 
  if (effectivePayloadSize <= 0) throw new Error("Character limit too low for transmission.");

  const totalChunks = Math.ceil(encodedText.length / effectivePayloadSize);
  const volumes: string[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * effectivePayloadSize;
    const end = Math.min(start + effectivePayloadSize, encodedText.length);
    const payload = encodedText.substring(start, end);
    const checksum = calculateChecksum(payload);
    
    // Header format: GC:TYPE:TOTAL:INDEX:CRC:
    const header = `${APP_PREFIX}:${type}:${totalChunks}:${i}:${checksum}:`;
    volumes.push(header + payload);
  }

  return volumes;
};

/**
 * Robustly extracts chunks from potentially "dirty" text copied from Messenger.
 */
export const extractAllChunks = (text: string): Chunk[] => {
  const foundChunks: Chunk[] = [];
  
  // Split by GC: to find all potential chunk starts
  const segments = text.split("GC:");
  
  for (const segment of segments) {
    if (!segment.trim()) continue;
    
    // Each segment should look like TYPE:TOTAL:INDEX:CRC:PAYLOAD
    const parts = segment.split(":");
    if (parts.length < 5) continue;
    
    try {
      const type = parts[0] as MediaType;
      const total = parseInt(parts[1]);
      const index = parseInt(parts[2]);
      const checksum = parts[3];
      
      // The rest of the segment (all parts after CRC) contains the payload
      // Messenger might have added newlines or spaces at the very end
      const rawPayload = parts.slice(4).join(":");
      
      // Clean payload: Only keep CJK characters used by our encoder
      let cleanedPayload = "";
      for (let j = 0; j < rawPayload.length; j++) {
        const code = rawPayload.charCodeAt(j);
        if (code >= 0x4E00 && code < 0x4E00 + 32768) {
          cleanedPayload += rawPayload[j];
        }
      }

      if (cleanedPayload.length > 0) {
        const calculated = calculateChecksum(cleanedPayload);
        if (calculated === checksum) {
          foundChunks.push({ type, total, index, checksum, payload: cleanedPayload });
        } else {
          console.warn(`Checksum mismatch for part ${index}. Expected ${checksum}, got ${calculated}`);
        }
      }
    } catch (e) {
      console.error("Failed to parse segment", e);
    }
  }

  return foundChunks;
};
