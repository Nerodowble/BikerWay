import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors, radius, spacing, typography } from '@/shared/theme';
import { useNavigationStore } from '@/state/navigationStore';
import { useRiderStore } from '@/state/riderStore';
import {
  selectActiveMotorcycle,
  useMotorcycleStore,
} from '@/state/motorcycleStore';
import { useSOSStore } from '@/state/sosStore';
import { useSOSNetworkStore } from '@/state/sosNetworkStore';
import {
  SOS_PROBLEMS,
  type SOSProblemType,
} from '@/domains/sos/types';
import { evaluateAbuseStatus, formatLockRemaining } from '@/domains/sos/abuse';
import { SlideToActivate } from './sos/SlideToActivate';
import { HealthEmergencyModal } from './sos/HealthEmergencyModal';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SOS'>;

const PROBLEM_GRID: SOSProblemType[] = [
  'pneu_furado',
  'pane_mecanica',
  'pane_eletrica',
  'pane_seca',
];

/**
 * F29.1 — Tela de disparo do SOS Comunitario.
 *
 * O piloto seleciona um tipo de problema, opcionalmente escreve uma
 * mensagem curta e desliza pra ativar. Saude abre um modal extra com
 * dial direto pra 192/193 e share da localizacao via WhatsApp.
 *
 * F29.1 NAO faz broadcast P2P — a ativacao apenas grava o alerta no
 * sosStore e mostra confirmacao local. A integracao PeerJS vem em F29.2
 * (assinando `current` do store pra disparar broadcast). Mantendo F29.1
 * standalone permite validar o slider, a Health modal e o fluxo de UI
 * antes de plugar a rede.
 */
export const SOSScreen: React.FC<Props> = ({ navigation }) => {
  // Position vem do navigationStore (alimentado pelo locationStore via
  // watchPosition). Em rotas serranas com sinal ruim pode estar stale, mas
  // pra SOS local de poucos km e suficiente.
  const currentPosition = useNavigationStore((s) => s.currentPosition);
  const riderName = useRiderStore((s) => s.profile?.displayName);
  const activeMoto = useMotorcycleStore(selectActiveMotorcycle);
  const fireSOS = useSOSStore((s) => s.fire);
  const cancelLocalSOS = useSOSStore((s) => s.cancel);
  const currentAlert = useSOSStore((s) => s.current);
  // F29.4: re-renderiza o calculo de abuso a cada ~30s pra refletir o
  // desbloqueio quando a janela rolling de 7d passar.
  // ATENÇÃO (bug de Zustand): subscrever via
  //   useSOSStore((s) => selectAbuseStatus(s, now))
  // retorna OBJETO NOVO a cada render → loop infinito de re-render
  // ("Maximum update depth exceeded"). A solucao certa e assinar so
  // recentCancels (array de timestamps, referencia estavel) e calcular
  // o status memoized aqui — o objeto so e reconstruido quando os
  // inputs efetivamente mudam.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const recentCancels = useSOSStore((s) => s.recentCancels);
  const abuseStatus = useMemo(
    () => evaluateAbuseStatus(recentCancels, now),
    [recentCancels, now],
  );

  // Cancel propaga pela rede em F29.2 — quem ja recebeu o pin do alerta
  // limpa do mapa. F29.5 fecha o loop ao integrar com PeerJS real.
  const handleCancel = useCallback(() => {
    const id = useSOSStore.getState().current?.id;
    if (id !== undefined) {
      useSOSNetworkStore.getState().broadcastCancel(id);
    }
    cancelLocalSOS();
  }, [cancelLocalSOS]);

  const [selectedProblem, setSelectedProblem] = useState<SOSProblemType | null>(
    null,
  );
  const [message, setMessage] = useState('');
  const [sliderKey, setSliderKey] = useState(0); // resetar o slider depois de ativar
  const [healthModalVisible, setHealthModalVisible] = useState(false);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleSelectProblem = useCallback((problem: SOSProblemType) => {
    setSelectedProblem(problem);
  }, []);

  const handleActivate = useCallback(() => {
    if (selectedProblem === null) return;
    if (currentPosition === null) {
      Alert.alert(
        'Sem GPS',
        'Aguarde o sinal de GPS estabilizar antes de disparar o SOS.',
      );
      // Reset slider para o piloto tentar de novo quando o GPS pegar.
      setSliderKey((k) => k + 1);
      return;
    }
    const meta = SOS_PROBLEMS[selectedProblem];
    const { alert, abuseBlocked } = fireSOS({
      problemType: selectedProblem,
      latitude: currentPosition.latitude,
      longitude: currentPosition.longitude,
      ...(message.trim().length > 0 ? { message: message.trim() } : {}),
    });
    if (abuseBlocked || alert === null) {
      // F29.4: trava de abuso ativou. A UI ja deveria ter desabilitado
      // o slider — esse caminho e defesa em profundidade.
      Alert.alert(
        'SOS bloqueado temporariamente',
        'Voce cancelou 3 ou mais SOS na ultima semana. Aguarde a trava expirar antes de tentar de novo.',
      );
      setSliderKey((k) => k + 1);
      return;
    }
    // F29.2 — propaga pra rede de motociclistas proximos. O transport
    // default e Loopback (in-process, util para self-test); em F29.2b
    // sera trocado por PeerJS broker model via WebView.
    const motoLabelForBroadcast =
      activeMoto !== undefined && activeMoto !== null
        ? `${activeMoto.brand} ${activeMoto.model}`.trim()
        : undefined;
    useSOSNetworkStore.getState().broadcastAlert({
      alert_id: alert.id,
      rider_name: riderName ?? 'Piloto',
      problem_type: alert.problem_type,
      latitude: alert.latitude,
      longitude: alert.longitude,
      created_at: alert.created_at,
      ...(motoLabelForBroadcast !== undefined
        ? { rider_moto: motoLabelForBroadcast }
        : {}),
      ...(alert.message !== undefined ? { message: alert.message } : {}),
    });
    if (meta.isHealth) {
      setHealthModalVisible(true);
    }
    // Outros problemas: o banner "SOS EM ABERTO" no topo da tela ja
    // confirma o estado. Sem alert popup pra nao engasgar quem ja sabe
    // o que esta fazendo.
  }, [activeMoto, currentPosition, fireSOS, message, riderName, selectedProblem]);

  const handleCloseHealth = useCallback(() => {
    setHealthModalVisible(false);
  }, []);

  const motoLabel = activeMoto
    ? `${activeMoto.brand} ${activeMoto.model}`.trim()
    : null;

  const hasGps = currentPosition !== null;
  const canActivate =
    selectedProblem !== null && hasGps && !abuseStatus.locked;
  const lockRemainingMs =
    abuseStatus.unlockAt !== null ? abuseStatus.unlockAt - now : 0;

  return (
    <SafeAreaView style={styles.safe} testID="screen-sos">
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          style={({ pressed }) => [
            styles.backBtn,
            pressed ? styles.backBtnPressed : null,
          ]}
          testID="btn-sos-back"
        >
          <Text style={styles.backBtnLabel}>{'< Voltar'}</Text>
        </Pressable>
        <Text style={styles.headerEyebrow}>⚠️  MÓDULO DE SOCORRO IMEDIATO</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
        testID="sos-scroll"
      >
        {abuseStatus.locked ? (
          <View style={styles.abuseBanner} testID="sos-abuse-banner">
            <Text style={styles.abuseBannerEyebrow}>SOS BLOQUEADO</Text>
            <Text style={styles.abuseBannerText}>
              Voce cancelou {abuseStatus.cancelsLast7d} SOS nos ultimos 7 dias.
              Pra proteger a confiabilidade da comunidade, o disparo esta
              bloqueado por mais {formatLockRemaining(lockRemainingMs)}.
            </Text>
          </View>
        ) : null}

        {currentAlert !== null ? (
          <View style={styles.activeBanner} testID="sos-active-banner">
            <Text style={styles.activeBannerEyebrow}>SOS EM ABERTO</Text>
            <Text style={styles.activeBannerText}>
              {SOS_PROBLEMS[currentAlert.problem_type].emoji}{' '}
              {SOS_PROBLEMS[currentAlert.problem_type].label}
            </Text>
            <Pressable
              onPress={handleCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancelar SOS atual"
              style={({ pressed }) => [
                styles.cancelBtn,
                pressed ? styles.cancelBtnPressed : null,
              ]}
              testID="btn-cancel-active-sos"
            >
              <Text style={styles.cancelBtnText}>CANCELAR SOS</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.title}>Selecione o seu problema</Text>
        <Text style={styles.subtitle}>
          {hasGps
            ? 'Voce sera identificado pra rede como ' +
              (riderName ?? 'Piloto') +
              (motoLabel !== null ? ` (${motoLabel})` : '') +
              '.'
            : 'Aguardando sinal de GPS... O SOS so dispara com posicao valida.'}
        </Text>

        <View style={styles.grid}>
          {PROBLEM_GRID.map((p) => {
            const meta = SOS_PROBLEMS[p];
            const selected = selectedProblem === p;
            return (
              <Pressable
                key={p}
                onPress={() => handleSelectProblem(p)}
                style={({ pressed }) => [
                  styles.problemCard,
                  selected ? styles.problemCardSelected : null,
                  pressed ? styles.problemCardPressed : null,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Selecionar ${meta.label}`}
                accessibilityState={{ selected }}
                testID={`btn-sos-problem-${p}`}
              >
                <Text style={styles.problemEmoji}>{meta.emoji}</Text>
                <Text style={styles.problemLabel}>{meta.label.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={() => handleSelectProblem('saude')}
          style={({ pressed }) => [
            styles.healthCard,
            selectedProblem === 'saude' ? styles.healthCardSelected : null,
            pressed ? styles.problemCardPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Selecionar Emergencia de Saude"
          accessibilityState={{ selected: selectedProblem === 'saude' }}
          testID="btn-sos-problem-saude"
        >
          <Text style={styles.healthEmoji}>🏥</Text>
          <Text style={styles.healthLabel}>
            EMERGÊNCIA DE SAÚDE (URGENTE)
          </Text>
        </Pressable>

        <View style={styles.messageBlock}>
          <Text style={styles.messageLabel}>MENSAGEM (OPCIONAL)</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder='Ex: "Estou sem camara de ar reserva"'
            placeholderTextColor={colors.textMuted}
            maxLength={120}
            multiline
            numberOfLines={2}
            style={styles.messageInput}
            testID="input-sos-message"
          />
          <Text style={styles.messageHint}>{message.length}/120</Text>
        </View>

        <View style={styles.sliderBlock}>
          <SlideToActivate
            key={sliderKey}
            label="DESLIZE PARA ATIVAR O SOS"
            disabled={!canActivate}
            onActivate={handleActivate}
            testID="slider-sos-activate"
          />
          {!canActivate ? (
            <Text style={styles.sliderHint}>
              {abuseStatus.locked
                ? 'SOS bloqueado por anti-abuso'
                : selectedProblem === null
                  ? 'Selecione um tipo de problema acima'
                  : 'Aguardando GPS estabilizar'}
            </Text>
          ) : null}
        </View>

        <Text style={styles.footerNote}>
          Ao deslizar voce notifica motociclistas num raio de ~15 km. Em
          F29.1 o broadcast pela rede esta desativado; so a tela de Saude
          esta totalmente funcional.
        </Text>
      </ScrollView>

      <HealthEmergencyModal
        visible={healthModalVisible}
        latitude={currentPosition?.latitude ?? null}
        longitude={currentPosition?.longitude ?? null}
        riderName={riderName}
        onClose={handleCloseHealth}
      />
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
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  backBtn: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minHeight: 32,
    justifyContent: 'center',
  },
  backBtnPressed: {
    opacity: 0.6,
  },
  backBtnLabel: {
    color: colors.accent,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
  },
  headerEyebrow: {
    color: colors.danger,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    marginTop: spacing.xs,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  activeBanner: {
    backgroundColor: 'rgba(211,47,47,0.15)',
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  abuseBanner: {
    backgroundColor: 'rgba(255,204,0,0.12)',
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  abuseBannerEyebrow: {
    color: colors.warning,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  abuseBannerText: {
    color: colors.warning,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: 22,
    marginTop: spacing.xs,
  },
  activeBannerEyebrow: {
    color: colors.danger,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  activeBannerText: {
    color: colors.textPrimary,
    fontSize: typography.navPrimary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navPrimary.lineHeight,
    marginVertical: spacing.xs,
  },
  cancelBtn: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.danger,
    borderRadius: radius.pill,
    marginTop: spacing.xs,
  },
  cancelBtnPressed: {
    opacity: 0.7,
  },
  cancelBtnText: {
    color: '#FFFFFF',
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
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
    lineHeight: 22,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  problemCard: {
    flexBasis: '48%',
    flexGrow: 1,
    padding: spacing.lg,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    minHeight: 100,
    justifyContent: 'center',
  },
  problemCardSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceElevated,
  },
  problemCardPressed: {
    opacity: 0.7,
  },
  problemEmoji: {
    fontSize: 32,
    marginBottom: spacing.xs,
  },
  problemLabel: {
    color: colors.textPrimary,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    textAlign: 'center',
  },
  healthCard: {
    marginTop: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.danger,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
  },
  healthCardSelected: {
    borderColor: '#FFFFFF',
  },
  healthEmoji: {
    fontSize: 32,
  },
  healthLabel: {
    color: '#FFFFFF',
    fontSize: typography.buttonLabel.fontSize,
    fontWeight: typography.buttonLabel.fontWeight,
    lineHeight: typography.buttonLabel.lineHeight,
    flexShrink: 1,
  },
  messageBlock: {
    marginTop: spacing.lg,
  },
  messageLabel: {
    color: colors.textSecondary,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    marginBottom: spacing.xs,
  },
  messageInput: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.sm,
    padding: spacing.sm,
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    lineHeight: 22,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  messageHint: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    textAlign: 'right',
    marginTop: 2,
  },
  sliderBlock: {
    marginTop: spacing.xl,
  },
  sliderHint: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    textAlign: 'center',
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  footerNote: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: 18,
    marginTop: spacing.xl,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
