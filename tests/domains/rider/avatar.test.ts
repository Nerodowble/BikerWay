import { avatarInitial } from '@/domains/rider/avatar';

describe('avatarInitial (F32)', () => {
  it('retorna a primeira letra em maiusculo', () => {
    expect(avatarInitial('Willian')).toBe('W');
    expect(avatarInitial('carlos')).toBe('C');
  });

  it('lida com acentuacao comum em PT-BR', () => {
    expect(avatarInitial('Álvaro')).toBe('Á');
    expect(avatarInitial('Êneas')).toBe('Ê');
  });

  it('retorna "?" pra entrada vazia ou nao-letra', () => {
    expect(avatarInitial('')).toBe('?');
    expect(avatarInitial('   ')).toBe('?');
    expect(avatarInitial(undefined)).toBe('?');
    expect(avatarInitial('123')).toBe('?');
    expect(avatarInitial('@user')).toBe('?');
  });

  it('ignora espacos antes do primeiro char real', () => {
    expect(avatarInitial('  W')).toBe('W');
  });
});
