
export enum MediaType {
  IMAGE = 'I',
  AUDIO = 'A',
  VIDEO = 'V'
}

export interface Chunk {
  type: MediaType;
  total: number;
  index: number;
  checksum: string;
  payload: string;
}

export interface ProcessingState {
  isProcessing: boolean;
  progress: number;
  error: string | null;
  result: string[] | null;
}

export interface DecodedMedia {
  type: MediaType;
  dataUrl: string;
  size: number;
}

export interface MessengerLimit {
  id: string;
  name: string;
  maxChars: number; // Maximum characters per paste/send
}

export const MESSENGER_LIMITS: MessengerLimit[] = [
  { id: 'safe', name: 'Safe (4k)', maxChars: 4000 },
  { id: 'high', name: 'Fast (15k)', maxChars: 15000 },
  { id: 'titan', name: 'Titan (64k)', maxChars: 64000 },
  { id: 'god', name: 'God (200k)', maxChars: 200000 }
];
