import type {
  EstiloPilotagem,
  Genero,
  PreferenciaTempo,
  RiderProfileInput,
} from './types';

export interface RiderProfileValidationError {
  field: keyof RiderProfileInput;
  message: string;
}

export interface RiderProfileValidationResult {
  valid: boolean;
  errors: RiderProfileValidationError[];
}

const MIN_DISPLAY_NAME = 2;
const MAX_DISPLAY_NAME = 40;
const MIN_CIDADE = 2;
const MAX_CIDADE = 60;
const ESTADO_LENGTH = 2;
const ANOS_MIN = 0;
const ANOS_MAX = 80;
const BIO_MAX = 200;

// Enum tables sao mantidas aqui (em vez de no `types.ts`) porque o validador
// eh a unica fronteira que precisa validar valores cruus vindos da UI.
const GENEROS: readonly Genero[] = [
  'feminino',
  'masculino',
  'nao-binario',
  'prefiro-nao-dizer',
];
const ESTILOS: readonly EstiloPilotagem[] = [
  'urbano',
  'estrada',
  'trail',
  'misto',
];
const PREFERENCIAS: readonly PreferenciaTempo[] = [
  'sol',
  'qualquer',
  'evito-chuva',
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateRiderProfileInput(
  input: Partial<RiderProfileInput>,
): RiderProfileValidationResult {
  const errors: RiderProfileValidationError[] = [];

  const {
    displayName,
    cidade,
    estado,
    anosPilotando,
    genero,
    estiloPilotagem,
    preferenciaTempo,
    bio,
  } = input;

  // displayName: obrigatorio, 2-40 chars apos trim.
  if (!isNonEmptyString(displayName)) {
    errors.push({
      field: 'displayName',
      message: 'O nome do piloto e obrigatorio.',
    });
  } else {
    const trimmed = displayName.trim();
    if (trimmed.length < MIN_DISPLAY_NAME) {
      errors.push({
        field: 'displayName',
        message: `O nome deve ter pelo menos ${MIN_DISPLAY_NAME} caracteres.`,
      });
    } else if (trimmed.length > MAX_DISPLAY_NAME) {
      errors.push({
        field: 'displayName',
        message: `O nome deve ter ate ${MAX_DISPLAY_NAME} caracteres.`,
      });
    }
  }

  // cidade: obrigatoria, 2-60 chars.
  if (!isNonEmptyString(cidade)) {
    errors.push({
      field: 'cidade',
      message: 'A cidade e obrigatoria.',
    });
  } else {
    const trimmed = cidade.trim();
    if (trimmed.length < MIN_CIDADE) {
      errors.push({
        field: 'cidade',
        message: `A cidade deve ter pelo menos ${MIN_CIDADE} caracteres.`,
      });
    } else if (trimmed.length > MAX_CIDADE) {
      errors.push({
        field: 'cidade',
        message: `A cidade deve ter ate ${MAX_CIDADE} caracteres.`,
      });
    }
  }

  // estado: obrigatorio, 2 letras maiusculas exatas (UF).
  if (!isNonEmptyString(estado)) {
    errors.push({
      field: 'estado',
      message: 'O estado (UF) e obrigatorio.',
    });
  } else {
    const raw = estado.trim();
    if (raw.length !== ESTADO_LENGTH || !/^[A-Z]{2}$/.test(raw)) {
      errors.push({
        field: 'estado',
        message: 'O estado deve ser a sigla com 2 letras maiusculas (ex: SP).',
      });
    }
  }

  // anosPilotando: opcional. Se informado, precisa ser numero finito >= 0 e
  // <= 80. Aceitamos zero (pilotos iniciantes).
  if (anosPilotando !== undefined && anosPilotando !== null) {
    if (!isFiniteNumber(anosPilotando)) {
      errors.push({
        field: 'anosPilotando',
        message: 'Anos pilotando deve ser um numero valido.',
      });
    } else if (anosPilotando < ANOS_MIN || anosPilotando > ANOS_MAX) {
      errors.push({
        field: 'anosPilotando',
        message: `Anos pilotando deve ficar entre ${ANOS_MIN} e ${ANOS_MAX}.`,
      });
    } else if (!Number.isInteger(anosPilotando)) {
      errors.push({
        field: 'anosPilotando',
        message: 'Anos pilotando deve ser um numero inteiro.',
      });
    }
  }

  if (genero !== undefined && !GENEROS.includes(genero)) {
    errors.push({
      field: 'genero',
      message: 'Genero invalido.',
    });
  }

  if (estiloPilotagem !== undefined && !ESTILOS.includes(estiloPilotagem)) {
    errors.push({
      field: 'estiloPilotagem',
      message: 'Estilo de pilotagem invalido.',
    });
  }

  if (
    preferenciaTempo !== undefined &&
    !PREFERENCIAS.includes(preferenciaTempo)
  ) {
    errors.push({
      field: 'preferenciaTempo',
      message: 'Preferencia de tempo invalida.',
    });
  }

  // bio: opcional, ate 200 chars. String vazia e tratada como "sem bio".
  if (bio !== undefined && bio !== null && bio !== '') {
    if (typeof bio !== 'string') {
      errors.push({
        field: 'bio',
        message: 'A bio deve ser um texto.',
      });
    } else if (bio.length > BIO_MAX) {
      errors.push({
        field: 'bio',
        message: `A bio deve ter ate ${BIO_MAX} caracteres.`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
