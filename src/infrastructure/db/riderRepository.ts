import * as SQLite from 'expo-sqlite';
import type {
  EstiloPilotagem,
  Genero,
  PreferenciaTempo,
  RiderProfile,
  RiderProfileInput,
} from '../../domains/rider/types';
import { createId } from '../../shared/utils/id';

export interface RiderRepository {
  /** Returns the single profile row, or null if the user hasn't set it up yet. */
  get(): Promise<RiderProfile | null>;
  /**
   * Upserts the single profile row. The repo OWNS the id (created on first
   * insert, preserved on update) so callers do not need to round-trip a read
   * before writing.
   */
  save(input: RiderProfileInput): Promise<RiderProfile>;
  /** Deletes the profile row. Idempotent — succeeds even when the row is absent. */
  clear(): Promise<void>;
}

interface RiderRow {
  id: string;
  display_name: string;
  cidade: string;
  estado: string;
  anos_pilotando: number | null;
  genero: string | null;
  estilo_pilotagem: string | null;
  preferencia_tempo: string | null;
  bio: string | null;
  avatar_uri: string | null;
  created_at: number;
  updated_at: number;
}

const SELECT_COLUMNS =
  'id, display_name, cidade, estado, anos_pilotando, genero, estilo_pilotagem, preferencia_tempo, bio, avatar_uri, created_at, updated_at';

const VALID_GENEROS: readonly string[] = [
  'feminino',
  'masculino',
  'nao-binario',
  'prefiro-nao-dizer',
];
const VALID_ESTILOS: readonly string[] = [
  'urbano',
  'estrada',
  'trail',
  'misto',
];
const VALID_PREFERENCIAS: readonly string[] = [
  'sol',
  'qualquer',
  'evito-chuva',
];

// Each enum mapper rejects unexpected values defensively. If somebody hand-edits
// the SQLite file (or a buggy migration leaves garbage), we return undefined
// instead of letting an invalid union value escape into the domain.
function asGenero(raw: string | null): Genero | undefined {
  if (raw === null) return undefined;
  return VALID_GENEROS.includes(raw) ? (raw as Genero) : undefined;
}

function asEstilo(raw: string | null): EstiloPilotagem | undefined {
  if (raw === null) return undefined;
  return VALID_ESTILOS.includes(raw) ? (raw as EstiloPilotagem) : undefined;
}

function asPreferencia(raw: string | null): PreferenciaTempo | undefined {
  if (raw === null) return undefined;
  return VALID_PREFERENCIAS.includes(raw)
    ? (raw as PreferenciaTempo)
    : undefined;
}

function rowToDomain(row: RiderRow): RiderProfile {
  const profile: RiderProfile = {
    id: row.id,
    displayName: row.display_name,
    cidade: row.cidade,
    estado: row.estado,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (typeof row.anos_pilotando === 'number') {
    profile.anosPilotando = row.anos_pilotando;
  }
  const genero = asGenero(row.genero);
  if (genero !== undefined) profile.genero = genero;
  const estilo = asEstilo(row.estilo_pilotagem);
  if (estilo !== undefined) profile.estiloPilotagem = estilo;
  const pref = asPreferencia(row.preferencia_tempo);
  if (pref !== undefined) profile.preferenciaTempo = pref;
  if (typeof row.bio === 'string' && row.bio.length > 0) {
    profile.bio = row.bio;
  }
  if (typeof row.avatar_uri === 'string' && row.avatar_uri.length > 0) {
    profile.avatarUri = row.avatar_uri;
  }
  return profile;
}

function trimOrNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createSqliteRiderRepository(
  db: SQLite.SQLiteDatabase,
): RiderRepository {
  return {
    async get(): Promise<RiderProfile | null> {
      const row = await db.getFirstAsync<RiderRow>(
        `SELECT ${SELECT_COLUMNS} FROM rider_profile WHERE singleton_id = 1`,
      );
      return row ? rowToDomain(row) : null;
    },

    async save(input: RiderProfileInput): Promise<RiderProfile> {
      // Preserve `id` + `created_at` from any existing row so save behaves
      // as an upsert keyed on the singleton constraint.
      const existing = await db.getFirstAsync<RiderRow>(
        `SELECT ${SELECT_COLUMNS} FROM rider_profile WHERE singleton_id = 1`,
      );
      const now = Date.now();
      const id = existing ? existing.id : createId();
      const createdAt = existing ? existing.created_at : now;

      const displayName = input.displayName.trim();
      const cidade = input.cidade.trim();
      const estado = input.estado.trim().toUpperCase();
      const anosPilotando =
        typeof input.anosPilotando === 'number' &&
        Number.isFinite(input.anosPilotando)
          ? Math.trunc(input.anosPilotando)
          : null;
      const genero = input.genero ?? null;
      const estilo = input.estiloPilotagem ?? null;
      const preferencia = input.preferenciaTempo ?? null;
      const bio = trimOrNull(input.bio);
      const avatarUri = trimOrNull(input.avatarUri);

      await db.runAsync(
        `INSERT INTO rider_profile (
          singleton_id, id, display_name, cidade, estado,
          anos_pilotando, genero, estilo_pilotagem, preferencia_tempo,
          bio, avatar_uri, created_at, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(singleton_id) DO UPDATE SET
          display_name = excluded.display_name,
          cidade = excluded.cidade,
          estado = excluded.estado,
          anos_pilotando = excluded.anos_pilotando,
          genero = excluded.genero,
          estilo_pilotagem = excluded.estilo_pilotagem,
          preferencia_tempo = excluded.preferencia_tempo,
          bio = excluded.bio,
          avatar_uri = excluded.avatar_uri,
          updated_at = excluded.updated_at`,
        [
          id,
          displayName,
          cidade,
          estado,
          anosPilotando,
          genero,
          estilo,
          preferencia,
          bio,
          avatarUri,
          createdAt,
          now,
        ],
      );

      const profile: RiderProfile = {
        id,
        displayName,
        cidade,
        estado,
        createdAt,
        updatedAt: now,
      };
      if (anosPilotando !== null) profile.anosPilotando = anosPilotando;
      if (genero !== null) profile.genero = genero;
      if (estilo !== null) profile.estiloPilotagem = estilo;
      if (preferencia !== null) profile.preferenciaTempo = preferencia;
      if (bio !== null) profile.bio = bio;
      if (avatarUri !== null) profile.avatarUri = avatarUri;
      return profile;
    },

    async clear(): Promise<void> {
      // Idempotent: DELETE with no matching row simply returns changes=0.
      await db.runAsync('DELETE FROM rider_profile WHERE singleton_id = 1');
    },
  };
}
