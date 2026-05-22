import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '@/shared/components/Screen';
import { BigButton } from '@/shared/components/BigButton';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { LabeledInput } from '@/shared/components/LabeledInput';
import { colors, hitTarget, radius, spacing, typography } from '@/shared/theme';
import { nominatimClient } from '@/infrastructure/geocoding/nominatimClient';
import { osrmClient } from '@/infrastructure/routing/osrmClient';
import { useLocationStore } from '@/state/locationStore';
import { useNavigationStore } from '@/state/navigationStore';
import { useMovementLock } from '@/shared/hooks/useMovementLock';
import type { GeocodingResult } from '@/domains/routing/types';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'DestinationSearch'>;

const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 3;
const SEARCH_LIMIT = 6;

type SearchStatus = 'idle' | 'loading' | 'error' | 'ready';

interface ResultRowProps {
  item: GeocodingResult;
  onPress: (item: GeocodingResult) => void;
  disabled: boolean;
}

interface RouteModeChipProps {
  label: string;
  description: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
  /**
   * When true the chip is rendered dimmed, ignores its `active` state and
   * blocks the underlying Pressable from calling `onPress`. The caller may
   * still pass an onPress to surface a "feature unavailable" toast — see
   * the TRAIL chip below for the in-construction UX.
   */
  disabled?: boolean;
  /**
   * Optional pill rendered in the chip's top-right corner. Used to flag a
   * mode as "EM BREVE" / "BETA" without removing it from the row, keeping
   * muscle memory and the chip layout stable across releases.
   */
  badge?: string;
  /** Optional a11y hint, used by the disabled TRAIL chip. */
  accessibilityHint?: string;
}

const RouteModeChip: React.FC<RouteModeChipProps> = ({
  label,
  description,
  active,
  onPress,
  testID,
  disabled = false,
  badge,
  accessibilityHint,
}) => {
  // Compose a single a11y phrase so screen readers don't announce label and
  // description as two disconnected strings (the visual proximity makes them
  // one logical control to the rider).
  const a11yLabel = `Modo de rota ${label}, ${description}`;
  // A disabled chip can never be "active" visually — the orange fill on a
  // greyed-out control would read as a bug to a rider in motion.
  const effectiveActive = active && !disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.modeChip,
        effectiveActive ? styles.modeChipActive : null,
        pressed && !disabled ? styles.modeChipPressed : null,
        disabled ? styles.modeChipDisabled : null,
      ]}
      android_ripple={
        disabled ? undefined : { color: 'rgba(255,255,255,0.2)' }
      }
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ selected: effectiveActive, disabled }}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      testID={testID}
    >
      <Text
        style={[
          styles.modeChipLabel,
          effectiveActive ? styles.modeChipLabelActive : null,
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.modeChipDescription,
          effectiveActive ? styles.modeChipDescriptionActive : null,
        ]}
      >
        {description}
      </Text>
      {badge ? (
        <View style={styles.modeChipBadge} pointerEvents="none">
          <Text style={styles.modeChipBadgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
};

const ResultRow: React.FC<ResultRowProps> = ({ item, onPress, disabled }) => {
  const handlePress = useCallback(() => {
    if (!disabled) onPress(item);
  }, [item, onPress, disabled]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled ? styles.rowPressed : null,
        disabled ? styles.rowDisabled : null,
      ]}
      android_ripple={
        disabled ? undefined : { color: 'rgba(255,255,255,0.12)' }
      }
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      testID={`destination-result-${item.latitude.toFixed(4)}-${item.longitude.toFixed(4)}`}
    >
      <Text style={styles.rowLabel} numberOfLines={2}>
        {item.displayName}
      </Text>
    </Pressable>
  );
};

export const DestinationSearchScreen: React.FC<Props> = ({ navigation }) => {
  const userPos = useNavigationStore((s) => s.currentPosition);
  const isFetchingRoute = useNavigationStore((s) => s.isFetchingRoute);
  // Movement lock: when the rider is above the threshold we must not allow
  // text entry. We both dismiss the keyboard and wrap the input in a
  // pointer-blocking View since LabeledInput does not expose `editable`.
  const { isMoving } = useMovementLock();

  const routeMode = useNavigationStore((s) => s.routeSettings.type);
  const allowUnpaved = useNavigationStore((s) => s.routeSettings.allowUnpaved);
  const setRouteSettings = useNavigationStore((s) => s.setRouteSettings);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);

  // Dismiss the soft keyboard the moment movement is detected. Re-fires on
  // every transition INTO isMoving=true; we intentionally don't dismiss when
  // returning to stationary so an already-stopped rider can still focus the
  // input on their own.
  useEffect(() => {
    if (isMoving) {
      Keyboard.dismiss();
    }
  }, [isMoving]);

  // Tracks the most-recent in-flight query token so stale responses are
  // dropped (e.g. user types fast and an older 350ms-debounced call resolves
  // after a newer one).
  const latestQueryToken = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearchStatus('idle');
      setSearchError(null);
      return;
    }

    setSearchStatus('loading');
    setSearchError(null);
    const token = ++latestQueryToken.current;

    const handle = setTimeout(() => {
      void (async () => {
        try {
          const near = userPos
            ? { latitude: userPos.latitude, longitude: userPos.longitude }
            : undefined;

          const next = await nominatimClient.search(trimmed, {
            countryCode: 'br',
            limit: SEARCH_LIMIT,
            ...(near ? { near } : {}),
          });
          if (token !== latestQueryToken.current) return;
          setResults(next);
          setSearchStatus('ready');
        } catch (err) {
          if (token !== latestQueryToken.current) return;
          const msg =
            err instanceof Error
              ? err.message
              : 'Falha ao buscar destinos. Verifique sua conexão.';
          setResults([]);
          setSearchStatus('error');
          setSearchError(msg);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(handle);
    };
  }, [query, userPos]);

  const handleEnableLocation = useCallback(() => {
    void useLocationStore.getState().startWatching();
  }, []);

  const handleClose = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleSelectResult = useCallback(
    (result: GeocodingResult) => {
      if (!userPos) {
        setRouteError('Localização ainda não disponível. Habilite o GPS.');
        return;
      }
      if (selecting) return;

      setSelecting(true);
      setRouteError(null);
      const navStore = useNavigationStore.getState();
      navStore.setFetchingRoute(true);
      navStore.setRouteError(null);
      // Save the destination immediately so HomeScreen can label the picker
      // sheet correctly while the OSRM request is in flight.
      navStore.setDestination({
        latitude: result.latitude,
        longitude: result.longitude,
        timestamp: Date.now(),
      });
      // Clear any stale alternatives from a previous search so HomeScreen's
      // null -> array transition fires cleanly when this call resolves.
      navStore.setRouteAlternatives(null);

      void (async () => {
        try {
          const routes = await osrmClient.getRouteAlternatives(
            {
              start: {
                latitude: userPos.latitude,
                longitude: userPos.longitude,
              },
              end: {
                latitude: result.latitude,
                longitude: result.longitude,
              },
              settings: navStore.routeSettings,
            },
            3,
          );
          const store = useNavigationStore.getState();
          // Populate the alternatives but do NOT promote any to activeRoute
          // and do NOT call startNavigation(): we wait for the rider to pick
          // one from the bottom sheet on HomeScreen.
          store.setRouteAlternatives(routes);
          store.setFetchingRoute(false);
          navigation.goBack();
        } catch (err) {
          const msg =
            err instanceof Error && err.message.length > 0
              ? err.message
              : 'Rota não encontrada';
          const store = useNavigationStore.getState();
          store.setRouteAlternatives(null);
          store.setFetchingRoute(false);
          store.setRouteError(msg);
          setRouteError(msg);
        } finally {
          setSelecting(false);
        }
      })();
    },
    [navigation, selecting, userPos],
  );

  const renderItem: ListRenderItem<GeocodingResult> = useCallback(
    ({ item }) => (
      <ResultRow
        item={item}
        onPress={handleSelectResult}
        disabled={selecting || isFetchingRoute}
      />
    ),
    [handleSelectResult, selecting, isFetchingRoute],
  );

  const keyExtractor = useCallback(
    (item: GeocodingResult, index: number) =>
      `${item.latitude.toFixed(5)}-${item.longitude.toFixed(5)}-${index}`,
    [],
  );

  const showLocationCta = !userPos;
  const showSearchSpinner = searchStatus === 'loading';
  const showRouteSpinner = selecting || isFetchingRoute;
  const showEmptyHint =
    !showLocationCta &&
    searchStatus === 'ready' &&
    results.length === 0 &&
    query.trim().length >= MIN_QUERY_LENGTH;

  return (
    <Screen padding testID="screen-destination-search">
      <View style={styles.header}>
        <Text style={styles.title}>Para onde vamos?</Text>
        <View style={styles.closeButton}>
          <BigButton
            label="Fechar"
            variant="secondary"
            onPress={handleClose}
            testID="btn-destination-close"
          />
        </View>
      </View>

      {showLocationCta ? (
        <View style={styles.banner}>
          <StatusBadge
            label="Localização"
            value="Indisponível"
            state="danger"
            testID="banner-location-missing"
          />
          <View style={styles.bannerSpacer} />
          <BigButton
            label="Habilitar localização"
            variant="warning"
            fullWidth
            onPress={handleEnableLocation}
            testID="btn-enable-location"
          />
        </View>
      ) : null}

      {isMoving ? (
        <Text style={styles.movementWarning} testID="warning-movement-lock">
          Pare a moto para digitar o destino. Movimento detectado (&gt; 5 km/h).
        </Text>
      ) : null}

      <View style={styles.modeRow}>
        <Text style={styles.modeLabel}>Tipo de rota:</Text>
        <View style={styles.modeChips}>
          <RouteModeChip
            label="EXPRESSA"
            description="Mais rápido"
            active={routeMode === 'express' && !allowUnpaved}
            onPress={() => {
              setRouteSettings({ type: 'express', allowUnpaved: false });
            }}
            testID="chip-mode-express"
          />
          <RouteModeChip
            label="SINUOSA"
            description="Mais curvas"
            active={routeMode === 'scenic'}
            onPress={() => {
              setRouteSettings({ type: 'scenic', allowUnpaved: false });
            }}
            testID="chip-mode-scenic"
          />
          <RouteModeChip
            label="TRAIL"
            description="Aceita terra"
            // Disabled while the unpaved-aware router is in development.
            // We intentionally never mark this chip as active — even if
            // some persisted state still carries `allowUnpaved: true` — so
            // the UI cannot suggest a working mode that the router cannot
            // honour yet.
            active={false}
            disabled
            badge="EM BREVE"
            accessibilityHint="Modo em desenvolvimento, indisponível"
            onPress={() => {
              // Pressable's `disabled` prop already swallows touches on both
              // platforms, but we surface a polite explanation in case a
              // future style change re-enables the press target by accident.
              Alert.alert(
                'Em breve',
                'Filtro de estradas de terra ainda em desenvolvimento.',
              );
            }}
            testID="chip-mode-trail"
          />
        </View>
        {allowUnpaved ? (
          <Text style={styles.modeNote}>
            Modo trail em desenvolvimento: o roteador público atual não
            distingue asfalto de terra. Indisponível até troca de provedor.
          </Text>
        ) : null}
      </View>

      <View
        pointerEvents={isMoving ? 'none' : 'auto'}
        style={isMoving ? styles.inputLocked : null}
      >
        <LabeledInput
          label="Para onde vamos?"
          value={query}
          onChangeText={setQuery}
          placeholder="Endereço, bairro, cidade..."
          autoCapitalize="none"
          testID="input-destination-query"
        />
      </View>

      {searchError ? (
        <View style={styles.errorRow}>
          <StatusBadge
            label="Erro"
            value={searchError}
            state="danger"
            testID="banner-search-error"
          />
        </View>
      ) : null}

      {routeError ? (
        <View style={styles.errorRow}>
          <StatusBadge
            label="Rota"
            value={routeError}
            state="danger"
            testID="banner-route-error"
          />
        </View>
      ) : null}

      {showSearchSpinner || showRouteSpinner ? (
        <View style={styles.spinnerRow} testID="indicator-loading">
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.spinnerLabel}>
            {showRouteSpinner ? 'Calculando rota...' : 'Buscando destinos...'}
          </Text>
        </View>
      ) : null}

      {showEmptyHint ? (
        <Text style={styles.emptyHint}>Nenhum resultado para esta busca.</Text>
      ) : null}

      <FlatList
        style={styles.list}
        data={results}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        keyboardShouldPersistTaps="handled"
        testID="list-destination-results"
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  title: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.navPrimary.fontSize,
    fontWeight: typography.navPrimary.fontWeight,
    lineHeight: typography.navPrimary.lineHeight,
    marginRight: spacing.md,
  },
  closeButton: {
    minWidth: 120,
  },
  banner: {
    marginBottom: spacing.md,
  },
  bannerSpacer: {
    height: spacing.sm,
  },
  errorRow: {
    marginTop: spacing.sm,
  },
  spinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  spinnerLabel: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    marginLeft: spacing.sm,
  },
  emptyHint: {
    color: colors.textMuted,
    fontSize: typography.navSecondary.fontSize,
    lineHeight: typography.navSecondary.lineHeight,
    marginTop: spacing.md,
  },
  list: {
    flex: 1,
    marginTop: spacing.md,
  },
  row: {
    minHeight: hitTarget.min,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    borderRadius: radius.sm,
    justifyContent: 'center',
  },
  rowPressed: {
    backgroundColor: colors.surfaceElevated,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowLabel: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
  },
  movementWarning: {
    color: colors.warning,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
    marginBottom: spacing.sm,
  },
  inputLocked: {
    opacity: 0.5,
  },
  modeRow: {
    marginBottom: spacing.md,
  },
  modeLabel: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontWeight: '600',
    marginBottom: spacing.xs,
    letterSpacing: 0.4,
  },
  modeChips: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modeChip: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 56,
    justifyContent: 'center',
    alignItems: 'center',
    // `relative` so the absolutely-positioned "EM BREVE" badge anchors
    // against the chip itself rather than the row container.
    position: 'relative',
  },
  modeChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  modeChipPressed: {
    opacity: 0.7,
  },
  modeChipDisabled: {
    // Spec-mandated dim level for the "Em construção" state. Kept above
    // 0.4 so the label still meets contrast against the dark surface for
    // riders glancing at the row in motion.
    opacity: 0.5,
  },
  modeChipBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: colors.warning,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  modeChipBadgeText: {
    color: '#000000',
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  modeChipLabel: {
    color: colors.textSecondary,
    // Bumped from sm (14) to 14 explicit with 700 weight per a11y spec —
    // still readable in motion but no longer too bold (was 800) so the
    // description below has room to be legible.
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  modeChipLabelActive: {
    color: '#FFFFFF',
  },
  modeChipDescription: {
    // Was 10pt on textMuted — unreadable on the move. Bumped to caption
    // (12pt 500) and lifted color to textSecondary for contrast.
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    marginTop: 2,
  },
  modeChipDescriptionActive: {
    color: 'rgba(255,255,255,0.85)',
  },
  modeNote: {
    marginTop: spacing.xs,
    color: colors.textMuted,
    fontSize: 10,
    fontStyle: 'italic',
  },
});
