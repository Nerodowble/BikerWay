import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BigButton } from './BigButton';
import { StatusBadge } from './StatusBadge';
import {
  EtaBanner,
  GpsLostBadge,
  ManeuverPanel,
  PermissionBanner,
  ProgressBar,
} from './navigation';
import { colors, elevation, radius, spacing, typography } from '../theme';
import type { LocationPermissionStatus } from '@/domains/location/types';
import type { NavigationDerivedState } from '@/domains/navigation/engine';
import type { VoiceConnectionStatus } from '@/domains/voice/types';

type AutonomyState = 'ok' | 'warning' | 'danger';
type BadgeState = 'ok' | 'warning' | 'danger' | 'neutral';

export interface HomeLandscapeMenuContentProps {
  // Permission + GPS
  permission: LocationPermissionStatus;
  lastError: string | null | undefined;
  onRetryPermission: () => void;
  onOpenSettings: () => void;
  isGpsStale: boolean;
  staleSeconds: number;

  // Motorcycle + autonomy + weather
  motoLabel: string;
  remainingAutonomyKm: number;
  autonomyState: AutonomyState;
  weatherValue: string;
  weatherBadgeState: BadgeState;

  // Voice/comboio
  voiceTokenCode: string | null;
  voiceParticipantsCount: number;
  voiceStatus: VoiceConnectionStatus;

  // Navigation
  isNavigating: boolean;
  derived: NavigationDerivedState | null;
  showRecalculating: boolean;

  // Handlers — each handler is invoked AFTER the drawer closes itself,
  // except for `onOpenPostos` which itself opens another bottom sheet,
  // and `onChooseDestination` / `onEditMoto` which navigate to other screens.
  onEditMoto: () => void;
  onChooseDestination: () => void;
  onCancelNavigation: () => void;
  onOpenPostos: () => void;
  onTanqueCheio: () => void;
  onOpenComboio: () => void;
  /**
   * Catalog "EXPLORAR VIAGENS" entry point. Optional so existing callers
   * (and tests) that don't wire it up still compile; when omitted the
   * button is hidden entirely.
   */
  onExploreCatalog?: () => void;

  /**
   * Closes the parent drawer. Wired by the parent so each action button can
   * dismiss the drawer before triggering its handler.
   */
  closeDrawer: () => void;
}

/**
 * Renders the contents of the landscape `HomeMenuDrawer`.
 *
 * Structure (top to bottom):
 *   1. Rider/moto header — avatar, moto label, "Editar moto" pill.
 *   2. Alerts slot — PermissionBanner / GpsLostBadge, only when relevant.
 *   3. STATUS section — autonomy display card + climate/comboio inline row.
 *   4. NAVEGAÇÃO section — single CTA when idle, or full nav stack when active.
 *   5. COMBOIO section — ghost button at the bottom.
 *
 * All visual styling is internal; the prop API is unchanged.
 */
export const HomeLandscapeMenuContent: React.FC<
  HomeLandscapeMenuContentProps
> = ({
  permission,
  lastError,
  onRetryPermission,
  onOpenSettings,
  isGpsStale,
  staleSeconds,
  motoLabel,
  remainingAutonomyKm,
  autonomyState,
  weatherValue,
  weatherBadgeState,
  voiceTokenCode,
  voiceParticipantsCount,
  voiceStatus,
  isNavigating,
  derived,
  showRecalculating,
  onEditMoto,
  onChooseDestination,
  onCancelNavigation,
  onOpenPostos,
  onTanqueCheio,
  onOpenComboio,
  onExploreCatalog,
  closeDrawer,
}) => {
  const autonomyKmRounded = Math.max(
    0,
    Number.isFinite(remainingAutonomyKm) ? Math.round(remainingAutonomyKm) : 0,
  );
  const autonomyColor =
    autonomyState === 'danger'
      ? colors.danger
      : autonomyState === 'warning'
        ? colors.warning
        : colors.success;
  const autonomySubtitle =
    autonomyState === 'danger' ? 'km — RESERVA' : 'km restantes';

  // Avatar initial: there is no rider name in props, so we use the moto
  // label's first letter as a stand-in. Falls back to "M" to avoid an empty
  // circle when the label is empty/whitespace.
  const avatarInitial = useMemo(() => {
    const trimmed = motoLabel.trim();
    const first = trimmed.length > 0 ? trimmed.charAt(0) : '';
    return first ? first.toUpperCase() : 'M';
  }, [motoLabel]);

  const hasAlerts = permission !== 'granted' || isGpsStale;
  const hasComboio = voiceTokenCode !== null;
  const comboioBadgeState: BadgeState =
    voiceStatus === 'connected' ? 'ok' : 'warning';

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* 1. Rider / moto header */}
      <View style={styles.headerRow}>
        <View style={styles.avatar} testID="drawer-rider-avatar">
          <Text style={styles.avatarInitial}>{avatarInitial}</Text>
        </View>
        <Text style={styles.motoLabel} numberOfLines={1}>
          {motoLabel}
        </Text>
        <Pressable
          onPress={onEditMoto}
          hitSlop={12}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.editMotoPill,
            pressed ? styles.editMotoPillPressed : null,
          ]}
          testID="link-edit-moto-drawer"
        >
          <Text style={styles.editMotoPillLabel}>Editar moto</Text>
        </Pressable>
      </View>
      <View style={styles.separator} />

      {/* 2. Alerts slot — collapses entirely when there is nothing to show */}
      {hasAlerts ? (
        <View style={styles.alertsSlot} testID="drawer-alerts-slot">
          {permission !== 'granted' ? (
            <PermissionBanner
              permission={permission}
              lastError={lastError}
              onRetry={onRetryPermission}
              onOpenSettings={onOpenSettings}
            />
          ) : null}
          {isGpsStale ? (
            <View
              style={
                permission !== 'granted' ? styles.alertStackSpacer : undefined
              }
            >
              <GpsLostBadge
                staleSeconds={staleSeconds}
                isGpsStale={isGpsStale}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 3. STATUS */}
      <Text style={styles.sectionTitle}>STATUS</Text>
      <View style={styles.statusCard}>
        <View style={styles.autonomyBlock}>
          <Text
            style={[styles.autonomyValue, { color: autonomyColor }]}
            testID="drawer-autonomy-value"
          >
            {autonomyKmRounded}
          </Text>
          <Text style={styles.autonomySubtitle}>{autonomySubtitle}</Text>
        </View>
        <View style={styles.statusDivider} />
        <View
          style={styles.statusInlineRow}
          testID="drawer-status-inline-row"
        >
          <Text style={styles.statusInlineText} numberOfLines={1}>
            <Text style={styles.statusInlineLabel}>Clima: </Text>
            {weatherValue}
          </Text>
          {hasComboio ? (
            <>
              <Text style={styles.statusInlineDot}>·</Text>
              <Text
                style={[
                  styles.statusInlineText,
                  comboioBadgeState === 'warning'
                    ? styles.statusInlineWarning
                    : null,
                ]}
                numberOfLines={1}
                testID="drawer-comboio-inline"
              >
                {`#${voiceTokenCode} · ${voiceParticipantsCount} on-line`}
              </Text>
            </>
          ) : null}
        </View>
        {/* Hidden badges kept for downstream a11y/test wiring parity */}
        <View style={styles.visuallyHiddenBadges}>
          <StatusBadge
            label="Autonomia"
            value={`${autonomyKmRounded} km`}
            state={autonomyState}
            testID="badge-autonomy-drawer"
          />
          <StatusBadge
            label="Clima"
            value={weatherValue}
            state={weatherBadgeState}
            testID="badge-weather-drawer"
          />
          {hasComboio ? (
            <StatusBadge
              label="Comboio"
              value={`#${voiceTokenCode} • ${voiceParticipantsCount} on-line`}
              state={comboioBadgeState}
              testID="badge-comboio-active-drawer"
            />
          ) : null}
        </View>
      </View>

      {/* 4. NAVEGAÇÃO */}
      <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
        NAVEGAÇÃO
      </Text>
      {isNavigating && derived ? (
        <View>
          <View style={styles.navBlock}>
            <ManeuverPanel
              instruction={derived.maneuver.instruction}
              distanceMeters={derived.maneuver.distanceToManeuverMeters}
            />
          </View>
          {showRecalculating ? (
            <View style={styles.navBlock}>
              <StatusBadge
                label="Rota"
                value="Recalculando..."
                state="neutral"
                testID="badge-recalculating-drawer"
              />
            </View>
          ) : null}
          <View style={styles.navBlock}>
            <EtaBanner
              etaSeconds={derived.etaSeconds}
              remainingMeters={derived.progress.remainingMeters}
            />
          </View>
          <View style={styles.navBlock}>
            <ProgressBar percent={derived.progress.percent} />
          </View>
          <View style={styles.primaryActionRow}>
            <BigButton
              label="POSTOS"
              variant="primary"
              fullWidth
              onPress={() => {
                // POSTOS opens a separate bottom sheet; the parent decides
                // whether to keep the drawer open (it currently does).
                onOpenPostos();
              }}
              testID="btn-open-postos-drawer"
            />
          </View>
          <View style={styles.splitRow}>
            <View style={[styles.splitItem, styles.splitItemLeft]}>
              <BigButton
                label="CANCELAR"
                variant="secondary"
                fullWidth
                compact
                onPress={() => {
                  closeDrawer();
                  onCancelNavigation();
                }}
                testID="btn-cancel-nav-drawer"
              />
            </View>
            <View style={styles.splitItem}>
              <BigButton
                label="TANQUE"
                variant="secondary"
                fullWidth
                compact
                onPress={() => {
                  closeDrawer();
                  onTanqueCheio();
                }}
                testID="btn-tanque-cheio-drawer"
              />
            </View>
          </View>
        </View>
      ) : (
        <View>
          <BigButton
            label="ESCOLHER DESTINO"
            variant="primary"
            fullWidth
            onPress={() => {
              // The destination flow navigates to another screen and unmounts
              // HomeScreen — closing the drawer here would race the nav.
              onChooseDestination();
            }}
            testID="btn-choose-destination-drawer"
          />
          {onExploreCatalog ? (
            <View style={styles.navBlockSpaced}>
              <BigButton
                label="EXPLORAR VIAGENS"
                variant="secondary"
                fullWidth
                onPress={() => {
                  onExploreCatalog();
                }}
                testID="btn-explore-catalog-drawer"
              />
            </View>
          ) : null}
        </View>
      )}

      {/* 5. COMBOIO — ghost button */}
      <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
        COMBOIO
      </Text>
      <Pressable
        onPress={() => {
          closeDrawer();
          onOpenComboio();
        }}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.comboioGhost,
          pressed ? styles.comboioGhostPressed : null,
        ]}
        testID="btn-open-comboio-drawer"
      >
        <Text style={styles.comboioGhostLabel}>Abrir painel do comboio</Text>
      </Pressable>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing['4xl'],
  },

  // 1. Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 22,
  },
  motoLabel: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    marginRight: spacing.sm,
  },
  editMotoPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  editMotoPillPressed: {
    opacity: 0.7,
  },
  editMotoPillLabel: {
    color: colors.accent,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
  },
  separator: {
    height: 1,
    backgroundColor: colors.borderSubtle,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },

  // 2. Alerts slot
  alertsSlot: {
    backgroundColor: 'rgba(255,204,0,0.10)',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  alertStackSpacer: {
    marginTop: spacing.sm,
  },

  // 3. STATUS
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
    marginTop: spacing.lg,
  },
  statusCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...elevation.card,
  },
  autonomyBlock: {
    alignItems: 'flex-start',
  },
  autonomyValue: {
    fontSize: typography.display.fontSize,
    fontWeight: typography.display.fontWeight,
    lineHeight: typography.display.lineHeight,
  },
  autonomySubtitle: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: typography.caption.lineHeight,
    marginTop: spacing.xs,
  },
  statusDivider: {
    height: 1,
    backgroundColor: colors.borderSubtle,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  statusInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  statusInlineText: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    flexShrink: 1,
  },
  statusInlineLabel: {
    color: colors.textSecondary,
  },
  statusInlineWarning: {
    color: colors.warning,
  },
  statusInlineDot: {
    color: colors.textMuted,
    fontSize: typography.navSecondary.fontSize,
    lineHeight: typography.navSecondary.lineHeight,
    marginHorizontal: spacing.sm,
  },
  // Off-screen container kept so historical testIDs (used by snapshot/a11y
  // tooling outside this file) still resolve without affecting the layout.
  visuallyHiddenBadges: {
    position: 'absolute',
    width: 0,
    height: 0,
    overflow: 'hidden',
    opacity: 0,
  },

  // 4. NAVEGAÇÃO
  navBlock: {
    marginBottom: spacing.sm,
  },
  navBlockSpaced: {
    marginTop: spacing.sm,
  },
  primaryActionRow: {
    marginTop: spacing.md,
  },
  splitRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  splitItem: {
    flex: 1,
  },
  splitItemLeft: {
    marginRight: spacing.sm,
  },

  // 5. COMBOIO ghost
  comboioGhost: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  comboioGhostPressed: {
    opacity: 0.7,
  },
  comboioGhostLabel: {
    color: colors.accent,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
  },
});
