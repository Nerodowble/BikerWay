import React, { useCallback, useMemo } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BigButton } from '@/shared/components/BigButton';
import {
  formatBrazilianDate,
  getConfiabilidadeColors,
  getDificuldadeColors,
} from '@/shared/components/catalog/RouteCard';
import { colors, hitTarget, radius, spacing, typography } from '@/shared/theme';
import { selectMatchById, useCatalogStore } from '@/state/catalogStore';
import {
  selectActiveMotorcycle,
  useMotorcycleStore,
} from '@/state/motorcycleStore';
import {
  calculateMaxAutonomy,
  calculateSafeAutonomy,
} from '@/domains/fuel/autonomy';
import type { CatalogRouteMatch } from '@/domains/catalog/types';
import type { RootStackParamList } from '@/navigation/types';
import {
  PedagioPracaRow,
  PontoApoioRow,
  Section,
  SourceLink,
  StatCell,
} from './routeDetail/components';

type Props = NativeStackScreenProps<RootStackParamList, 'RouteDetail'>;

function formatReais(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? value : 0;
  return `R$ ${safe.toFixed(2).replace('.', ',')}`;
}

function formatKm(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? value : 0;
  return `${Math.round(safe)} km`;
}

/**
 * Full detail screen for a single catalog match. Renders every curated
 * field the route ships with — descrição, dicas, fontes, pontos de apoio —
 * with NO truncation. Sections gracefully disappear when their underlying
 * field is undefined / empty, so legacy routes that pre-date F21.1
 * curation still produce a sensible page.
 *
 * Subscribes to the match via `selectMatchById` so OSRM refinement (which
 * runs asynchronously from the results screen) hot-updates the round-trip
 * numbers in place, including while the detail screen is open.
 */
export const RouteDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const { rotaId } = route.params;
  const selector = useMemo(() => selectMatchById(rotaId), [rotaId]);
  const match = useCatalogStore(selector);
  const filters = useCatalogStore((s) => s.filters);
  const setPreviewRoute = useCatalogStore((s) => s.setPreviewRoute);

  const activeMoto = useMotorcycleStore(selectActiveMotorcycle);
  // Mirror CatalogResultsScreen: prefer filters.motoSafeAutonomyKm (set with
  // the actually-selected moto during the search) and fall back to the
  // active moto so a deep link / remount still renders sensibly.
  const safeAutonomyKm = useMemo(() => {
    if (filters && filters.motoSafeAutonomyKm > 0) {
      return filters.motoSafeAutonomyKm;
    }
    if (!activeMoto) return 0;
    return calculateSafeAutonomy(
      calculateMaxAutonomy(activeMoto.tankCapacity, activeMoto.averageConsump),
    );
  }, [activeMoto, filters]);

  const userLat = filters?.origin.latitude ?? null;
  const userLng = filters?.origin.longitude ?? null;

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleViewOnMap = useCallback(() => {
    if (!match) return;
    setPreviewRoute(match.route.rota_id);
    // popToTop drops the detail + results screens and returns to Home with
    // the catalog overlay active. The rider sees the polyline and can hit
    // INICIAR ROTA from the existing Home affordance — keeps this phase
    // scoped (no new navigation lifecycle here).
    navigation.popToTop();
  }, [match, navigation, setPreviewRoute]);

  const handleOpenSource = useCallback((url: string) => {
    void Linking.openURL(url).catch(() => {
      Alert.alert('Erro', 'Não foi possível abrir o link.');
    });
  }, []);

  if (!match) {
    return (
      <SafeAreaView style={styles.safe} testID="screen-route-detail-missing">
        <View style={styles.header}>
          <BackButton onPress={handleBack} />
        </View>
        <View style={styles.missingState}>
          <Text style={styles.missingText}>
            Rota não encontrada. Faça uma nova busca para ver os detalhes.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const { route: catalogRoute } = match;
  return (
    <SafeAreaView style={styles.safe} testID="screen-route-detail">
      <View style={styles.header}>
        <BackButton onPress={handleBack} testID="btn-route-detail-back" />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
        testID="route-detail-scroll"
      >
        <Text
          style={styles.title}
          accessibilityRole="header"
          testID="route-detail-title"
        >
          {catalogRoute.nome_rota}
        </Text>
        <Text style={styles.subtitle}>
          {catalogRoute.estado_pais} {'·'} Largada a{' '}
          {Math.round(match.distanceToStartKm)} km de você
        </Text>

        <DetailBody
          match={match}
          safeAutonomyKm={safeAutonomyKm}
          userLat={userLat}
          userLng={userLng}
          onOpenSource={handleOpenSource}
        />

        <View style={styles.footer}>
          {catalogRoute.ultima_revisao !== undefined ? (
            <Text style={styles.revisao} testID="route-detail-revisao">
              Dados revisados em{' '}
              {formatBrazilianDate(catalogRoute.ultima_revisao)}
            </Text>
          ) : null}
          <View style={styles.footerButton}>
            <BigButton
              label="VER NO MAPA"
              variant="primary"
              fullWidth
              onPress={handleViewOnMap}
              testID="btn-route-detail-view-map"
            />
          </View>
          <Text style={styles.footerHint}>
            No mapa, toque em INICIAR ROTA para começar a navegação.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const BackButton: React.FC<{ onPress: () => void; testID?: string }> = ({
  onPress,
  testID,
}) => (
  <Pressable
    onPress={onPress}
    hitSlop={12}
    style={({ pressed }) => [
      styles.backButton,
      pressed ? styles.backButtonPressed : null,
    ]}
    accessibilityRole="button"
    accessibilityLabel="Voltar para resultados"
    testID={testID}
  >
    <Text style={styles.backButtonLabel}>{'<'} Voltar</Text>
  </Pressable>
);

/**
 * Pure-display body extracted so the wrapper screen (with safe area, scroll,
 * loading guard) stays at a glance-able size and the body keeps focused on
 * layout. Receives everything as props — no store reads here so the
 * component is trivially testable in isolation.
 */
const DetailBody: React.FC<{
  match: CatalogRouteMatch;
  safeAutonomyKm: number;
  userLat: number | null;
  userLng: number | null;
  onOpenSource: (url: string) => void;
}> = ({ match, safeAutonomyKm, userLat, userLng, onOpenSource }) => {
  const { route } = match;
  const dificuldadePill =
    route.dificuldade !== undefined
      ? {
          label: route.dificuldade.toUpperCase(),
          colors: getDificuldadeColors(route.dificuldade),
        }
      : null;
  const confiabilidadePill =
    route.confiabilidade !== undefined
      ? {
          label: `DADOS: ${route.confiabilidade.toUpperCase()}`,
          colors: getConfiabilidadeColors(route.confiabilidade),
        }
      : null;

  const useReal =
    match.hasRealMetrics === true &&
    typeof match.realRoundTripDistanceKm === 'number' &&
    typeof match.realRoundTripTotalCostReais === 'number';
  const roundTripKm = useReal
    ? (match.realRoundTripDistanceKm as number)
    : match.roundTripDistanceKm;
  const roundTripCost = useReal
    ? (match.realRoundTripTotalCostReais as number)
    : match.roundTripTotalCostReais;
  const trechoCriticoKm = route.caracteristicas.trecho_critico_sem_posto_km;
  const dicas = route.dicas_seguranca ?? [];
  const fontes = route.fontes_dados ?? [];
  const pontosApoio = route.pontos_apoio_homologados;
  const interconexoes = route.interconexoes_ids;
  const pedagiosDetalhados = route.pedagios_detalhados ?? [];
  const showAbout =
    route.descricao_biker !== undefined ||
    dificuldadePill !== null ||
    confiabilidadePill !== null;

  return (
    <>
      {showAbout ? (
        <Section eyebrow="SOBRE A ROTA" testID="route-detail-section-about">
          {route.descricao_biker !== undefined ? (
            <Text style={styles.descricao} testID="route-detail-descricao">
              {route.descricao_biker}
            </Text>
          ) : null}
          {dificuldadePill !== null || confiabilidadePill !== null ? (
            <View style={styles.aboutPillRow}>
              {dificuldadePill !== null ? (
                <View
                  style={[
                    styles.metaPill,
                    { backgroundColor: dificuldadePill.colors.bg },
                  ]}
                >
                  <Text
                    style={[
                      styles.metaPillText,
                      { color: dificuldadePill.colors.fg },
                    ]}
                  >
                    {dificuldadePill.label}
                  </Text>
                </View>
              ) : null}
              {confiabilidadePill !== null ? (
                <View
                  style={[
                    styles.metaPill,
                    { backgroundColor: confiabilidadePill.colors.bg },
                  ]}
                >
                  <Text
                    style={[
                      styles.metaPillText,
                      { color: confiabilidadePill.colors.fg },
                    ]}
                  >
                    {confiabilidadePill.label}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </Section>
      ) : null}

      <Section
        eyebrow="NÚMEROS DA VIAGEM"
        testID="route-detail-section-numbers"
      >
        <View style={styles.statGrid}>
          <StatCell
            label="EXTENSÃO"
            value={formatKm(route.distancia_total_km)}
            testID="stat-extensao"
          />
          <StatCell
            label="PEDÁGIO"
            value={formatReais(route.total_pedagios_moto_reais)}
            testID="stat-pedagio"
          />
          <StatCell
            label="PAVIMENTO"
            value={route.caracteristicas.tipo_pavimento.toUpperCase()}
            testID="stat-pavimento"
          />
          <StatCell
            label="CURVAS"
            value={route.caracteristicas.nivel_curvas.toUpperCase()}
            testID="stat-curvas"
          />
        </View>
        <Text style={styles.fuelLine} testID="route-detail-fuel-cost">
          Combustível só da rota:{' '}
          {formatReais(match.estimatedFuelCostReais)}
        </Text>
        <View style={styles.roundTripBlock}>
          <Text style={styles.roundTripLabel}>IDA + ROTA + VOLTA</Text>
          <View style={styles.roundTripValueRow}>
            <Text
              style={styles.roundTripValue}
              testID="route-detail-round-trip-cost"
            >
              {formatReais(roundTripCost)}
            </Text>
            {useReal ? (
              <View
                style={styles.realMetricsDot}
                testID="route-detail-real-metrics-dot"
              />
            ) : null}
          </View>
          <Text style={styles.roundTripDetail}>
            ~{formatKm(roundTripKm)} {'·'} calculado com{' '}
            {formatReais(match.fuelPricePerLiter)}/L
          </Text>
          <Text style={styles.roundTripStatus}>
            {match.isRefining === true
              ? 'Atualizando com trajeto real...'
              : useReal
                ? 'Trajeto real (OSRM)'
                : 'Estimativa por linha reta (será refinada via OSRM)'}
          </Text>
        </View>
      </Section>

      {pedagiosDetalhados.length > 0 ? (
        <Section
          eyebrow={`PEDÁGIOS DA ROTA (${pedagiosDetalhados.length})`}
          testID="route-detail-section-pedagios"
        >
          <Text style={styles.pedagiosHint}>
            Valores moto cobrados em UMA passagem. Round-trip cobra cada praça duas vezes (ida + volta).
          </Text>
          {pedagiosDetalhados.map((praca, idx) => (
            <PedagioPracaRow
              key={`${route.rota_id}-pedagio-${idx}`}
              praca={praca}
              onOpenSource={onOpenSource}
              testID={`route-detail-pedagio-${idx}`}
            />
          ))}
        </Section>
      ) : null}

      <Section eyebrow="AUTONOMIA" testID="route-detail-section-autonomy">
        {match.autonomyWarning ? (
          <View
            style={styles.autonomyWarningBox}
            testID="route-detail-autonomy-warning"
          >
            <Text style={styles.autonomyWarningLabel}>AVISO</Text>
            <Text style={styles.autonomyWarningText}>
              Seu tanque ({Math.round(safeAutonomyKm)} km) é menor que o
              trecho sem posto desta rota ({trechoCriticoKm} km).
            </Text>
          </View>
        ) : (
          <Text style={styles.bodyText}>
            Trecho sem posto: {trechoCriticoKm} km {'·'} sua autonomia segura:{' '}
            {Math.round(safeAutonomyKm)} km
          </Text>
        )}
      </Section>

      {dicas.length > 0 ? (
        <Section
          eyebrow="DICAS DE SEGURANÇA"
          testID="route-detail-section-dicas"
        >
          <View style={styles.dicasBox}>
            {dicas.map((dica, idx) => (
              <Text
                key={`${route.rota_id}-dica-${idx}`}
                style={styles.dicaItem}
              >
                {`•  ${dica}`}
              </Text>
            ))}
          </View>
        </Section>
      ) : null}

      {route.melhor_epoca !== undefined ? (
        <Section
          eyebrow="MELHOR ÉPOCA"
          testID="route-detail-section-melhor-epoca"
        >
          <Text style={styles.melhorEpoca}>{route.melhor_epoca}</Text>
        </Section>
      ) : null}

      {pontosApoio.length > 0 ? (
        <Section
          eyebrow={`PONTOS DE APOIO (${pontosApoio.length})`}
          testID="route-detail-section-pontos"
        >
          {pontosApoio.map((ponto, idx) => (
            <PontoApoioRow
              key={`${route.rota_id}-ponto-${idx}`}
              ponto={ponto}
              userLat={userLat}
              userLng={userLng}
              testID={`route-detail-ponto-${idx}`}
            />
          ))}
        </Section>
      ) : null}

      {interconexoes.length > 0 ? (
        <Section
          eyebrow="SE CONECTA COM"
          testID="route-detail-section-interconexoes"
        >
          <View style={styles.interconexoesRow}>
            {interconexoes.map((id) => (
              <View
                key={`${route.rota_id}-inter-${id}`}
                style={styles.interconexaoPill}
              >
                <Text style={styles.interconexaoText}>{id}</Text>
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      {fontes.length > 0 ? (
        <Section
          eyebrow="FONTES DOS DADOS"
          testID="route-detail-section-fontes"
        >
          <Text style={styles.fontesHint}>
            Dados curados a partir das seguintes fontes públicas.
          </Text>
          {fontes.map((url, idx) => (
            <SourceLink
              key={`${route.rota_id}-fonte-${idx}`}
              url={url}
              onPress={onOpenSource}
              testID={`route-detail-fonte-${idx}`}
            />
          ))}
        </Section>
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minHeight: hitTarget.min / 2,
    justifyContent: 'center',
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
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.display.fontSize,
    fontWeight: typography.display.fontWeight,
    lineHeight: typography.display.lineHeight,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    marginTop: spacing.xs,
  },
  descricao: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '500',
    // Looser leading than the theme caption so a multi-paragraph blurb is
    // comfortable to read on the dark surface.
    lineHeight: 22,
  },
  aboutPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  metaPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  metaPillText: {
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  fuelLine: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    marginTop: spacing.md,
  },
  roundTripBlock: {
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
  },
  roundTripLabel: {
    color: colors.textMuted,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  roundTripValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  roundTripValue: {
    color: colors.textPrimary,
    fontSize: typography.display.fontSize,
    fontWeight: typography.display.fontWeight,
    lineHeight: typography.display.lineHeight,
  },
  realMetricsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
    marginLeft: spacing.sm,
  },
  roundTripDetail: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    marginTop: spacing.xs,
  },
  roundTripStatus: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    fontStyle: 'italic',
    marginTop: 2,
  },
  bodyText: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
  },
  autonomyWarningBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,204,0,0.12)',
    borderWidth: 1,
    borderColor: colors.warning,
  },
  autonomyWarningLabel: {
    color: colors.warning,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  autonomyWarningText: {
    color: colors.warning,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: 22,
    marginTop: spacing.xs,
  },
  dicasBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  dicaItem: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: 22,
    marginTop: spacing.xs,
  },
  melhorEpoca: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
  },
  interconexoesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  interconexaoPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  interconexaoText: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    lineHeight: typography.caption.lineHeight,
  },
  fontesHint: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    marginBottom: spacing.xs,
  },
  pedagiosHint: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    marginBottom: spacing.xs,
  },
  footer: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  revisao: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    fontStyle: 'italic',
    marginBottom: spacing.md,
  },
  footerButton: {
    marginTop: spacing.sm,
  },
  footerHint: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    fontStyle: 'italic',
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  missingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  missingText: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    textAlign: 'center',
  },
});
