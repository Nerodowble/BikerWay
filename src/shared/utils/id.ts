interface CryptoLike {
  randomUUID?: () => string;
}

export function createId(): string {
  const cryptoRef = (globalThis as { crypto?: CryptoLike }).crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
