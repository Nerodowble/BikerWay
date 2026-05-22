import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BigButton } from '@/shared/components/BigButton';
import { LabeledInput } from '@/shared/components/LabeledInput';
import { RadioRow } from '@/shared/components/catalog/RadioRow';
import { Chip } from '@/shared/components/catalog/Chip';
import { colors, radius, spacing, typography } from '@/shared/theme';
import { nominatimClient } from '@/infrastructure/geocoding/nominatimClient';
import { useCatalogStore } from '@/state/catalogStore';
import { useNavigationStore } from '@/state/navigationStore';
import {
  selectActiveMotorcycle,
  useMotorcycleStore,
} from '@/state/motorcycleStore';
import {
  calculateMaxAutonomy,
  calculateSafeAutonomy,
} from '@/domains/fuel/autonomy';
import type { Motorcycle } from '@/domains/motorcycle/types';
import type { NivelCurvas } from '@/domains/catalog/types';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'CatalogFilters'>;

type OriginMode = 'gps' | 'city';
// We only expose the user-pickable subset (asfalto/misto) to the chips —
// "terra" is a dataset-only value, never a UI filter.
type PavimentoChoice = 'asfalto' | 'misto' | 'qualquer';
type NivelChoice = NivelCurvas | 'qualquer';

interface RadioOption<T extends string> {
  value: T;
  label: string;
}

const ORIGIN_OPTIONS: ReadonlyArray<RadioOption<OriginMode>> = [
  { value: 'gps', label: 'Usar minha localização atual (GPS)' },
  { value: 'city', label: 'Digitar outra cidade de partida' },
];

const PAVIMENTO_OPTIONS: ReadonlyArray<RadioOption<PavimentoChoice>> = [
  { value: 'qualquer', label: 'QUALQUER' },
  { value: 'asfalto', label: 'ASFALTO' },
  { value: 'misto', label: 'MISTO' },
];

const NIVEL_OPTIONS: ReadonlyArray<RadioOption<NivelChoice>> = [
  { value: 'qualquer', label: 'QUALQUER' },
  { value: 'baixo', label: 'BAIXO' },
  { value: 'medio', label: 'MÉDIO' },
  { value: 'alto', label: 'ALTO' },
];

function motorcycleSafeAutonomyKm(moto: Motorcycle | null): number {
  if (!moto) return 0;
  const max = calculateMaxAutonomy(moto.tankCapacity, moto.averageConsump);
  return calculateSafeAutonomy(max);
}

export const CatalogFiltersScreen: React.FC<Props> = ({ navigation }) => {
  const userPos = useNavigationStore((s) => s.currentPosition);
  const motorcycles = useMotorcycleStore((s) => s.motorcycles);
  const activeMoto = useMotorcycleStore(selectActiveMotorcycle);

  const setFilters = useCatalogStore((s) => s.setFilters);
  const runSearch = useCatalogStore((s) => s.runSearch);

  const [originMode, setOriginMode] = useState<OriginMode>('gps');
  const [cityQuery, setCityQuery] = useState<string>('');
  const [budgetText, setBudgetText] = useState<string>('');
  const [pavimentoChoice, setPavimentoChoice] =
    useState<PavimentoChoice>('qualquer');
  const [nivelChoice, setNivelChoice] = useState<NivelChoice>('qualquer');
  const [selectedMotoId, setSelectedMotoId] = useState<string | null>(
    activeMoto?.id ?? motorcycles[0]?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const selectedMoto = useMemo<Motorcycle | null>(() => {
    if (!selectedMotoId) return null;
    return motorcycles.find((m) => m.id === selectedMotoId) ?? null;
  }, [motorcycles, selectedMotoId]);

  const selectedSafeAutonomy = motorcycleSafeAutonomyKm(selectedMoto);

  const handleClose = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    if (!selectedMoto) {
      setError('Selecione uma moto para a viagem.');
      return;
    }
    const budget = Number.parseFloat(budgetText.replace(',', '.'));
    // A blank/zero budget is allowed (treated as "sem limite") so the rider
    // can browse the catalog without committing to a value up-front.
    const budgetValue = Number.isFinite(budget) && budget > 0 ? budget : 0;

    let origin: { latitude: number; longitude: number } | null = null;
    if (originMode === 'gps') {
      if (!userPos) {
        setError('Localização ainda não disponível. Habilite o GPS.');
        return;
      }
      origin = { latitude: userPos.latitude, longitude: userPos.longitude };
    } else {
      const trimmed = cityQuery.trim();
      if (trimmed.length < 3) {
        setError('Digite ao menos 3 caracteres para a cidade de partida.');
        return;
      }
      setIsSubmitting(true);
      try {
        const hits = await nominatimClient.search(trimmed, {
          countryCode: 'br',
          limit: 1,
        });
        const first = hits[0];
        if (!first) {
          setError('Não encontramos essa cidade. Tente outra grafia.');
          setIsSubmitting(false);
          return;
        }
        origin = { latitude: first.latitude, longitude: first.longitude };
      } catch (err) {
        const message =
          err instanceof Error && err.message.length > 0
            ? err.message
            : 'Falha ao buscar a cidade.';
        setError(message);
        setIsSubmitting(false);
        return;
      }
    }

    if (!origin) {
      setIsSubmitting(false);
      return;
    }

    setFilters({
      origin,
      budgetReais: budgetValue,
      motoConsumoKmL: selectedMoto.averageConsump,
      motoSafeAutonomyKm: selectedSafeAutonomy,
      pavimento: pavimentoChoice === 'qualquer' ? null : pavimentoChoice,
      nivelCurvas: nivelChoice === 'qualquer' ? null : nivelChoice,
    });
    runSearch();
    setIsSubmitting(false);
    navigation.navigate('CatalogResults');
  }, [
    budgetText,
    cityQuery,
    navigation,
    nivelChoice,
    originMode,
    pavimentoChoice,
    runSearch,
    selectedMoto,
    selectedSafeAutonomy,
    setFilters,
    userPos,
  ]);

  return (
    <SafeAreaView style={styles.safe} testID="screen-catalog-filters">
      <View style={styles.header}>
        <Pressable
          onPress={handleClose}
          hitSlop={12}
          style={({ pressed }) => [
            styles.backButton,
            pressed ? styles.backButtonPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          testID="btn-catalog-filters-back"
        >
          <Text style={styles.backButtonLabel}>{'<'} Voltar</Text>
        </Pressable>
        <Text style={styles.headerTitle}>PLANEJAR VIAGEM</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionTitle}>ONDE VOCÊ ESTÁ?</Text>
        <View style={styles.optionGroup}>
          {ORIGIN_OPTIONS.map((opt) => (
            <RadioRow
              key={opt.value}
              label={opt.label}
              selected={originMode === opt.value}
              onPress={() => setOriginMode(opt.value)}
              testID={`origin-${opt.value}`}
            />
          ))}
        </View>

        {originMode === 'city' ? (
          <View style={styles.cityInputBlock}>
            <LabeledInput
              label="Cidade de partida"
              value={cityQuery}
              onChangeText={setCityQuery}
              placeholder="Ex.: Curitiba"
              testID="input-city-query"
            />
          </View>
        ) : null}

        <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
          QUANTO QUER GASTAR NO MÁXIMO?
        </Text>
        <LabeledInput
          label="Valor disponível (R$)"
          value={budgetText}
          onChangeText={setBudgetText}
          placeholder="150,00"
          keyboardType="decimal-pad"
          testID="input-budget"
        />

        <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
          MOTO SELECIONADA
        </Text>
        {motorcycles.length === 0 ? (
          <Text style={styles.helperText}>
            Cadastre uma moto antes de planejar uma viagem.
          </Text>
        ) : (
          <View style={styles.optionGroup}>
            {motorcycles.map((moto) => {
              const autonomy = motorcycleSafeAutonomyKm(moto);
              const label = `${moto.brand} ${moto.model} (Autonomia: ${Math.round(autonomy)}km)`;
              return (
                <RadioRow
                  key={moto.id}
                  label={label}
                  selected={selectedMotoId === moto.id}
                  onPress={() => setSelectedMotoId(moto.id)}
                  testID={`moto-${moto.id}`}
                />
              );
            })}
          </View>
        )}

        <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
          ESTILO DE ESTRADA
        </Text>
        <View style={styles.chipsRow}>
          {PAVIMENTO_OPTIONS.map((opt) => (
            <Chip
              key={opt.value}
              label={opt.label}
              selected={pavimentoChoice === opt.value}
              onPress={() => setPavimentoChoice(opt.value)}
              testID={`pavimento-${opt.value}`}
            />
          ))}
        </View>

        <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
          NÍVEL DE CURVAS
        </Text>
        <View style={styles.chipsRow}>
          {NIVEL_OPTIONS.map((opt) => (
            <Chip
              key={opt.value}
              label={opt.label}
              selected={nivelChoice === opt.value}
              onPress={() => setNivelChoice(opt.value)}
              testID={`nivel-${opt.value}`}
            />
          ))}
        </View>

        {error ? (
          <Text style={styles.errorText} testID="catalog-filters-error">
            {error}
          </Text>
        ) : null}

        <View style={styles.submitRow}>
          {isSubmitting ? (
            <View style={styles.spinnerWrap}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <BigButton
              label="BUSCAR ROTAS"
              variant="primary"
              fullWidth
              onPress={() => {
                void handleSubmit();
              }}
              testID="btn-buscar-rotas"
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  backButtonPressed: {
    opacity: 0.6,
  },
  backButtonLabel: {
    color: colors.accent,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: typography.display.fontSize,
    fontWeight: typography.display.fontWeight,
    lineHeight: typography.display.lineHeight,
    marginTop: spacing.sm,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    marginBottom: spacing.sm,
  },
  sectionTitleSpaced: {
    marginTop: spacing.xl,
  },
  optionGroup: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingVertical: spacing.xs,
  },
  cityInputBlock: {
    marginTop: spacing.md,
  },
  helperText: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacing.xs,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    marginTop: spacing.md,
  },
  submitRow: {
    marginTop: spacing['2xl'],
  },
  spinnerWrap: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
});
