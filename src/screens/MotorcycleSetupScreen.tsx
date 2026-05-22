import React, { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '@/shared/components/Screen';
import { BigButton } from '@/shared/components/BigButton';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { LabeledInput } from '@/shared/components/LabeledInput';
import { colors, spacing, typography } from '@/shared/theme';
import { useMotorcycleStore } from '@/state/motorcycleStore';
import { useMovementLock } from '@/shared/hooks/useMovementLock';
import { validateMotorcycleInput } from '@/domains/motorcycle/validator';
import type {
  MotorcycleInput,
  Motorcycle,
} from '@/domains/motorcycle/types';
import {
  calculateMaxAutonomy,
  calculateSafeAutonomy,
} from '@/domains/fuel/autonomy';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'MotorcycleSetup'>;

type FieldErrors = Partial<Record<keyof MotorcycleInput, string>>;

function parseNumberPtBr(value: string): number {
  const normalized = value.replace(/,/g, '.').trim();
  if (normalized.length === 0) return NaN;
  return parseFloat(normalized);
}

export const MotorcycleSetupScreen: React.FC<Props> = ({
  route,
  navigation,
}) => {
  const editMotorcycleId = route.params?.editMotorcycleId;

  const motorcycles = useMotorcycleStore((s) => s.motorcycles);
  const addMotorcycle = useMotorcycleStore((s) => s.addMotorcycle);
  const updateMotorcycle = useMotorcycleStore((s) => s.updateMotorcycle);
  const setActiveMotorcycle = useMotorcycleStore((s) => s.setActiveMotorcycle);

  const editing: Motorcycle | undefined = editMotorcycleId
    ? motorcycles.find((m) => m.id === editMotorcycleId)
    : undefined;

  const [ownerName, setOwnerName] = useState<string>('');
  const [brand, setBrand] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [tankCapacity, setTankCapacity] = useState<string>('');
  const [averageConsump, setAverageConsump] = useState<string>('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Movement lock: editing motorcycle data while riding is unsafe. We dismiss
  // the keyboard and block pointer events on the form when isMoving is true.
  const { isMoving } = useMovementLock();

  useEffect(() => {
    if (editing) {
      setOwnerName(editing.ownerName ?? '');
      setBrand(editing.brand);
      setModel(editing.model);
      setTankCapacity(String(editing.tankCapacity));
      setAverageConsump(String(editing.averageConsump));
    }
    // Only on mount / when editing target changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  // Dismiss the soft keyboard on every transition INTO isMoving=true.
  useEffect(() => {
    if (isMoving) {
      Keyboard.dismiss();
    }
  }, [isMoving]);

  const tankCapacityNum = parseNumberPtBr(tankCapacity);
  const averageConsumpNum = parseNumberPtBr(averageConsump);

  const validation = useMemo(
    () =>
      validateMotorcycleInput({
        ownerName: ownerName.trim(),
        brand: brand.trim(),
        model: model.trim(),
        tankCapacity: tankCapacityNum,
        averageConsump: averageConsumpNum,
      }),
    [ownerName, brand, model, tankCapacityNum, averageConsumpNum],
  );

  const fieldErrors: FieldErrors = useMemo(() => {
    const map: FieldErrors = {};
    for (const err of validation.errors) {
      if (!map[err.field]) {
        map[err.field] = err.message;
      }
    }
    return map;
  }, [validation]);

  const showPreview =
    Number.isFinite(tankCapacityNum) &&
    Number.isFinite(averageConsumpNum) &&
    tankCapacityNum > 0 &&
    averageConsumpNum > 0;

  const maxAutonomy = showPreview
    ? calculateMaxAutonomy(tankCapacityNum, averageConsumpNum)
    : 0;
  const safeAutonomy = showPreview ? calculateSafeAutonomy(maxAutonomy) : 0;

  const valid = validation.valid;
  const canSave = valid && !submitting && !isMoving;

  const handleSave = async (): Promise<void> => {
    if (!canSave) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const input: MotorcycleInput = {
        brand: brand.trim(),
        model: model.trim(),
        tankCapacity: tankCapacityNum,
        averageConsump: averageConsumpNum,
      };
      const trimmedOwner = ownerName.trim();
      if (trimmedOwner.length > 0) {
        input.ownerName = trimmedOwner;
      }
      let savedId: string;
      if (editing) {
        await updateMotorcycle(editing.id, input);
        savedId = editing.id;
      } else {
        const created = await addMotorcycle(input);
        savedId = created.id;
      }
      setActiveMotorcycle(savedId);
      navigation.replace('Home');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao salvar a moto.';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll padding>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.headerBlock}>
          <Text style={styles.title}>Cadastro da Moto</Text>
          <Text style={styles.subtitle}>
            Estes dados alimentam o calculo de autonomia em tempo real.
          </Text>
        </View>

        {submitError ? (
          <View style={styles.errorBanner}>
            <StatusBadge
              label="Erro"
              value={submitError}
              state="danger"
              testID="motorcycle-setup-error"
            />
          </View>
        ) : null}

        {isMoving ? (
          <Text style={styles.movementWarning} testID="warning-movement-lock">
            Pare a moto para editar os dados. Movimento detectado (&gt; 5 km/h).
          </Text>
        ) : null}

        <View
          style={[styles.form, isMoving ? styles.formLocked : null]}
          pointerEvents={isMoving ? 'none' : 'auto'}
        >
          <LabeledInput
            label="Apelido / Nome do piloto (opcional)"
            value={ownerName}
            onChangeText={setOwnerName}
            placeholder="Ex: Willian"
            autoCapitalize="words"
            error={fieldErrors.ownerName}
            testID="input-owner-name"
          />
          <LabeledInput
            label="Marca"
            value={brand}
            onChangeText={setBrand}
            placeholder="Ex: Honda"
            autoCapitalize="words"
            error={fieldErrors.brand}
            testID="input-brand"
          />
          <LabeledInput
            label="Modelo"
            value={model}
            onChangeText={setModel}
            placeholder="Ex: CB 500F"
            autoCapitalize="words"
            error={fieldErrors.model}
            testID="input-model"
          />
          <LabeledInput
            label="Capacidade do tanque (L)"
            value={tankCapacity}
            onChangeText={setTankCapacity}
            placeholder="Ex: 17"
            keyboardType="decimal-pad"
            error={fieldErrors.tankCapacity}
            testID="input-tank-capacity"
          />
          <LabeledInput
            label="Consumo medio (km/L)"
            value={averageConsump}
            onChangeText={setAverageConsump}
            placeholder="Ex: 22"
            keyboardType="decimal-pad"
            error={fieldErrors.averageConsump}
            testID="input-average-consump"
          />
        </View>

        {showPreview ? (
          <View style={styles.previewBlock}>
            <Text style={styles.previewTitle}>Preview de Autonomia</Text>
            <View style={styles.previewRow}>
              <StatusBadge
                label="Autonomia Maxima"
                value={`${maxAutonomy.toFixed(0)} km`}
                state="neutral"
                testID="preview-max-autonomy"
              />
              <View style={styles.previewSpacer} />
              <StatusBadge
                label="Autonomia Segura"
                value={`${safeAutonomy.toFixed(0)} km`}
                state="neutral"
                testID="preview-safe-autonomy"
              />
            </View>
          </View>
        ) : null}

        <View style={styles.saveBlock}>
          <BigButton
            label={submitting ? 'SALVANDO...' : 'SALVAR MOTO'}
            variant="primary"
            // Disable while moving, while already submitting, or while the
            // form is invalid. canSave folds all three together; the explicit
            // isMoving||!valid clause documents the movement-lock rule.
            disabled={isMoving || !valid || !canSave}
            fullWidth
            onPress={() => {
              void handleSave();
            }}
            testID="btn-save-motorcycle"
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerBlock: {
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.accent,
    fontSize: typography.navPrimary.fontSize,
    fontWeight: typography.navPrimary.fontWeight,
    lineHeight: typography.navPrimary.lineHeight,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    marginTop: spacing.xs,
  },
  errorBanner: {
    marginBottom: spacing.md,
  },
  form: {
    gap: spacing.md,
  },
  formLocked: {
    opacity: 0.5,
  },
  movementWarning: {
    color: colors.warning,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
    marginBottom: spacing.md,
  },
  previewBlock: {
    marginTop: spacing.xl,
  },
  previewTitle: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
    marginBottom: spacing.sm,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  previewSpacer: {
    width: spacing.sm,
    height: spacing.sm,
  },
  saveBlock: {
    marginTop: spacing.xl,
  },
});
