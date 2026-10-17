// API pública de la voz (PRD 05) para otros PRDs: tour en vivo (07), cámara (08), Ahora (19), Mapa (03).
export { useVoice, useVoiceStore, voice, type StartCallArgs, type CallStatus } from './store';
export { registerLocalTool } from './toolBridge';
export { VoiceProvider } from './VoiceProvider';
