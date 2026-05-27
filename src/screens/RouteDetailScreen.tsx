import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
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
import {
  buildFullCatalogRoute,
  selectMatchById,
  useCatalogStore,
} from '@/state/catalogStore';
import { useNavigationStore } from '@/state/navigationStore';
import { useTripCompletionStore } from '@/state/tripCompletionStore';
import { loadCatalog } from '@/infrastructure/catalog/catalogClient';
import { getRideHistoryRepo } from '@/infrastructure/db/rideHistoryRepository';
import {
  selectReportsForRota,
  useWhisperStore,
} from '@/state/whisperStore';
import {
  presetByKind,
  type WhisperReport,
} from '@/domains/whisper/types';
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
import { BikerMapView } from '@/shared/components/map';

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
 * F35.0.B — Formata um rota_id kebab-case que NAO esta no catalogo curado
 * pra um label legivel. Mantemos o ID original sob o capot pra
 * troubleshooting, mas exibimos algo como "Rodovia Presidente Dutra (SP/RJ)"
 * em vez de "rodovia-presidente-dutra-sp-rj" no pill EM BREVE.
 *
 * Heuristica: ultimos segmentos de 2 chars sao UFs (estado_pais shape do
 * BR); resto e o nome em Title Case.
 */
function formatPendingConnectionLabel(id: string): string {
  const segments = id.split('-');
  const ufs: string[] = [];
  while (segments.length > 0) {
    const last = segments[segments.length - 1];
    if (typeof last === 'string' && /^[a-z]{2}$/.test(last)) {
      ufs.unshift(last);
      segments.pop();
    } else {
      break;
    }
  }
  const name = segments
    .map((s) => (s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s))
    .join(' ');
  if (ufs.length > 0) {
    return `${name} (${ufs.map((u) => u.toUpperCase()).join('/')})`;
  }
  return name;
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
  const fetchPreviewCoordinates = useCatalogStore(
    (s) => s.fetchPreviewCoordinates,
  );

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

  // F35.1 — Registra "abertura" da rota no historico local (SQLite). Esse
  // evento alimenta o ranker de novidade (F35.5): rotas nunca abertas
  // valem mais que rotas abertas 10 vezes. Sem PII alem do rota_id +
  // timestamp; sem debounce porque cada mount real conta como interesse
  // novo (re-renderizacoes do React nao re-disparam o effect).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const repo = await getRideHistoryRepo();
        if (cancelled) return;
        await repo.recordRouteOpen(rotaId);
      } catch {
        // best-effort: gamificacao local nao pode quebrar a navegacao
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rotaId]);

  // F35.9 — Entra no canal Whisper da rota pra receber avisos de outros
  // pilotos. Idempotente; nao sai do canal ao desmontar pra evitar
  // perder reports que chegam enquanto o piloto rola no app.
  // IMPORTANTE: o selector e memoizado por `rotaId` pra Zustand devolver
  // referencia estavel mesmo quando o map nao tem entry — senao cada
  // render gera novo `[]` literal e dispara loop infinito.
  const joinWhisper = useWhisperStore((s) => s.joinRoute);
  const whisperReportsSelector = useMemo(
    () => (s: ReturnType<typeof useWhisperStore.getState>) =>
      selectReportsForRota(s, rotaId),
    [rotaId],
  );
  const whisperReports = useWhisperStore(whisperReportsSelector);
  useEffect(() => {
    void joinWhisper(rotaId);
  }, [joinWhisper, rotaId]);

  // F35.0.D rev3 — Prévia full-screen via Modal. A polilinha REAL OSRM vem
  // do match (`realRouteCoordinates`), populada por `refineSingleMatch` (em
  // background na lista) OU on-demand via `fetchRouteCoordinates(rotaId)`
  // disparado quando o modal abre pela primeira vez. O modal consome o
  // estado da store, então qualquer refetch fica cacheado pra abrir o modal
  // de novo na mesma sessão sem latência.
  const [previewVisible, setPreviewVisible] = useState<boolean>(false);
  const [startLoading, setStartLoading] = useState<boolean>(false);

  const currentPosition = useNavigationStore((s) => s.currentPosition);
  const setActiveRoute = useNavigationStore((s) => s.setActiveRoute);
  const setDestination = useNavigationStore((s) => s.setDestination);
  const startNavigation = useNavigationStore((s) => s.startNavigation);

  // Lê coordenadas reais direto do match (rota + approach). `selectMatchById`
  // re-subscribe a mutações no store, então quando `fetchPreviewCoordinates`
  // (ou o refine padrão) grava no match, o modal re-renderiza com as
  // polilinhas reais sem estado local.
  const realRouteCoordinates = match?.realRouteCoordinates;
  const realApproachCoordinates = match?.realApproachCoordinates;
  // Badge "refinando" enquanto pelo menos uma das legs ainda não chegou.
  // Approach só conta como pendente quando o piloto tem GPS — sem GPS, a
  // approach é impossível e o modal mostra só a rota.
  const previewLoading =
    previewVisible &&
    ((realRouteCoordinates === undefined ||
      realRouteCoordinates.length === 0) ||
      (currentPosition !== null &&
        (realApproachCoordinates === undefined ||
          realApproachCoordinates.length === 0)));

  const handleOpenPreview = useCallback(() => {
    setPreviewVisible(true);
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewVisible(false);
  }, []);

  // Quando o modal abre, dispara o fetch on-demand pras coordenadas que
  // faltam. Passa userPosition pra que a leg approach (user→start) também
  // seja buscada quando o GPS está disponível. Idempotente — se já está
  // rodando ou já tem coords, sai direto. Se a refine padrão chegar
  // primeiro, o modal pega via subscription.
  useEffect(() => {
    if (!previewVisible) return;
    if (!match) return;
    const hasRoute =
      realRouteCoordinates !== undefined && realRouteCoordinates.length > 0;
    const hasApproach =
      realApproachCoordinates !== undefined &&
      realApproachCoordinates.length > 0;
    const needsApproach = currentPosition !== null && !hasApproach;
    if (hasRoute && !needsApproach) return;
    const userPos =
      currentPosition !== null
        ? {
            latitude: currentPosition.latitude,
            longitude: currentPosition.longitude,
          }
        : undefined;
    void fetchPreviewCoordinates(match.route.rota_id, userPos);
  }, [
    previewVisible,
    match,
    realRouteCoordinates,
    realApproachCoordinates,
    currentPosition,
    fetchPreviewCoordinates,
  ]);

  const handleStartNavigation = useCallback(async () => {
    if (!match) return;
    if (!currentPosition) {
      Alert.alert(
        'Sem GPS',
        'Precisa de um sinal de GPS válido pra iniciar a navegação.',
      );
      return;
    }
    setStartLoading(true);
    try {
      const fullRoute = await buildFullCatalogRoute(match, {
        latitude: currentPosition.latitude,
        longitude: currentPosition.longitude,
      });
      setActiveRoute(fullRoute);
      setDestination({
        latitude: match.route.coordenada_fim.latitude,
        longitude: match.route.coordenada_fim.longitude,
        timestamp: Date.now(),
      });
      // Limpa o preview "frio" do catálogo — agora a rota está ativa.
      setPreviewRoute(null);
      // F35.1 — Registra o inicio do trip no historico local. Insere uma
      // linha em `trip_history` (started_at preenchido, completed_at
      // permanece NULL ate F35.2 detectar 80% da polyline) e uma em
      // `route_history` (action='started'). F35.2 — depois de obter o
      // trip id, comeca o tracker de conclusao que escuta GPS e dispara
      // recordTripCompleted quando o piloto cobrir >=80% + chegar ao fim.
      void getRideHistoryRepo()
        .then((repo) => repo.recordTripStarted(match.route.rota_id))
        .then((tripId) =>
          useTripCompletionStore.getState().startTracking({
            tripId,
            rotaId: match.route.rota_id,
            polyline: match.route.polilinha_simplificada.map((p) => ({
              latitude: p.lat,
              longitude: p.lng,
            })),
            coordenadaFim: {
              latitude: match.route.coordenada_fim.latitude,
              longitude: match.route.coordenada_fim.longitude,
            },
            routeDistanceKm: match.route.distancia_total_km,
          }),
        )
        .catch(() => {
          // best-effort — nao podemos quebrar o inicio da navegacao
          // por falha de persistencia ou tracker
        });
      startNavigation();
      setPreviewVisible(false);
      // popToTop volta pra Home, que já vai estar em modo navegação.
      navigation.popToTop();
    } catch (err) {
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Falha ao iniciar a navegação.';
      Alert.alert('Erro', message);
    } finally {
      setStartLoading(false);
    }
  }, [
    match,
    currentPosition,
    setActiveRoute,
    setDestination,
    setPreviewRoute,
    startNavigation,
    navigation,
  ]);

  const handleOpenSource = useCallback((url: string) => {
    void Linking.openURL(url).catch(() => {
      Alert.alert('Erro', 'Não foi possível abrir o link.');
    });
  }, []);

  // F35.0.B — mapa rota_id -> nome_rota pras conexoes clicaveis. loadCatalog
  // e in-process e ja foi hidratado no boot via bootstrap; cache pra evitar
  // recompor o Map a cada render do detail.
  const availableConnections = useMemo<ReadonlyMap<string, string>>(() => {
    const catalog = loadCatalog();
    const map = new Map<string, string>();
    for (const r of catalog) {
      map.set(r.rota_id, r.nome_rota);
    }
    return map;
  }, []);

  const handleOpenConnection = useCallback(
    (connectionId: string) => {
      // push (nao navigate) garante uma instancia nova da tela na pilha —
      // back retorna pra rota anterior. Permite exploracao "rota A -> B ->
      // C" e voltar passo a passo.
      navigation.push('RouteDetail', { rotaId: connectionId });
    },
    [navigation],
  );

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

  // F35.0.D — Converte polilinha_simplificada (lat/lng) pro shape do mapa
  // (latitude/longitude). previewPolyline e o que faz o BikerMapView
  // renderizar a polilinha azul auto-fit.
  const previewPolylineData = useMemo(
    () =>
      catalogRoute.polilinha_simplificada.map((p) => ({
        latitude: p.lat,
        longitude: p.lng,
      })),
    [catalogRoute.polilinha_simplificada],
  );

  // F35.0.D rev4 — Fallback de linha reta pro approach (GPS → inicio da
  // rota) enquanto o OSRM nao resolve. Mostra direcao + distancia
  // aproximada; quando o OSRM termina, vira polyline real seguindo as
  // estradas. Nulo quando faltar GPS.
  const approachFallback = useMemo(() => {
    if (!currentPosition) return null;
    return [
      {
        latitude: currentPosition.latitude,
        longitude: currentPosition.longitude,
      },
      {
        latitude: catalogRoute.coordenada_inicio.latitude,
        longitude: catalogRoute.coordenada_inicio.longitude,
      },
    ];
  }, [currentPosition, catalogRoute.coordenada_inicio]);

  const approachPolylineForMap =
    realApproachCoordinates !== undefined &&
    realApproachCoordinates.length > 0
      ? realApproachCoordinates.map((c) => ({
          latitude: c.latitude,
          longitude: c.longitude,
        }))
      : approachFallback;

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

        {/* F35.10 — Avisos Whisper enviados por outros pilotos na rota
            (TTL 6h). Sobe pro topo pra ter prioridade visual. Some quando
            nao ha avisos. */}
        <WhisperAlertsSection reports={whisperReports} />

        <DetailBody
          match={match}
          safeAutonomyKm={safeAutonomyKm}
          userLat={userLat}
          userLng={userLng}
          onOpenSource={handleOpenSource}
          availableConnections={availableConnections}
          onOpenConnection={handleOpenConnection}
        />

        {/* F35.0.D rev — Botão único que abre a prévia full-screen via
            Modal. INICIAR NAVEGAÇÃO mora dentro do modal pra unificar
            "olhei o mapa, agora vou". */}
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
              onPress={handleOpenPreview}
              testID="btn-route-detail-open-preview"
            />
          </View>
          <Text style={styles.footerHint}>
            Abre a prévia em tela cheia — você inicia a navegação por lá.
          </Text>
        </View>
      </ScrollView>

      {/* F35.0.D rev — Modal full-screen com BikerMapView ocupando toda a
          superfície. Polyline OSRM real ao invés da simplificada. */}
      <Modal
        visible={previewVisible}
        onRequestClose={handleClosePreview}
        animationType="slide"
        statusBarTranslucent
      >
        <SafeAreaView style={styles.modalSafe} testID="modal-route-preview">
          <View style={styles.modalMapWrap}>
            <BikerMapView
              userPosition={currentPosition}
              previewPolyline={
                realRouteCoordinates !== undefined &&
                realRouteCoordinates.length > 0
                  ? realRouteCoordinates.map((c) => ({
                      latitude: c.latitude,
                      longitude: c.longitude,
                    }))
                  : previewPolylineData
              }
              {...(approachPolylineForMap !== null
                ? { approachPolyline: approachPolylineForMap }
                : {})}
              mode="idle"
              followUser={false}
              tileMode="auto"
            />
            {previewLoading ? (
              <View
                style={styles.modalLoadingBadge}
                testID="modal-route-preview-loading"
                pointerEvents="none"
              >
                <ActivityIndicator color={colors.accent} size="small" />
                <Text style={styles.modalLoadingBadgeText}>
                  Refinando trajeto real...
                </Text>
              </View>
            ) : null}
          </View>

          <Pressable
            onPress={handleClosePreview}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Fechar prévia"
            style={({ pressed }) => [
              styles.modalCloseButton,
              pressed ? styles.modalCloseButtonPressed : null,
            ]}
            testID="btn-modal-route-preview-close"
          >
            <Text style={styles.modalCloseLabel}>{'×'}</Text>
          </Pressable>

          <View style={styles.modalBottomBar}>
            <Text style={styles.modalRouteName} numberOfLines={1}>
              {catalogRoute.nome_rota}
            </Text>
            <BigButton
              label={startLoading ? 'INICIANDO...' : 'INICIAR NAVEGAÇÃO'}
              variant="primary"
              fullWidth
              disabled={startLoading}
              onPress={() => {
                void handleStartNavigation();
              }}
              testID="btn-modal-route-preview-start"
            />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

// F35.10 — Section de avisos Whisper recebidos por outros pilotos na
// rota. Renderiza so quando ha avisos validos.
function formatRelativeTime(epoch: number, now: number = Date.now()): string {
  const diffMin = Math.max(0, Math.floor((now - epoch) / 60_000));
  if (diffMin < 1) return 'agora mesmo';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffHour = Math.floor(diffMin / 60);
  return diffHour === 1 ? 'há 1h' : `há ${diffHour}h`;
}

const WhisperAlertsSection: React.FC<{
  reports: ReadonlyArray<WhisperReport>;
}> = ({ reports }) => {
  if (reports.length === 0) return null;
  return (
    <View style={styles.whisperSection} testID="whisper-alerts">
      <Text style={styles.whisperEyebrow}>
        ⚠️ AVISOS RECENTES ({reports.length})
      </Text>
      <Text style={styles.whisperHint}>
        Reportes anônimos enviados por outros pilotos rodando esta rota nas
        últimas 6h.
      </Text>
      {reports.map((report) => {
        const preset = presetByKind(report.kind);
        return (
          <View
            key={report.id}
            style={styles.whisperItem}
            testID={`whisper-item-${report.id}`}
          >
            <Text style={styles.whisperEmoji}>{preset.emoji}</Text>
            <View style={styles.whisperBody}>
              <Text style={styles.whisperText}>
                {preset.shortText}
                {report.routeKm !== undefined
                  ? ` (km ${Math.round(report.routeKm)})`
                  : ''}
              </Text>
              <Text style={styles.whisperMeta}>
                {formatRelativeTime(report.createdAt)} ·{' '}
                {report.reporterAlias}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
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
  /** F35.0.B — mapa de rota_id -> nome_rota pra conexoes curadas. */
  availableConnections: ReadonlyMap<string, string>;
  /** F35.0.B — chamado ao tocar numa conexao curada (id existe no catalogo). */
  onOpenConnection: (rotaId: string) => void;
}> = ({
  match,
  safeAutonomyKm,
  userLat,
  userLng,
  onOpenSource,
  availableConnections,
  onOpenConnection,
}) => {
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
          {/* F35.0.B — conexoes ATIVAS sao Pressable e abrem o RouteDetail
              da rota destino (navigation.push). Conexoes PENDENTES (id
              listado mas rota nao curada ainda) ficam em estilo muted,
              sem acao, com label "em breve" pra dar contexto. */}
          <View style={styles.interconexoesRow}>
            {interconexoes.map((id) => {
              const targetName = availableConnections.get(id);
              if (targetName !== undefined) {
                return (
                  <Pressable
                    key={`${route.rota_id}-inter-${id}`}
                    onPress={() => onOpenConnection(id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Abrir rota ${targetName}`}
                    style={({ pressed }) => [
                      styles.interconexaoPill,
                      styles.interconexaoPillActive,
                      pressed ? styles.interconexaoPillPressed : null,
                    ]}
                    testID={`route-detail-inter-${id}`}
                  >
                    <Text
                      style={styles.interconexaoTextActive}
                      numberOfLines={1}
                    >
                      {targetName}
                    </Text>
                  </Pressable>
                );
              }
              return (
                <View
                  key={`${route.rota_id}-inter-${id}`}
                  style={[
                    styles.interconexaoPill,
                    styles.interconexaoPillPending,
                  ]}
                  testID={`route-detail-inter-${id}-pending`}
                >
                  <Text
                    style={styles.interconexaoTextPending}
                    numberOfLines={1}
                  >
                    {formatPendingConnectionLabel(id)}
                  </Text>
                  <Text style={styles.interconexaoBadgePending}>EM BREVE</Text>
                </View>
              );
            })}
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
  // F35.10 — Avisos Whisper
  whisperSection: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,204,0,0.10)',
    borderWidth: 1,
    borderColor: colors.warning,
  },
  whisperEyebrow: {
    color: colors.warning,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: '800',
    letterSpacing: typography.eyebrow.letterSpacing,
    textTransform: typography.eyebrow.textTransform,
  },
  whisperHint: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontStyle: 'italic',
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  whisperItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,204,0,0.25)',
  },
  whisperEmoji: {
    fontSize: 24,
  },
  whisperBody: {
    flex: 1,
  },
  whisperText: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
  },
  whisperMeta: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    marginTop: 2,
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
  // F35.0.B — Conexao ATIVA: borda accent + texto accent, sinaliza
  // affordance de toque clara
  interconexaoPillActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(255,107,0,0.10)',
  },
  interconexaoPillPressed: {
    opacity: 0.65,
  },
  interconexaoTextActive: {
    color: colors.accent,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    lineHeight: typography.caption.lineHeight,
  },
  // F35.0.B — Conexao PENDENTE: muted + tag "EM BREVE" pra contexto
  interconexaoPillPending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    opacity: 0.7,
  },
  interconexaoTextPending: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    lineHeight: typography.caption.lineHeight,
    fontStyle: 'italic',
  },
  interconexaoBadgePending: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    backgroundColor: colors.surface,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: radius.sm,
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
  // F35.0.D rev — Modal full-screen de prévia da rota
  modalSafe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalMapWrap: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
  },
  // Badge discreto no rodape do mapa enquanto OSRM responde — NAO bloqueia
  // a visualizacao. A polilinha simplificada ja esta desenhada por baixo;
  // quando OSRM chegar, ela e substituida pela polyline real.
  modalLoadingBadge: {
    position: 'absolute',
    bottom: spacing.md,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  modalLoadingBadgeText: {
    color: colors.textPrimary,
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    lineHeight: typography.caption.lineHeight,
  },
  modalCloseButton: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  modalCloseButtonPressed: {
    opacity: 0.6,
  },
  modalCloseLabel: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 30,
  },
  modalBottomBar: {
    padding: spacing.lg,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  modalRouteName: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
    marginBottom: spacing.sm,
  },
  modalErrorText: {
    color: colors.warning,
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    lineHeight: typography.caption.lineHeight,
    marginBottom: spacing.sm,
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
