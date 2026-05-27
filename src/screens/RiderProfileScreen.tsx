import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '@/shared/components/Screen';
import { BigButton } from '@/shared/components/BigButton';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { LabeledInput } from '@/shared/components/LabeledInput';
import { Chip } from '@/shared/components/catalog/Chip';
import { Avatar } from '@/shared/components/rider/Avatar';
import { colors, radius, spacing, typography } from '@/shared/theme';
import { useRiderStore } from '@/state/riderStore';
import { useMotorcycleStore } from '@/state/motorcycleStore';
import { useMovementLock } from '@/shared/hooks/useMovementLock';
import { validateRiderProfileInput } from '@/domains/rider/validator';
import {
  avatarInitial,
  pickAndPersistAvatar,
  removeAvatarFile,
} from '@/domains/rider/avatar';
import type {
  EstiloPilotagem,
  Genero,
  PreferenciaTempo,
  RiderProfileInput,
} from '@/domains/rider/types';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'RiderProfile'>;

type FieldErrors = Partial<Record<keyof RiderProfileInput, string>>;

interface ChipOption<T extends string> {
  value: T;
  label: string;
}

// Chip options live as module-level constants so identity is stable across
// renders (avoids an array re-allocation per keystroke).
const GENERO_OPTIONS: ReadonlyArray<ChipOption<Genero>> = [
  { value: 'feminino', label: 'FEMININO' },
  { value: 'masculino', label: 'MASCULINO' },
  { value: 'nao-binario', label: 'NAO-BINARIO' },
  { value: 'prefiro-nao-dizer', label: 'PREFIRO NAO DIZER' },
];

const ESTILO_OPTIONS: ReadonlyArray<ChipOption<EstiloPilotagem>> = [
  { value: 'urbano', label: 'URBANO' },
  { value: 'estrada', label: 'ESTRADA' },
  { value: 'trail', label: 'TRAIL' },
  { value: 'misto', label: 'MISTO' },
];

const PREFERENCIA_OPTIONS: ReadonlyArray<ChipOption<PreferenciaTempo>> = [
  { value: 'sol', label: 'SOL' },
  { value: 'qualquer', label: 'QUALQUER' },
  { value: 'evito-chuva', label: 'EVITO CHUVA' },
];

const BIO_MAX = 200;

function parseIntegerOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

export const RiderProfileScreen: React.FC<Props> = ({ navigation }) => {
  const profile = useRiderStore((s) => s.profile);
  const saveProfile = useRiderStore((s) => s.saveProfile);
  const isLoading = useRiderStore((s) => s.isLoading);

  const [displayName, setDisplayName] = useState<string>('');
  const [cidade, setCidade] = useState<string>('');
  const [estado, setEstado] = useState<string>('');
  const [anosPilotando, setAnosPilotando] = useState<string>('');
  const [genero, setGenero] = useState<Genero | null>(null);
  const [estiloPilotagem, setEstiloPilotagem] = useState<EstiloPilotagem | null>(
    null,
  );
  const [preferenciaTempo, setPreferenciaTempo] =
    useState<PreferenciaTempo | null>(null);
  const [bio, setBio] = useState<string>('');
  const [avatarUri, setAvatarUri] = useState<string | undefined>(undefined);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [didSubmit, setDidSubmit] = useState<boolean>(false);
  const [pickingAvatar, setPickingAvatar] = useState<boolean>(false);

  // Movement lock: editing pessoal data while riding is unsafe. Mirror the
  // pattern from MotorcycleSetupScreen — dismiss keyboard + grey out form.
  const { isMoving } = useMovementLock();

  // Pre-fill once when the existing profile becomes available. Bind to the
  // profile id (stable identity) so subsequent saves do not stomp local
  // edits the user is in the middle of typing.
  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName);
    setCidade(profile.cidade);
    setEstado(profile.estado);
    setAnosPilotando(
      typeof profile.anosPilotando === 'number'
        ? String(profile.anosPilotando)
        : '',
    );
    setGenero(profile.genero ?? null);
    setEstiloPilotagem(profile.estiloPilotagem ?? null);
    setPreferenciaTempo(profile.preferenciaTempo ?? null);
    setBio(profile.bio ?? '');
    setAvatarUri(profile.avatarUri);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  useEffect(() => {
    if (isMoving) Keyboard.dismiss();
  }, [isMoving]);

  const candidate: Partial<RiderProfileInput> = useMemo(() => {
    const base: Partial<RiderProfileInput> = {
      displayName: displayName.trim(),
      cidade: cidade.trim(),
      estado: estado.trim().toUpperCase(),
    };
    const anos = parseIntegerOrUndefined(anosPilotando);
    if (anos !== undefined) base.anosPilotando = anos;
    if (genero !== null) base.genero = genero;
    if (estiloPilotagem !== null) base.estiloPilotagem = estiloPilotagem;
    if (preferenciaTempo !== null) base.preferenciaTempo = preferenciaTempo;
    if (bio.length > 0) base.bio = bio;
    if (typeof avatarUri === 'string' && avatarUri.length > 0) {
      base.avatarUri = avatarUri;
    }
    return base;
  }, [
    displayName,
    cidade,
    estado,
    anosPilotando,
    genero,
    estiloPilotagem,
    preferenciaTempo,
    bio,
    avatarUri,
  ]);

  const validation = useMemo(
    () => validateRiderProfileInput(candidate),
    [candidate],
  );

  // We only surface field errors AFTER the rider attempts to save once.
  // Otherwise the form would scream "required" before they've typed a single
  // character — the LabeledInput red border is too loud for a first-load
  // empty-state.
  const fieldErrors: FieldErrors = useMemo(() => {
    if (!didSubmit) return {};
    const map: FieldErrors = {};
    for (const err of validation.errors) {
      if (!map[err.field]) {
        map[err.field] = err.message;
      }
    }
    return map;
  }, [validation, didSubmit]);

  const valid = validation.valid;
  const canSave = valid && !submitting && !isLoading && !isMoving;

  const handleSave = async (): Promise<void> => {
    setDidSubmit(true);
    setSubmitError(null);
    if (!valid) return;
    setSubmitting(true);
    try {
      // candidate is Partial<RiderProfileInput> by construction; validator just
      // confirmed `valid === true` so all REQUIRED fields are present.
      const input: RiderProfileInput = {
        displayName: candidate.displayName ?? '',
        cidade: candidate.cidade ?? '',
        estado: candidate.estado ?? '',
        ...(candidate.anosPilotando !== undefined && {
          anosPilotando: candidate.anosPilotando,
        }),
        ...(candidate.genero !== undefined && { genero: candidate.genero }),
        ...(candidate.estiloPilotagem !== undefined && {
          estiloPilotagem: candidate.estiloPilotagem,
        }),
        ...(candidate.preferenciaTempo !== undefined && {
          preferenciaTempo: candidate.preferenciaTempo,
        }),
        ...(candidate.bio !== undefined && { bio: candidate.bio }),
        ...(candidate.avatarUri !== undefined && {
          avatarUri: candidate.avatarUri,
        }),
      };
      await saveProfile(input);
      // F33 onboarding: se o piloto ainda nao cadastrou nenhuma moto,
      // direcionamos pra MotorcycleSetup direto apos salvar — caso tipico
      // do primeiro uso (zero motos + zero perfil). Pra edicoes posteriores
      // (perfil ja existia OU motos ja cadastradas), goBack mantem o
      // comportamento atual de "volta pra onde estava".
      const motorcyclesCount =
        useMotorcycleStore.getState().motorcycles.length;
      if (motorcyclesCount === 0) {
        navigation.reset({
          index: 0,
          routes: [{ name: 'MotorcycleSetup' }],
        });
      } else {
        navigation.goBack();
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao salvar o perfil.';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePickAvatar = async (): Promise<void> => {
    if (pickingAvatar || isMoving) return;
    setPickingAvatar(true);
    try {
      const result = await pickAndPersistAvatar();
      if (result.ok && result.uri) {
        const previous = avatarUri;
        setAvatarUri(result.uri);
        // Limpa a foto anterior do disco depois que a nova foi setada
        // no estado — best-effort, falha silenciosa.
        if (previous !== undefined && previous !== result.uri) {
          void removeAvatarFile(previous);
        }
      } else if (result.reason === 'permission_denied') {
        Alert.alert(
          'Permissão negada',
          'Permita acesso à galeria nas configurações do dispositivo pra escolher uma foto.',
        );
      } else if (result.reason === 'error') {
        Alert.alert(
          'Erro',
          result.errorMessage ?? 'Não foi possível abrir a galeria.',
        );
      }
    } finally {
      setPickingAvatar(false);
    }
  };

  const handleOpenMotorcycles = (): void => {
    navigation.navigate('MotorcycleSetup');
  };

  const bioLengthLabel = `${bio.length}/${BIO_MAX}`;

  return (
    <Screen scroll padding testID="screen-rider-profile">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.headerBlock}>
          <Text style={styles.title}>Meu Perfil</Text>
          <Text style={styles.subtitle}>
            Esses dados sao usados pra personalizar comboios, catalogo e futuras
            sugestoes de rota.
          </Text>
        </View>

        <View style={styles.avatarBlock} testID="rider-avatar-block">
          <Avatar
            uri={avatarUri}
            initial={avatarInitial(displayName || profile?.displayName)}
            size={104}
            onPress={() => {
              void handlePickAvatar();
            }}
            testID="rider-avatar"
          />
          {pickingAvatar ? (
            <Text style={styles.avatarHint}>Abrindo galeria…</Text>
          ) : (
            <Text style={styles.avatarHint}>
              Toque pra adicionar/trocar foto
            </Text>
          )}
        </View>

        {submitError ? (
          <View style={styles.errorBanner}>
            <StatusBadge
              label="Erro"
              value={submitError}
              state="danger"
              testID="rider-profile-error"
            />
          </View>
        ) : null}

        {isMoving ? (
          <Text style={styles.movementWarning} testID="warning-movement-lock">
            Pare a moto para editar o perfil. Movimento detectado (&gt; 5 km/h).
          </Text>
        ) : null}

        <View
          style={[styles.form, isMoving ? styles.formLocked : null]}
          pointerEvents={isMoving ? 'none' : 'auto'}
        >
          <LabeledInput
            label="Nome / Apelido"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Ex.: Willian"
            autoCapitalize="words"
            error={fieldErrors.displayName}
            testID="input-display-name"
          />
          <LabeledInput
            label="Cidade"
            value={cidade}
            onChangeText={setCidade}
            placeholder="Ex.: Diadema"
            autoCapitalize="words"
            error={fieldErrors.cidade}
            testID="input-cidade"
          />
          <LabeledInput
            label="Estado (UF)"
            value={estado}
            // Cap at 2 chars + uppercase eagerly so the validator does not
            // need to lower-case-check on every keystroke. We avoid filtering
            // non-letters here — the validator will reject and the user
            // sees the inline error after the first save attempt.
            onChangeText={(t) => setEstado(t.toUpperCase().slice(0, 2))}
            placeholder="SP"
            autoCapitalize="characters"
            error={fieldErrors.estado}
            testID="input-estado"
          />
          <LabeledInput
            label="Anos pilotando (opcional)"
            value={anosPilotando}
            onChangeText={setAnosPilotando}
            placeholder="0"
            keyboardType="numeric"
            error={fieldErrors.anosPilotando}
            testID="input-anos-pilotando"
          />

          <Text style={styles.sectionTitle}>GENERO</Text>
          <View style={styles.chipsRow} testID="chips-genero">
            {GENERO_OPTIONS.map((opt) => (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={genero === opt.value}
                // Tapping a selected chip clears it — keeps the field
                // optional (cannot get stuck on a value once chosen).
                onPress={() =>
                  setGenero(genero === opt.value ? null : opt.value)
                }
                testID={`chip-genero-${opt.value}`}
              />
            ))}
          </View>

          <Text style={styles.sectionTitle}>ESTILO DE PILOTAGEM</Text>
          <View style={styles.chipsRow} testID="chips-estilo">
            {ESTILO_OPTIONS.map((opt) => (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={estiloPilotagem === opt.value}
                onPress={() =>
                  setEstiloPilotagem(
                    estiloPilotagem === opt.value ? null : opt.value,
                  )
                }
                testID={`chip-estilo-${opt.value}`}
              />
            ))}
          </View>

          <Text style={styles.sectionTitle}>TEMPO PREFERIDO</Text>
          <View style={styles.chipsRow} testID="chips-preferencia">
            {PREFERENCIA_OPTIONS.map((opt) => (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={preferenciaTempo === opt.value}
                onPress={() =>
                  setPreferenciaTempo(
                    preferenciaTempo === opt.value ? null : opt.value,
                  )
                }
                testID={`chip-preferencia-${opt.value}`}
              />
            ))}
          </View>

          <Text style={styles.sectionTitle}>BIO (OPCIONAL)</Text>
          <View
            style={[
              styles.bioWrap,
              fieldErrors.bio ? styles.bioWrapError : null,
            ]}
            testID="input-bio"
          >
            <TextInput
              value={bio}
              onChangeText={(t) => setBio(t.slice(0, BIO_MAX))}
              placeholder="Conte um pouco sobre voce e suas pedaladas."
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={4}
              maxLength={BIO_MAX}
              style={styles.bioInput}
              testID="input-bio-input"
            />
            <Text style={styles.bioCount}>{bioLengthLabel}</Text>
          </View>
          {fieldErrors.bio ? (
            <Text style={styles.bioErrorText} testID="input-bio-error">
              {fieldErrors.bio}
            </Text>
          ) : null}
        </View>

        <View style={styles.saveBlock}>
          <BigButton
            label={submitting ? 'SALVANDO...' : 'SALVAR PERFIL'}
            variant="primary"
            disabled={isMoving || !canSave}
            fullWidth
            onPress={() => {
              void handleSave();
            }}
            testID="btn-save-rider"
          />
        </View>

        <View style={styles.secondaryBlock}>
          <BigButton
            label="MINHAS MOTOS"
            variant="secondary"
            fullWidth
            onPress={handleOpenMotorcycles}
            testID="btn-rider-go-motos"
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
  avatarBlock: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  avatarHint: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    marginTop: spacing.sm,
    fontStyle: 'italic',
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
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacing.xs,
  },
  bioWrap: {
    minHeight: 96,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  bioWrapError: {
    borderColor: colors.danger,
  },
  bioInput: {
    color: colors.textPrimary,
    fontSize: typography.sizes.lg,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  bioCount: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    textAlign: 'right',
    marginTop: spacing.xs,
  },
  bioErrorText: {
    color: colors.danger,
    fontSize: typography.sizes.sm,
    marginTop: spacing.xs,
  },
  saveBlock: {
    marginTop: spacing.xl,
  },
  secondaryBlock: {
    marginTop: spacing.md,
  },
});
