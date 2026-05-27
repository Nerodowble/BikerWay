import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BigButton } from '@/shared/components/BigButton';
import { colors, radius, spacing, typography } from '@/shared/theme';
import { loadCatalog } from '@/infrastructure/catalog/catalogClient';
import {
  getSavedTripsRepo,
} from '@/infrastructure/db/savedTripsRepository';
import {
  DEFAULT_BUILDER_PROXIMITY_KM,
  eligibleRoutesForNextDay,
} from '@/domains/trips/eligibility';
import {
  formatDdMmYyyy,
  isFutureOrTodayDate,
  parseDdMmYyyy,
} from '@/domains/trips/schedule';
import type { CatalogRoute } from '@/domains/catalog/types';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'TripBuilder'>;

const MAX_DAYS = 4;

/**
 * F35.7 — Builder manual de trip. Fluxo:
 *   1. Nome + notas (opcionais).
 *   2. Toca em "Adicionar dia X" → modal lista rotas elegiveis
 *      (proximidade fim→inicio da rota do dia anterior).
 *   3. Salva no SQLite via `savedTripsRepository`.
 *
 * Sem date picker nesta fase — F35.8 (lembrete pre-trip) traz `scheduledFor`.
 */
export const TripBuilderScreen: React.FC<Props> = ({ navigation, route }) => {
  const editTripId = route.params?.editTripId;
  const [name, setName] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [selectedRotaIds, setSelectedRotaIds] = useState<string[]>([]);
  const [scheduledForText, setScheduledForText] = useState<string>('');
  // F35.7.1 — Quando o piloto tem so 1 rota mas quer pernoitar no destino
  // e voltar no dia seguinte. Toggle so faz sentido quando length === 1
  // (com 2+ rotas o pernoite e implicito entre dias).
  const [overnightAtDest, setOvernightAtDest] = useState<boolean>(false);
  const [pickerVisible, setPickerVisible] = useState<boolean>(false);
  const [replaceDayIndex, setReplaceDayIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  const catalog = useMemo(() => loadCatalog(), []);
  const catalogById = useMemo(() => {
    const m = new Map<string, CatalogRoute>();
    for (const r of catalog) m.set(r.rota_id, r);
    return m;
  }, [catalog]);

  // Hidrata em modo edicao
  useEffect(() => {
    if (editTripId === undefined) return;
    let cancelled = false;
    void (async () => {
      try {
        const repo = await getSavedTripsRepo();
        const trip = await repo.getById(editTripId);
        if (cancelled || !trip) return;
        setName(trip.name);
        setNotes(trip.notes ?? '');
        setSelectedRotaIds([...trip.rotaIds]);
        if (trip.scheduledFor !== undefined) {
          setScheduledForText(formatDdMmYyyy(trip.scheduledFor));
        }
        // F35.7.1 — Detecta trip de 1 rota com pernoite
        if (
          trip.rotaIds.length === 1 &&
          trip.pernoiteLocations !== undefined &&
          trip.pernoiteLocations.length >= 1
        ) {
          setOvernightAtDest(true);
        }
      } catch {
        // best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editTripId]);

  const eligibleNext = useMemo(() => {
    // Quando substituindo um dia, calcula elegibilidade considerando os
    // dias ANTERIORES ao substituido (nao os posteriores).
    const baseIds =
      replaceDayIndex !== null
        ? selectedRotaIds.slice(0, replaceDayIndex)
        : selectedRotaIds;
    return eligibleRoutesForNextDay({
      catalog,
      selectedRotaIds: baseIds,
      proximityKm: DEFAULT_BUILDER_PROXIMITY_KM,
    });
  }, [catalog, selectedRotaIds, replaceDayIndex]);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleOpenAddPicker = useCallback(() => {
    setReplaceDayIndex(null);
    setPickerVisible(true);
  }, []);

  const handleOpenReplacePicker = useCallback((index: number) => {
    setReplaceDayIndex(index);
    setPickerVisible(true);
  }, []);

  const handleClosePicker = useCallback(() => {
    setPickerVisible(false);
    setReplaceDayIndex(null);
  }, []);

  const handlePickRoute = useCallback(
    (rotaId: string) => {
      setSelectedRotaIds((prev) => {
        if (replaceDayIndex !== null) {
          // Substituir o dia. Trunca a partir do indice — os dias
          // posteriores podem nao casar geograficamente com a nova
          // escolha, entao limpamos pra forcar reselecao consciente.
          const next = prev.slice(0, replaceDayIndex);
          next.push(rotaId);
          return next;
        }
        return [...prev, rotaId];
      });
      handleClosePicker();
    },
    [replaceDayIndex, handleClosePicker],
  );

  const handleRemoveDay = useCallback((index: number) => {
    setSelectedRotaIds((prev) => prev.slice(0, index));
  }, []);

  const handleSave = useCallback(async () => {
    if (name.trim().length === 0) {
      Alert.alert('Nome obrigatório', 'Dê um nome pra sua trip.');
      return;
    }
    if (selectedRotaIds.length === 0) {
      Alert.alert(
        'Trip incompleta',
        'Adicione pelo menos 1 rota ao roteiro.',
      );
      return;
    }
    // F35.8 — Date opcional. Se preenchido, valida formato e que esta no
    // futuro. Vazio = trip sem data agendada (sem banner de lembrete).
    let scheduledForEpoch: number | undefined;
    if (scheduledForText.trim().length > 0) {
      const parsed = parseDdMmYyyy(scheduledForText);
      if (parsed === null) {
        Alert.alert(
          'Data inválida',
          'Use o formato dd/mm/aaaa (ex: 25/06/2026).',
        );
        return;
      }
      if (!isFutureOrTodayDate(parsed)) {
        Alert.alert('Data no passado', 'A data da trip precisa ser hoje ou no futuro.');
        return;
      }
      scheduledForEpoch = parsed;
    }
    setSaving(true);
    try {
      const repo = await getSavedTripsRepo();
      // Pernoite = endCidade de cada rota exceto a ultima
      const pernoiteLocations: string[] = [];
      for (let i = 0; i < selectedRotaIds.length - 1; i += 1) {
        const id = selectedRotaIds[i];
        const route2 = id ? catalogById.get(id) : undefined;
        if (route2) pernoiteLocations.push(route2.coordenada_fim.cidade);
      }
      // F35.7.1 — Trip de 1 rota com "pernoitar no destino" ganha 1
      // pernoite na cidade final. Volta no dia seguinte fica implicita.
      if (selectedRotaIds.length === 1 && overnightAtDest) {
        const onlyId = selectedRotaIds[0];
        const onlyRoute = onlyId ? catalogById.get(onlyId) : undefined;
        if (onlyRoute) {
          pernoiteLocations.push(onlyRoute.coordenada_fim.cidade);
        }
      }
      const payload = {
        name: name.trim(),
        rotaIds: selectedRotaIds,
        ...(pernoiteLocations.length > 0 ? { pernoiteLocations } : {}),
        ...(scheduledForEpoch !== undefined
          ? { scheduledFor: scheduledForEpoch }
          : {}),
        ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
      };
      if (editTripId !== undefined) {
        await repo.update(editTripId, payload);
      } else {
        await repo.create(payload);
      }
      navigation.goBack();
    } catch (err) {
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Falha ao salvar a trip.';
      Alert.alert('Erro', message);
    } finally {
      setSaving(false);
    }
  }, [
    name,
    notes,
    selectedRotaIds,
    scheduledForText,
    overnightAtDest,
    editTripId,
    catalogById,
    navigation,
  ]);

  const handleDelete = useCallback(() => {
    if (editTripId === undefined) return;
    Alert.alert(
      'Excluir trip',
      `Apagar "${name || 'trip sem nome'}" definitivamente?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                const repo = await getSavedTripsRepo();
                await repo.delete(editTripId);
                navigation.goBack();
              } catch {
                Alert.alert('Erro', 'Falha ao excluir a trip.');
              }
            })();
          },
        },
      ],
    );
  }, [editTripId, name, navigation]);

  const canAddMore =
    selectedRotaIds.length < MAX_DAYS && eligibleNext.length > 0;

  return (
    <SafeAreaView style={styles.safe} testID="screen-trip-builder">
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          style={({ pressed }) => [
            styles.backButton,
            pressed ? styles.backButtonPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          testID="btn-trip-builder-back"
        >
          <Text style={styles.backLabel}>{'<'} Voltar</Text>
        </Pressable>
        <Text style={styles.headerTitle}>
          {editTripId !== undefined ? 'Editar Trip' : 'Nova Trip'}
        </Text>
      </View>

      <FlatList
        data={selectedRotaIds}
        keyExtractor={(rotaId, idx) => `${rotaId}-${idx}`}
        contentContainerStyle={styles.body}
        ListHeaderComponent={
          <View>
            <Text style={styles.label}>NOME DA TRIP</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder='Ex: "Litoral SP + Serra do Mar"'
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Nome da trip"
              testID="input-trip-name"
            />
            <Text style={styles.label}>ROTAS DO ROTEIRO</Text>
          </View>
        }
        renderItem={({ item: rotaId, index }) => {
          const route2 = catalogById.get(rotaId);
          return (
            <View style={styles.dayCard} testID={`trip-builder-day-${index + 1}`}>
              <View style={styles.dayHeader}>
                <Text style={styles.dayLabel}>DIA {index + 1}</Text>
                <Pressable
                  onPress={() => handleRemoveDay(index)}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel={`Remover dia ${index + 1} e seguintes`}
                >
                  <Text style={styles.removeBtn}>REMOVER</Text>
                </Pressable>
              </View>
              <Text style={styles.dayRouteName}>
                {route2?.nome_rota ?? rotaId}
              </Text>
              {route2 ? (
                <Text style={styles.dayMeta}>
                  {route2.coordenada_inicio.cidade} →{' '}
                  {route2.coordenada_fim.cidade} ·{' '}
                  {Math.round(route2.distancia_total_km)} km
                </Text>
              ) : null}
              <Pressable
                onPress={() => handleOpenReplacePicker(index)}
                style={({ pressed }) => [
                  styles.replaceBtn,
                  pressed ? styles.replaceBtnPressed : null,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Trocar rota do dia ${index + 1}`}
                testID={`btn-trip-builder-replace-${index + 1}`}
              >
                <Text style={styles.replaceBtnLabel}>TROCAR ROTA</Text>
              </Pressable>
            </View>
          );
        }}
        ListFooterComponent={
          <View>
            {canAddMore ? (
              <Pressable
                onPress={handleOpenAddPicker}
                style={({ pressed }) => [
                  styles.addDayBtn,
                  pressed ? styles.addDayBtnPressed : null,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Adicionar dia"
                testID="btn-trip-builder-add-day"
              >
                <Text style={styles.addDayLabel}>
                  + ADICIONAR DIA {selectedRotaIds.length + 1}
                </Text>
                <Text style={styles.addDayHint}>
                  {selectedRotaIds.length === 0
                    ? `${catalog.length} rotas disponíveis`
                    : `${eligibleNext.length} ${eligibleNext.length === 1 ? 'rota conectada' : 'rotas conectadas'}`}
                </Text>
              </Pressable>
            ) : selectedRotaIds.length >= MAX_DAYS ? (
              <Text style={styles.maxDaysHint}>
                Limite de {MAX_DAYS} dias atingido.
              </Text>
            ) : (
              <Text style={styles.maxDaysHint}>
                Nenhuma rota conectada pra próximo dia. Troque o último ou
                remova pra ajustar o trajeto.
              </Text>
            )}

            {/* F35.7.1 — Toggle pernoite no destino so faz sentido com 1
                rota. Trips de 2+ rotas ja tem pernoites implicitos entre dias. */}
            {selectedRotaIds.length === 1 ? (
              <Pressable
                onPress={() => setOvernightAtDest((v) => !v)}
                style={({ pressed }) => [
                  styles.overnightToggle,
                  overnightAtDest ? styles.overnightToggleActive : null,
                  pressed ? styles.overnightTogglePressed : null,
                ]}
                accessibilityRole="switch"
                accessibilityState={{ checked: overnightAtDest }}
                accessibilityLabel="Pernoitar no destino e voltar no dia seguinte"
                testID="toggle-overnight-at-dest"
              >
                <View style={styles.overnightToggleBody}>
                  <Text style={styles.overnightToggleTitle}>
                    🛏️ Pernoitar no destino
                  </Text>
                  <Text style={styles.overnightToggleHint}>
                    Marque pra contabilizar como trip de fim-de-semana — vai,
                    dorme lá, volta no dia seguinte.
                  </Text>
                </View>
                <View
                  style={[
                    styles.overnightCheckbox,
                    overnightAtDest ? styles.overnightCheckboxActive : null,
                  ]}
                >
                  {overnightAtDest ? (
                    <Text style={styles.overnightCheckLabel}>✓</Text>
                  ) : null}
                </View>
              </Pressable>
            ) : null}

            <Text style={styles.label}>DATA DA TRIP (opcional)</Text>
            <TextInput
              style={styles.input}
              value={scheduledForText}
              onChangeText={setScheduledForText}
              placeholder="dd/mm/aaaa (ex: 25/06/2026)"
              placeholderTextColor={colors.textMuted}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              accessibilityLabel="Data planejada da trip"
              testID="input-trip-schedule"
            />
            <Text style={styles.scheduleHint}>
              Se preenchido, um banner aparece na tela inicial no dia anterior
              e no dia da viagem.
            </Text>

            <Text style={styles.label}>NOTAS (opcional)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Lembretes pra essa trip"
              placeholderTextColor={colors.textMuted}
              multiline
              accessibilityLabel="Notas da trip"
              testID="input-trip-notes"
            />

            <View style={styles.actionRow}>
              <BigButton
                label={saving ? 'SALVANDO...' : 'SALVAR TRIP'}
                variant="primary"
                fullWidth
                disabled={saving}
                onPress={() => {
                  void handleSave();
                }}
                testID="btn-trip-builder-save"
              />
            </View>
            {editTripId !== undefined ? (
              <View style={styles.actionRow}>
                <BigButton
                  label="EXCLUIR TRIP"
                  variant="danger"
                  fullWidth
                  onPress={handleDelete}
                  testID="btn-trip-builder-delete"
                />
              </View>
            ) : null}
          </View>
        }
      />

      <Modal
        visible={pickerVisible}
        onRequestClose={handleClosePicker}
        animationType="slide"
        transparent
      >
        <View style={styles.modalBackdrop}>
          <SafeAreaView style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {replaceDayIndex !== null
                  ? `Trocar rota do dia ${replaceDayIndex + 1}`
                  : `Escolher rota do dia ${selectedRotaIds.length + 1}`}
              </Text>
              <Pressable
                onPress={handleClosePicker}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Fechar picker"
              >
                <Text style={styles.modalCloseLabel}>FECHAR</Text>
              </Pressable>
            </View>
            <FlatList
              data={eligibleNext}
              keyExtractor={(r) => r.rota_id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => handlePickRoute(item.rota_id)}
                  style={({ pressed }) => [
                    styles.pickerRow,
                    pressed ? styles.pickerRowPressed : null,
                  ]}
                  accessibilityRole="button"
                  testID={`picker-route-${item.rota_id}`}
                >
                  <Text style={styles.pickerName}>{item.nome_rota}</Text>
                  <Text style={styles.pickerMeta}>
                    {item.estado_pais} ·{' '}
                    {Math.round(item.distancia_total_km)} km
                  </Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <View style={styles.pickerEmpty}>
                  <Text style={styles.pickerEmptyText}>
                    Nenhuma rota disponível pra esse dia.
                  </Text>
                </View>
              }
            />
          </SafeAreaView>
        </View>
      </Modal>
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
  backLabel: {
    color: colors.accent,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: typography.display.fontSize,
    fontWeight: typography.display.fontWeight,
    lineHeight: typography.display.lineHeight,
    marginTop: spacing.sm,
  },
  body: {
    padding: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  label: {
    color: colors.textMuted,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  scheduleHint: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    lineHeight: 18,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  overnightToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceElevated,
    marginTop: spacing.lg,
  },
  overnightToggleActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(255,107,0,0.08)',
  },
  overnightTogglePressed: {
    opacity: 0.7,
  },
  overnightToggleBody: {
    flex: 1,
  },
  overnightToggleTitle: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
  },
  overnightToggleHint: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    lineHeight: 18,
    marginTop: 2,
  },
  overnightCheckbox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overnightCheckboxActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  overnightCheckLabel: {
    color: '#000',
    fontSize: 18,
    fontWeight: '900',
  },
  dayCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dayLabel: {
    color: colors.accent,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: '800',
    letterSpacing: typography.eyebrow.letterSpacing,
  },
  removeBtn: {
    color: colors.danger,
    fontSize: typography.caption.fontSize,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  dayRouteName: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  dayMeta: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    lineHeight: 18,
    marginTop: 2,
  },
  replaceBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignSelf: 'flex-start',
  },
  replaceBtnPressed: {
    opacity: 0.6,
  },
  replaceBtnLabel: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  addDayBtn: {
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.accent,
    borderStyle: 'dashed',
    alignItems: 'center',
    backgroundColor: 'rgba(255,107,0,0.08)',
  },
  addDayBtnPressed: {
    opacity: 0.7,
  },
  addDayLabel: {
    color: colors.accent,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  addDayHint: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    marginTop: 2,
  },
  maxDaysHint: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  actionRow: {
    marginTop: spacing.md,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  modalTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
  },
  modalCloseLabel: {
    color: colors.accent,
    fontSize: typography.caption.fontSize,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  pickerRow: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  pickerRowPressed: {
    opacity: 0.6,
    backgroundColor: colors.surfaceMuted,
  },
  pickerName: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
  },
  pickerMeta: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    marginTop: 2,
  },
  pickerEmpty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  pickerEmptyText: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontStyle: 'italic',
    textAlign: 'center',
  },
});
