import React, { useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { colors, radius, spacing, typography } from '@/shared/theme';

/**
 * Slide-to-activate (F29.1). Padrao tipico de confirmacao destrutiva — o
 * piloto precisa arrastar o knob ate o fim da trilha pra disparar. Evita
 * tap acidental no bolso ou no porta-luvas durante uma queda.
 *
 * Implementacao com PanResponder + Animated (built-in RN, sem react-native-
 * gesture-handler). Threshold de 85% do percurso pra disparar — mais
 * tolerante que 100% pra nao frustrar o piloto, menos tolerante que 50%
 * pra evitar trigger acidental.
 *
 * Props:
 * - label: texto da trilha (ex: "Deslize para ativar o SOS")
 * - disabled: trava o slide quando nenhum problema esta selecionado
 * - onActivate: chamado uma vez quando o threshold e atingido. Apos chamar,
 *   o slider trava no fim ate o consumer resetar via `key` change.
 */
interface SlideToActivateProps {
  label: string;
  disabled?: boolean;
  onActivate: () => void;
  testID?: string;
}

const KNOB_SIZE = 56;
const ACTIVATION_THRESHOLD = 0.85;

export const SlideToActivate: React.FC<SlideToActivateProps> = ({
  label,
  disabled = false,
  onActivate,
  testID,
}) => {
  const [trackWidth, setTrackWidth] = useState(0);
  const [activated, setActivated] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;
  const lastDx = useRef(0);

  // Range maximo de translacao do knob: largura do track menos o tamanho
  // do knob (knob comeca no canto esquerdo, ainda dentro do track).
  const maxTranslate = useMemo(() => {
    if (trackWidth <= KNOB_SIZE) return 0;
    return trackWidth - KNOB_SIZE - spacing.sm * 2;
  }, [trackWidth]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled && !activated,
        onMoveShouldSetPanResponder: () => !disabled && !activated,
        onPanResponderGrant: () => {
          lastDx.current = 0;
        },
        onPanResponderMove: (_evt, gesture) => {
          if (disabled || activated) return;
          const clamped = Math.max(0, Math.min(maxTranslate, gesture.dx));
          lastDx.current = clamped;
          translateX.setValue(clamped);
        },
        onPanResponderRelease: () => {
          if (disabled || activated) return;
          const progress =
            maxTranslate > 0 ? lastDx.current / maxTranslate : 0;
          if (progress >= ACTIVATION_THRESHOLD) {
            // Snap to end + lock + fire callback. The screen owning the
            // slider unmounts/resets it via key after handling activation.
            Animated.timing(translateX, {
              toValue: maxTranslate,
              duration: 120,
              useNativeDriver: false,
            }).start(() => {
              setActivated(true);
              onActivate();
            });
          } else {
            // Bounce back to start. The spring is intentional — gives the
            // user tactile feedback that the action was not committed.
            Animated.spring(translateX, {
              toValue: 0,
              useNativeDriver: false,
              friction: 7,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.timing(translateX, {
            toValue: 0,
            duration: 120,
            useNativeDriver: false,
          }).start();
        },
      }),
    [disabled, activated, maxTranslate, onActivate, translateX],
  );

  const handleLayout = (e: LayoutChangeEvent): void => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  // Fade label out as the knob travels — visual progress hint.
  const labelOpacity = translateX.interpolate({
    inputRange: [0, Math.max(1, maxTranslate * 0.7)],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View
      onLayout={handleLayout}
      style={[styles.track, disabled ? styles.trackDisabled : null]}
      testID={testID}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityHint="Arraste para a direita ate o final para ativar"
      accessibilityState={{ disabled }}
    >
      <Animated.Text
        style={[styles.label, { opacity: labelOpacity }]}
        numberOfLines={1}
      >
        {label}
      </Animated.Text>
      <Animated.View
        // eslint-disable-next-line react/jsx-props-no-spreading
        {...panResponder.panHandlers}
        style={[
          styles.knob,
          {
            transform: [{ translateX }],
            opacity: disabled ? 0.4 : 1,
          },
        ]}
        testID={testID ? `${testID}-knob` : undefined}
      >
        <Text style={styles.knobArrow}>›››</Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    height: KNOB_SIZE + spacing.sm * 2,
    borderRadius: radius.pill,
    backgroundColor: '#2A1010', // tom muito escuro de vermelho — sinaliza acao destrutiva sem ofuscar
    borderWidth: 2,
    borderColor: colors.danger,
    padding: spacing.sm,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  trackDisabled: {
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceMuted,
  },
  label: {
    position: 'absolute',
    alignSelf: 'center',
    color: colors.textPrimary,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  knob: {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knobArrow: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -1,
  },
});
