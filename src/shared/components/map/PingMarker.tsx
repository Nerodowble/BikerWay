import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { Marker } from 'react-native-maps';
import type { ComboioPing } from '@/domains/comboio/ping';

/**
 * F34.5 — Ping pulsante minimo, estilo "MotorcycleMarker animado".
 *
 * Decisões anti-clipping (per `gotcha_rn_maps_marker_clipping`):
 *   - **Sem halo separado** com `position:absolute`. As tentativas
 *     anteriores quebravam o flex-center do disc principal, fazendo o
 *     core renderizar deslocado e o Android cortar metade do circulo.
 *   - **Pulse via OPACITY apenas**, nao via scale. Opacity nao muda as
 *     dimensoes do bitmap snapshot, entao o Android consegue renderizar
 *     tudo sem clipping. Visualmente fica claro que e "alerta piscando".
 *   - **Inicial dentro** numa fonte pequena (10px). E o unico Text dentro
 *     do Marker — mantemos curto pra reduzir risco de clipping textual.
 *   - **Padding generoso** (16dp) ao redor do disc pra dar margem ao
 *     snapshot do Android.
 */
const SIZE = 22;

export const PingMarker: React.FC<{ ping: ComboioPing }> = ({ ping }) => {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 600,
          useNativeDriver: false,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: false,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Marker
      coordinate={{
        latitude: ping.latitude,
        longitude: ping.longitude,
      }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges
      zIndex={900}
    >
      <Animated.View style={[styles.padding, { opacity }]}>
        <Animated.View style={styles.disc}>
          <Text style={styles.coreText} allowFontScaling={false}>
            {ping.initial}
          </Text>
        </Animated.View>
      </Animated.View>
    </Marker>
  );
};

const styles = StyleSheet.create({
  padding: {
    // Padding asymmetric: bottom maior pra que (1) o disc aparece mais
    // alto em relacao ao ponto geografico (parece um pin "olhando pra
    // baixo") + (2) o snapshot do Android tem mais margem na borda
    // inferior, que era onde tava clipando.
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 24,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: '#FF6B00',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coreText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 12,
  },
});
