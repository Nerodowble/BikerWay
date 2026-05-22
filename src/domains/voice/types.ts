export type VoiceConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

export interface VoiceParticipant {
  id: string;
  displayName: string;
  isAudioMuted: boolean;
  isDominantSpeaker?: boolean;
}

export interface ComboioToken {
  /** 4-digit alphanumeric code shown to humans (e.g. "A3K9"). */
  code: string;
  /** Full Jitsi room name derived from the code (e.g. "bikerway_room_a3k9_<hash>"). */
  roomName: string;
}
