import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '@/shared/theme';

/**
 * F32 — Avatar circular do piloto. Mostra a imagem persistida (via
 * `avatarUri`) ou cai pro fallback de "primeira letra do nome em
 * circulo laranja" se nao houver foto.
 *
 * Quando `onPress` e fornecido, vira pressable — exibe overlay sutil
 * "CAMERA" no hover/press pra sugerir que e clicavel.
 */
export interface AvatarProps {
  uri?: string;
  initial: string;
  size?: number;
  onPress?: () => void;
  testID?: string;
}

const DEFAULT_SIZE = 96;

export const Avatar: React.FC<AvatarProps> = ({
  uri,
  initial,
  size = DEFAULT_SIZE,
  onPress,
  testID,
}) => {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  const fontSize = Math.round(size * 0.42);

  const content =
    typeof uri === 'string' && uri.length > 0 ? (
      <Image
        source={{ uri }}
        style={[styles.image, dim]}
        accessibilityIgnoresInvertColors
        resizeMode="cover"
      />
    ) : (
      <View style={[styles.fallback, dim]}>
        <Text
          style={[styles.fallbackText, { fontSize, lineHeight: fontSize + 4 }]}
          allowFontScaling={false}
        >
          {initial}
        </Text>
      </View>
    );

  if (onPress === undefined) {
    return (
      <View style={styles.container} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Trocar foto do perfil"
      style={({ pressed }) => [
        styles.container,
        pressed ? styles.pressed : null,
      ]}
      testID={testID}
    >
      {content}
      <View style={[styles.editBadge, { borderRadius: size / 6 }]}>
        <Text style={styles.editBadgeText} allowFontScaling={false}>
          TROCAR
        </Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.8,
  },
  image: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  fallback: {
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.accentDark,
  },
  fallbackText: {
    color: '#FFFFFF',
    fontWeight: '900',
    textAlign: 'center',
  },
  editBadge: {
    position: 'absolute',
    bottom: -4,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  editBadgeText: {
    color: colors.textPrimary,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    textTransform: typography.eyebrow.textTransform,
  },
});
