import * as ImagePicker from 'expo-image-picker';
// expo-file-system v19 (SDK 54) moveu a API legada pra o submodulo /legacy.
// A nova API (Paths/File/Directory) e mais verbose pra um caso simples
// de copy-to-document; mantemos a legada que funciona bem e e familiar.
import * as FileSystem from 'expo-file-system/legacy';

/**
 * F32 — Pick + persist do avatar do piloto.
 *
 * O `ImagePicker.launchImageLibraryAsync` retorna URIs em `CacheDirectory`
 * que NAO sao garantidamente persistentes entre cold-starts. Copiamos
 * pra `FileSystem.documentDirectory/avatars/` pra que a foto sobreviva
 * fechamento do app, atualizacao etc. Path final salvo no SQLite via
 * riderRepository.
 *
 * Quality 0.6 + aspect [1,1] + allowsEditing true = arquivo ~50-200KB,
 * suficiente pra render circular pequeno e medio sem inflar a app.
 */

const AVATAR_DIR = `${FileSystem.documentDirectory ?? ''}avatars/`;

export interface PickAvatarResult {
  ok: boolean;
  uri?: string;
  /** Codigo curto pra UX: 'permission_denied' | 'cancelled' | 'error'. */
  reason?: 'permission_denied' | 'cancelled' | 'error';
  errorMessage?: string;
}

/**
 * Garante que o diretorio de avatares existe. Idempotente.
 */
async function ensureAvatarDir(): Promise<void> {
  if (FileSystem.documentDirectory === null) {
    // Plataformas/contextos sem documentDirectory (extremamente raro fora
    // de testes). Caller vai falhar no `copyAsync` adiante.
    return;
  }
  const info = await FileSystem.getInfoAsync(AVATAR_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(AVATAR_DIR, { intermediates: true });
  }
}

/**
 * Abre o galeria, deixa o piloto cortar (square), e copia o resultado
 * pro documentDirectory. Retorna o URI persistente.
 */
export async function pickAndPersistAvatar(): Promise<PickAvatarResult> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      return { ok: false, reason: 'permission_denied' };
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
      exif: false,
    });

    if (picked.canceled) {
      return { ok: false, reason: 'cancelled' };
    }
    const asset = picked.assets[0];
    if (!asset) {
      return { ok: false, reason: 'error', errorMessage: 'Sem asset' };
    }

    await ensureAvatarDir();

    // Nome do arquivo unico por timestamp + sufixo do asset original — evita
    // colisao entre cold-starts e mantem o velho ate o riderRepository
    // confirmar o save (a limpeza fica pra `removeAvatar` ou para o user
    // sobrescrever).
    const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
    const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'jpg';
    const filename = `avatar-${Date.now()}.${safeExt}`;
    const destUri = `${AVATAR_DIR}${filename}`;

    await FileSystem.copyAsync({ from: asset.uri, to: destUri });

    return { ok: true, uri: destUri };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'error', errorMessage: message };
  }
}

/**
 * Apaga um arquivo de avatar previamente persistido. Idempotente — nao
 * lanca se o arquivo nao existe. Usado quando o piloto troca de foto
 * (apaga a anterior) ou quando reseta o perfil.
 */
export async function removeAvatarFile(uri: string | undefined): Promise<void> {
  if (uri === undefined || !uri.startsWith(AVATAR_DIR)) return;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch {
    // best-effort
  }
}

/**
 * Helper UX: extrai a inicial do nome do piloto (uppercase, ASCII letter).
 * Fallback pra "?" quando o nome nao tem letra (extremo defensivo).
 */
export function avatarInitial(displayName: string | undefined): string {
  if (typeof displayName !== 'string') return '?';
  const trimmed = displayName.trim();
  if (trimmed.length === 0) return '?';
  const first = trimmed.charAt(0).toUpperCase();
  return /[A-Z]/.test(first) || /[À-Ÿ]/.test(first) ? first : '?';
}
