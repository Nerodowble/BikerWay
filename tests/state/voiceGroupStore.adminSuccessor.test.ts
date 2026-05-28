import { useVoiceGroupStore } from '@/state/voiceGroupStore';

function reset(): void {
  useVoiceGroupStore.getState().leaveComboio();
}

describe('voiceGroupStore — F34.2 admin + successor', () => {
  beforeEach(() => {
    reset();
  });

  it('createComboio marca como admin local', () => {
    useVoiceGroupStore.getState().createComboio('Willian');
    expect(useVoiceGroupStore.getState().isLocalAdmin).toBe(true);
    expect(useVoiceGroupStore.getState().successorPeerId).toBeNull();
  });

  it('joinComboio NAO marca como admin', () => {
    useVoiceGroupStore.getState().joinComboio('ABCD', 'Pedro');
    expect(useVoiceGroupStore.getState().isLocalAdmin).toBe(false);
    expect(useVoiceGroupStore.getState().successorPeerId).toBeNull();
  });

  it('leaveComboio reseta admin + sucessor', () => {
    useVoiceGroupStore.getState().createComboio('Willian');
    useVoiceGroupStore.getState().setSuccessorPeerId('peer-2');
    useVoiceGroupStore.getState().leaveComboio();
    expect(useVoiceGroupStore.getState().isLocalAdmin).toBe(false);
    expect(useVoiceGroupStore.getState().successorPeerId).toBeNull();
  });

  it('setSuccessorPeerId define o id; toggle de novo cancela', () => {
    useVoiceGroupStore.getState().createComboio('Willian');
    useVoiceGroupStore.getState().setSuccessorPeerId('peer-2');
    expect(useVoiceGroupStore.getState().successorPeerId).toBe('peer-2');
    // setter e idempotente: setar o mesmo id nao muda nada
    useVoiceGroupStore.getState().setSuccessorPeerId('peer-2');
    expect(useVoiceGroupStore.getState().successorPeerId).toBe('peer-2');
    // null limpa
    useVoiceGroupStore.getState().setSuccessorPeerId(null);
    expect(useVoiceGroupStore.getState().successorPeerId).toBeNull();
  });

  it('removeParticipant do sucessor limpa successorPeerId', () => {
    useVoiceGroupStore.getState().createComboio('Willian');
    useVoiceGroupStore.getState().upsertParticipant({
      id: 'peer-2',
      displayName: 'Pedro',
      isAudioMuted: false,
    });
    useVoiceGroupStore.getState().setSuccessorPeerId('peer-2');
    useVoiceGroupStore.getState().removeParticipant('peer-2');
    expect(useVoiceGroupStore.getState().successorPeerId).toBeNull();
  });

  it('removeParticipant de OUTRO peer nao mexe no sucessor', () => {
    useVoiceGroupStore.getState().createComboio('Willian');
    useVoiceGroupStore.getState().upsertParticipant({
      id: 'peer-2',
      displayName: 'Pedro',
      isAudioMuted: false,
    });
    useVoiceGroupStore.getState().upsertParticipant({
      id: 'peer-3',
      displayName: 'João',
      isAudioMuted: false,
    });
    useVoiceGroupStore.getState().setSuccessorPeerId('peer-2');
    useVoiceGroupStore.getState().removeParticipant('peer-3');
    expect(useVoiceGroupStore.getState().successorPeerId).toBe('peer-2');
  });
});
