import type { MotorcycleInput } from './types';

export interface MotorcycleValidationError {
  field: keyof MotorcycleInput;
  message: string;
}

export interface MotorcycleValidationResult {
  valid: boolean;
  errors: MotorcycleValidationError[];
}

const MIN_BRAND_LENGTH = 2;
const MIN_MODEL_LENGTH = 1;
const MAX_TANK_CAPACITY_L = 100;
const MAX_AVERAGE_CONSUMP_KM_PER_L = 100;
const MAX_OWNER_NAME_LENGTH = 30;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateMotorcycleInput(
  input: Partial<MotorcycleInput>,
): MotorcycleValidationResult {
  const errors: MotorcycleValidationError[] = [];

  const { brand, model, tankCapacity, averageConsump, ownerName } = input;

  // ownerName is OPTIONAL — if provided, must be non-empty after trim and
  // within the length cap. Empty / missing is fine (older bikes do not have
  // a name set; that just yields a "brand model" display in the comboio).
  if (ownerName !== undefined && ownerName !== null && ownerName !== '') {
    if (!isNonEmptyString(ownerName)) {
      errors.push({
        field: 'ownerName',
        message: 'O apelido nao pode ser apenas espacos.',
      });
    } else if (ownerName.trim().length > MAX_OWNER_NAME_LENGTH) {
      errors.push({
        field: 'ownerName',
        message: `O apelido deve ter ate ${MAX_OWNER_NAME_LENGTH} caracteres.`,
      });
    }
  }

  if (!isNonEmptyString(brand)) {
    errors.push({
      field: 'brand',
      message: 'A marca e obrigatoria.',
    });
  } else if (brand.trim().length < MIN_BRAND_LENGTH) {
    errors.push({
      field: 'brand',
      message: `A marca deve ter pelo menos ${MIN_BRAND_LENGTH} caracteres.`,
    });
  }

  if (!isNonEmptyString(model)) {
    errors.push({
      field: 'model',
      message: 'O modelo e obrigatorio.',
    });
  } else if (model.trim().length < MIN_MODEL_LENGTH) {
    errors.push({
      field: 'model',
      message: `O modelo deve ter pelo menos ${MIN_MODEL_LENGTH} caractere.`,
    });
  }

  if (!isFiniteNumber(tankCapacity)) {
    errors.push({
      field: 'tankCapacity',
      message: 'A capacidade do tanque deve ser um numero valido.',
    });
  } else if (tankCapacity <= 0 || tankCapacity > MAX_TANK_CAPACITY_L) {
    errors.push({
      field: 'tankCapacity',
      message: `A capacidade do tanque deve ser maior que 0 e menor ou igual a ${MAX_TANK_CAPACITY_L} litros.`,
    });
  }

  if (!isFiniteNumber(averageConsump)) {
    errors.push({
      field: 'averageConsump',
      message: 'O consumo medio deve ser um numero valido.',
    });
  } else if (
    averageConsump <= 0 ||
    averageConsump > MAX_AVERAGE_CONSUMP_KM_PER_L
  ) {
    errors.push({
      field: 'averageConsump',
      message: `O consumo medio deve ser maior que 0 e menor ou igual a ${MAX_AVERAGE_CONSUMP_KM_PER_L} km/L.`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
