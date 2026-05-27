import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, radius, spacing, typography } from '@/shared/theme';
import { loadCatalog } from '@/infrastructure/catalog/catalogClient';
import { useTripCompletionStore } from '@/state/tripCompletionStore';
import type { RootStackParamList } from '@/navigation/types';

/**
 * F35.3 / F35.4 — Banner rapido (4s) que aparece quando uma viagem foi
 * completada. Consome `lastCompletedStamp` do tripCompletionStore e chama
 * `acknowledgeStamp` ao auto-dismiss ou ao toque ("Ver meu passaporte").
 *
 * Renderizado IDEALMENTE no topo da HomeScreen (a tela "padrao" pra onde
 * o piloto volta apos completar a navegacao via popToTop).
 */

const AUTO_DISMISS_MS = 4000;

export const StampBanner: React.FC = () => {
  const stamp = useTripCompletionStore((s) => s.lastCompletedStamp);
  const acknowledgeStamp = useTripCompletionStore((s) => s.acknowledgeStamp);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const routeName = useMemo<string | null>(() => {
    if (!stamp) return null;
    const catalog = loadCatalog();
    return catalog.find((r) => r.rota_id === stamp.rotaId)?.nome_rota ?? null;
  }, [stamp]);

  useEffect(() => {
    if (!stamp) return;
    const handle = setTimeout(() => {
      acknowledgeStamp();
    }, AUTO_DISMISS_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [stamp, acknowledgeStamp]);

  if (!stamp) return null;

  const handleOpen = (): void => {
    acknowledgeStamp();
    navigation.navigate('Passport');
  };

  return (
    <View style={styles.wrap} testID="stamp-banner">
      <Pressable
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel="Abrir passaporte"
        style={({ pressed }) => [
          styles.card,
          pressed ? styles.cardPressed : null,
        ]}
      >
        <Text style={styles.icon}>🏆</Text>
        <View style={styles.body}>
          <Text style={styles.eyebrow}>CONQUISTA DESBLOQUEADA</Text>
          <Text style={styles.title} numberOfLines={1}>
            {routeName ?? 'Rota concluida'}
          </Text>
          <Text style={styles.cta}>VER MEU PASSAPORTE ›</Text>
        </View>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 1000,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  cardPressed: {
    opacity: 0.85,
  },
  icon: {
    fontSize: 36,
    marginRight: spacing.md,
  },
  body: {
    flex: 1,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
    marginTop: spacing.xs,
  },
  cta: {
    color: colors.accent,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
});
