import { useVoiceGroupStore } from '@/state/voiceGroupStore';

describe('voiceGroupStore F30 toggles locais', () => {
  beforeEach(() => {
    // Garante estado limpo entre testes (a store e singleton).
    useVoiceGroupStore.getState().leaveComboio();
  });

  it('peerPinsHidden default e false', () => {
    expect(useVoiceGroupStore.getState().peerPinsHidden).toBe(false);
  });

  it('incomingAudioMuted default e false', () => {
    expect(useVoiceGroupStore.getState().incomingAudioMuted).toBe(false);
  });

  it('setPeerPinsHidden seta o flag sem afetar o resto do estado', () => {
    useVoiceGroupStore.getState().setPeerPinsHidden(true);
    expect(useVoiceGroupStore.getState().peerPinsHidden).toBe(true);
    // Outros toggles ficam intactos.
    expect(useVoiceGroupStore.getState().incomingAudioMuted).toBe(false);
    expect(useVoiceGroupStore.getState().isLocalMuted).toBe(false);
  });

  it('setIncomingAudioMuted seta o flag sem afetar o mute do mic local', () => {
    useVoiceGroupStore.getState().setIncomingAudioMuted(true);
    expect(useVoiceGroupStore.getState().incomingAudioMuted).toBe(true);
    expect(useVoiceGroupStore.getState().isLocalMuted).toBe(false);
  });

  it('leaveComboio reseta ambos os toggles', () => {
    useVoiceGroupStore.getState().setPeerPinsHidden(true);
    useVoiceGroupStore.getState().setIncomingAudioMuted(true);
    useVoiceGroupStore.getState().leaveComboio();
    expect(useVoiceGroupStore.getState().peerPinsHidden).toBe(false);
    expect(useVoiceGroupStore.getState().incomingAudioMuted).toBe(false);
  });

  it('createComboio reseta ambos os toggles pra novo comboio limpo', () => {
    useVoiceGroupStore.getState().setPeerPinsHidden(true);
    useVoiceGroupStore.getState().setIncomingAudioMuted(true);
    useVoiceGroupStore.getState().createComboio('Tester');
    expect(useVoiceGroupStore.getState().peerPinsHidden).toBe(false);
    expect(useVoiceGroupStore.getState().incomingAudioMuted).toBe(false);
  });

  it('toggles podem ser invertidos varias vezes idempotentemente', () => {
    const store = useVoiceGroupStore.getState();
    store.setPeerPinsHidden(true);
    store.setPeerPinsHidden(true);
    expect(useVoiceGroupStore.getState().peerPinsHidden).toBe(true);
    store.setPeerPinsHidden(false);
    store.setPeerPinsHidden(false);
    expect(useVoiceGroupStore.getState().peerPinsHidden).toBe(false);
  });
});
