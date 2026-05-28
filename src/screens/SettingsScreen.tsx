import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '@/shared/components/Screen';
import { BigButton } from '@/shared/components/BigButton';
import {
  CloseIcon,
  ComboioIcon,
  GearIcon,
  MapPinIcon,
} from '@/shared/components/icons';
import { Avatar } from '@/shared/components/rider/Avatar';
import { colors, radius, spacing, typography } from '@/shared/theme';
import {
  useMotorcycleStore,
  selectActiveMotorcycle,
} from '@/state/motorcycleStore';
import { useRiderStore, selectRiderCityState } from '@/state/riderStore';
import { useComboioPreferencesStore } from '@/state/comboioPreferencesStore';
import type { ComboioPreferences } from '@/domains/comboio/preferences';
import { avatarInitial } from '@/domains/rider/avatar';
import { useMovementLock } from '@/shared/hooks/useMovementLock';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

// App version is hardcoded here on purpose. The previous attempt to read it
// from `expo-constants` introduced a runtime dependency on Application.* that
// is non-trivial to mock for tests and triggers a noisy warning on web/SSR.
// Until we have a build-time constant pipeline we just keep this in sync
// with `app.json -> expo.version` manually.
const APP_VERSION = '0.1.0';

export const SettingsScreen: React.FC<Props> = ({ navigation }) => {
  // Selectors are kept narrow so a SettingsScreen mount never re-renders
  // because of unrelated store activity (e.g. an in-flight reroute updating
  // navigationStore).
  const profile = useRiderStore((s) => s.profile);
  const cityState = useRiderStore(selectRiderCityState);
  const motorcycles = useMotorcycleStore((s) => s.motorcycles);
  const activeMotorcycle = useMotorcycleStore(selectActiveMotorcycle);
  // Mirror RiderProfileScreen / MotorcycleSetupScreen: gate navigation to
  // edit-screens when the rider is moving (> 5 km/h). Settings itself stays
  // readable while moving — we only block the secondary jump-offs.
  const { isMoving } = useMovementLock();

  const handleClose = (): void => {
    navigation.goBack();
  };

  const handleOpenRiderProfile = (): void => {
    if (isMoving) return;
    navigation.navigate('RiderProfile');
  };

  const handleEditMotorcycle = (id: string): void => {
    if (isMoving) return;
    navigation.navigate('MotorcycleSetup', { editMotorcycleId: id });
  };

  const handleAddMotorcycle = (): void => {
    if (isMoving) return;
    // No editMotorcycleId so MotorcycleSetup opens an empty form for adding.
    navigation.navigate('MotorcycleSetup', undefined);
  };

  const handleOpenSOS = (): void => {
    // SOS deliberadamente NAO e bloqueado por isMoving — o piloto pode ter
    // batido e estar imovel sem chegar a 5 km/h, mas tambem pode estar
    // pedindo ajuda durante uma queda recente. Nao queremos UI travada
    // exatamente no momento em que ele mais precisa.
    navigation.navigate('SOS');
  };

  const handleOpenPassport = (): void => {
    // Passaporte e somente leitura — nao precisa de movement lock.
    navigation.navigate('Passport');
  };

  const riderStatusLine: string = profile
    ? cityState
      ? `${profile.displayName} · ${cityState}`
      : profile.displayName
    : 'Nao cadastrado';

  const motorcycleCount = motorcycles.length;

  return (
    <Screen scroll padding testID="screen-settings">
      <View style={styles.headerRow}>
        <Pressable
          onPress={handleClose}
          // hitSlop so the close target stays >= 44dp even though the X icon
          // visually reads as ~24dp.
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          style={({ pressed }) => [
            styles.closeButton,
            pressed ? styles.closeButtonPressed : null,
          ]}
          testID="btn-close-settings"
        >
          <CloseIcon size={20} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerEyebrow}>CONFIGURACOES</Text>
          <Text style={styles.headerTitle}>Ajustes do app</Text>
        </View>
        <View style={styles.headerIconWrap}>
          <GearIcon size={28} color={colors.accent} />
        </View>
      </View>

      {isMoving ? (
        <Text style={styles.movementWarning} testID="warning-movement-lock">
          Pare a moto para editar os cadastros. Movimento detectado (&gt; 5
          km/h).
        </Text>
      ) : null}

      <View style={styles.section} testID="settings-section-rider">
        <Text style={styles.sectionEyebrow}>MEU PERFIL</Text>
        <View style={styles.riderRow}>
          <Avatar
            uri={profile?.avatarUri}
            initial={avatarInitial(profile?.displayName)}
            size={56}
            testID="settings-rider-avatar"
          />
          <Text
            style={[
              styles.statusLine,
              styles.riderRowText,
              profile ? null : styles.statusLineEmpty,
            ]}
            numberOfLines={2}
            testID="settings-rider-status"
          >
            {riderStatusLine}
          </Text>
        </View>
        <View style={styles.actionRow}>
          <BigButton
            label={profile ? 'EDITAR PERFIL' : 'CRIAR PERFIL'}
            variant="secondary"
            fullWidth
            disabled={isMoving}
            leadingIcon={<MapPinIcon size={22} color={colors.textPrimary} />}
            onPress={handleOpenRiderProfile}
            accessibilityLabel={
              profile ? 'Editar perfil do piloto' : 'Criar perfil do piloto'
            }
            testID="btn-settings-rider"
          />
        </View>
      </View>

      <View style={styles.section} testID="settings-section-motorcycles">
        <Text style={styles.sectionEyebrow}>MINHAS MOTOS</Text>
        {motorcycleCount === 0 ? (
          <Text
            style={[styles.statusLine, styles.statusLineEmpty]}
            testID="settings-motorcycles-status"
          >
            Nenhuma moto cadastrada
          </Text>
        ) : (
          <View
            style={styles.motorcycleList}
            testID="settings-motorcycles-status"
          >
            {motorcycles.map((moto) => {
              const isActive = activeMotorcycle?.id === moto.id;
              return (
                <Pressable
                  key={moto.id}
                  onPress={() => handleEditMotorcycle(moto.id)}
                  disabled={isMoving}
                  accessibilityRole="button"
                  accessibilityLabel={`Editar ${moto.brand} ${moto.model}`}
                  style={({ pressed }) => [
                    styles.motorcycleRow,
                    isActive ? styles.motorcycleRowActive : null,
                    pressed ? styles.motorcycleRowPressed : null,
                    isMoving ? styles.motorcycleRowDisabled : null,
                  ]}
                  testID={`btn-edit-motorcycle-${moto.id}`}
                >
                  <View style={styles.motorcycleRowText}>
                    <Text style={styles.motorcycleRowName} numberOfLines={1}>
                      {moto.brand} {moto.model}
                    </Text>
                    {isActive ? (
                      <Text style={styles.motorcycleRowBadge}>ATIVA</Text>
                    ) : null}
                  </View>
                  <Text style={styles.motorcycleRowChevron}>›</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={styles.actionRow}>
          <BigButton
            label={motorcycleCount === 0 ? 'CADASTRAR MOTO' : 'ADICIONAR NOVA MOTO'}
            variant="secondary"
            fullWidth
            disabled={isMoving}
            // Comboio icon doubles as a "garage / vehicles" affordance here —
            // we don't have a dedicated motorcycle icon yet and a pin would
            // duplicate the perfil button's leading visual.
            leadingIcon={<ComboioIcon size={22} color={colors.textPrimary} />}
            onPress={handleAddMotorcycle}
            accessibilityLabel={
              motorcycleCount === 0 ? 'Cadastrar moto' : 'Adicionar nova moto'
            }
            testID="btn-settings-motorcycles"
          />
        </View>
      </View>

      <ComboioPreferencesSection />

      <View style={styles.section} testID="settings-section-passport">
        <Text style={styles.sectionEyebrow}>MEU PASSAPORTE</Text>
        <Text style={styles.statusLine}>
          Veja suas rotas conquistadas, distancia total rodada e conquistas
          desbloqueadas. Tudo guardado localmente, sem nuvem.
        </Text>
        <View style={styles.actionRow}>
          <BigButton
            label="ABRIR PASSAPORTE"
            variant="secondary"
            fullWidth
            onPress={handleOpenPassport}
            accessibilityLabel="Abrir passaporte com rotas conquistadas e conquistas"
            testID="btn-settings-passport"
          />
        </View>
      </View>

      <View style={styles.section} testID="settings-section-sos">
        <Text style={styles.sectionEyebrow}>SOCORRO IMEDIATO</Text>
        <Text style={styles.statusLine}>
          Abre a tela de SOS Comunitario. Em emergencia de saude, da acesso
          rapido a 192 (SAMU) / 193 (Bombeiros) e compartilha sua
          localizacao via WhatsApp.
        </Text>
        <View style={styles.actionRow}>
          <BigButton
            label="ABRIR SOS DE EMERGÊNCIA"
            variant="danger"
            fullWidth
            onPress={handleOpenSOS}
            accessibilityLabel="Abrir tela de SOS de emergencia"
            testID="btn-settings-sos"
          />
        </View>
      </View>

      <View style={styles.section} testID="settings-section-about">
        <Text style={styles.sectionEyebrow}>SOBRE</Text>
        <Text style={styles.aboutPrimary}>BikerWay v{APP_VERSION}</Text>
        <Text style={styles.aboutSecondary}>
          Navegacao para motociclistas. Open source · Mapas OpenStreetMap ·
          Tiles CartoDB · Rotas OSRM · Clima Open-Meteo.
        </Text>
      </View>
    </Screen>
  );
};

/**
 * F34.0 — Seção de preferências do comboio. 6 toggles persistidos via
 * `useComboioPreferencesStore`. Defaults: replay/km-h OFF; parados,
 * separação, rota oficial, cross-path ON.
 */
const ComboioPreferencesSection: React.FC = () => {
  const preferences = useComboioPreferencesStore((s) => s.preferences);
  const toggle = useComboioPreferencesStore((s) => s.toggle);

  const items: Array<{
    key: keyof ComboioPreferences;
    icon: string;
    title: string;
    description: string;
  }> = [
    {
      key: 'recordReplay',
      icon: '🎥',
      title: 'Gravar minhas viagens',
      description:
        'Guarda o caminho que você fez pra você poder ver de novo depois. Fica só no seu celular.',
    },
    {
      key: 'showSpeedOnPin',
      icon: '⚡',
      title: 'Mostrar a velocidade do pessoal',
      description:
        'A velocidade de cada um do grupo aparece embaixo do nome no mapa.',
    },
    {
      key: 'highlightStopped',
      icon: '⏸️',
      title: 'Avisar quem está parado',
      description:
        'Destaca no mapa quem está parado faz mais de meio minuto.',
    },
    {
      key: 'alertSeparation',
      icon: '⚠️',
      title: 'Avisar quando alguém se afastar',
      description:
        'Mostra um aviso se alguém do grupo ficar mais de 3 km longe por uns 3 minutos.',
    },
    {
      key: 'showOfficialRoute',
      icon: '🛣️',
      title: 'Mostrar o caminho do líder do grupo',
      description:
        'Quem cria o comboio pode compartilhar o caminho oficial. Aparece como uma linha azul tracejada no mapa.',
    },
    {
      key: 'crossPathBanner',
      icon: '🔀',
      title: 'Avisar quando eu encontrar o grupo',
      description:
        'Quando você passa pelo caminho do grupo, aparece um aviso perguntando se você quer seguir junto.',
    },
  ];

  return (
    <View style={styles.section} testID="settings-section-comboio-prefs">
      <Text style={styles.sectionEyebrow}>AJUSTES DO COMBOIO</Text>
      <Text style={styles.statusLine}>
        Liga uma vez e vale pra todo comboio que você entrar. Cada
        opção funciona separada.
      </Text>
      {items.map((item) => (
        <Pressable
          key={item.key}
          onPress={() => toggle(item.key)}
          accessibilityRole="switch"
          accessibilityState={{ checked: preferences[item.key] }}
          accessibilityLabel={item.title}
          testID={`toggle-comboio-${item.key}`}
          style={({ pressed }) => [
            styles.toggleRow,
            pressed ? styles.toggleRowPressed : null,
          ]}
        >
          <Text style={styles.toggleIcon}>{item.icon}</Text>
          <View style={styles.toggleBody}>
            <Text style={styles.toggleTitle}>{item.title}</Text>
            <Text style={styles.toggleDescription}>{item.description}</Text>
          </View>
          <View
            style={[
              styles.toggleSwitch,
              preferences[item.key] ? styles.toggleSwitchOn : null,
            ]}
          >
            <View
              style={[
                styles.toggleThumb,
                preferences[item.key] ? styles.toggleThumbOn : null,
              ]}
            />
          </View>
        </Pressable>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  closeButtonPressed: {
    opacity: 0.7,
  },
  headerTextWrap: {
    flex: 1,
  },
  headerEyebrow: {
    color: colors.textSecondary,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: typography.navPrimary.fontSize,
    fontWeight: typography.navPrimary.fontWeight,
    lineHeight: typography.navPrimary.lineHeight,
    marginTop: 2,
  },
  headerIconWrap: {
    marginLeft: spacing.sm,
  },
  movementWarning: {
    color: colors.warning,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
    marginBottom: spacing.md,
  },
  section: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionEyebrow: {
    color: colors.textSecondary,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    marginBottom: spacing.xs,
  },
  statusLine: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    marginBottom: spacing.md,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.sm,
  },
  toggleRowPressed: {
    opacity: 0.7,
  },
  toggleIcon: {
    fontSize: 24,
  },
  toggleBody: {
    flex: 1,
  },
  toggleTitle: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
  },
  toggleDescription: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    lineHeight: 18,
    marginTop: 2,
  },
  toggleSwitch: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.borderSubtle,
    padding: 2,
    justifyContent: 'center',
  },
  toggleSwitchOn: {
    backgroundColor: colors.accent,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
  },
  riderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  riderRowText: {
    flex: 1,
    marginBottom: 0,
  },
  statusLineEmpty: {
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  actionRow: {
    marginTop: spacing.xs,
  },
  motorcycleList: {
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  motorcycleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  motorcycleRowActive: {
    borderColor: colors.accent,
  },
  motorcycleRowPressed: {
    opacity: 0.7,
  },
  motorcycleRowDisabled: {
    opacity: 0.4,
  },
  motorcycleRowText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  motorcycleRowName: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
    flexShrink: 1,
  },
  motorcycleRowBadge: {
    color: colors.accent,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: 'rgba(255,102,0,0.12)',
    borderRadius: radius.pill,
  },
  motorcycleRowChevron: {
    color: colors.textMuted,
    fontSize: 24,
    fontWeight: '700',
    marginLeft: spacing.sm,
  },
  aboutPrimary: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
    marginBottom: spacing.xs,
  },
  aboutSecondary: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
  },
});
