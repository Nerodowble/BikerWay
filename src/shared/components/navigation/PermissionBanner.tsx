import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, hitTarget, radius, spacing, typography } from '@/shared/theme';
import type { LocationPermissionStatus } from '@/domains/location/types';

export interface PermissionBannerProps {
  permission: LocationPermissionStatus;
  lastError?: string | null;
  onRetry: () => void;
  onOpenSettings: () => void;
}

interface BannerCopy {
  title: string;
  body: string;
  showRetry: boolean;
}

function copyForPermission(
  permission: LocationPermissionStatus,
  lastError: string | null | undefined,
): BannerCopy | null {
  switch (permission) {
    case 'granted':
      return null;
    case 'undetermined':
      return {
        title: 'Localização desabilitada',
        body: 'Conceda permissão de localização para navegar.',
        showRetry: true,
      };
    case 'denied': {
      const tail = lastError ? ` (${lastError})` : '';
      return {
        title: 'Localização desabilitada',
        body: `Toque em Tentar novamente para repetir a solicitação ou abra as Configurações do sistema.${tail}`,
        showRetry: true,
      };
    }
    case 'restricted':
      return {
        title: 'Localização desabilitada',
        body: 'A permissão foi restringida pelo dispositivo. Abra as Configurações para ajustar.',
        showRetry: false,
      };
    default:
      return null;
  }
}

interface PillButtonProps {
  label: string;
  onPress: () => void;
  variant: 'primary' | 'ghost';
  testID?: string;
}

const PillButton: React.FC<PillButtonProps> = ({
  label,
  onPress,
  variant,
  testID,
}) => {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
      android_ripple={{ color: 'rgba(0,0,0,0.2)' }}
      style={[
        styles.pill,
        isPrimary ? styles.pillPrimary : styles.pillGhost,
      ]}
    >
      <Text
        style={[
          styles.pillLabel,
          isPrimary ? styles.pillLabelPrimary : styles.pillLabelGhost,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
};

/**
 * Warning banner shown when location permission is not in a usable state.
 * Renders nothing for 'granted'. The `restricted` state hides the retry
 * action because the OS rejects programmatic re-requests in that mode.
 */
export const PermissionBanner: React.FC<PermissionBannerProps> = ({
  permission,
  lastError,
  onRetry,
  onOpenSettings,
}) => {
  const copy = copyForPermission(permission, lastError);
  if (!copy) {
    return null;
  }

  return (
    <View style={styles.container} testID="permission-banner">
      <Text style={styles.title} testID="permission-banner-title">
        {copy.title}
      </Text>
      <Text style={styles.body} testID="permission-banner-body">
        {copy.body}
      </Text>
      <View style={styles.actions}>
        {copy.showRetry ? (
          <PillButton
            label="Tentar novamente"
            onPress={onRetry}
            variant="ghost"
            testID="permission-banner-retry"
          />
        ) : null}
        <PillButton
          label="Abrir Configurações"
          onPress={onOpenSettings}
          variant="primary"
          testID="permission-banner-settings"
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.warning,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  title: {
    color: '#121212',
    fontSize: typography.navPrimary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navPrimary.lineHeight,
    marginBottom: spacing.xs,
  },
  body: {
    color: '#121212',
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    marginBottom: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  pill: {
    minHeight: 48,
    minWidth: hitTarget.min,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    marginTop: spacing.xs,
  },
  pillPrimary: {
    backgroundColor: '#121212',
  },
  pillGhost: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#121212',
  },
  pillLabel: {
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
  },
  pillLabelPrimary: {
    color: colors.warning,
  },
  pillLabelGhost: {
    color: '#121212',
  },
});
