import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { colors } from '@/shared/theme';

export interface SOSAlertMarkerProps {
  latitude: number;
  longitude: number;
}

// Dimensoes calibradas pra ficar visualmente distinto do DestinationMarker
// (28dp) sem ultrapassar a janela segura do bitmap snapshot Android. Tentativa
// anterior a 38dp ainda recortava nas pontinhas em alguns devices — reduzido
// pra 32dp (4dp acima do DestinationMarker, ~14% maior) que fica
// confortavelmente abaixo do threshold do gotcha de 32-40dp.
const CIRCLE_SIZE = 32;
const BORDER_WIDTH = 2;
const TRIANGLE_WIDTH = 7;
const TRIANGLE_HEIGHT = 9;

/**
 * F29.3 — Marcador SOS no mapa.
 *
 * Substitui o `DestinationMarker` regular quando o destino atual e um
 * SOS aceito. Visualmente mais forte que o pin classico (circulo maior
 * com borda branca grossa + "!" em alto contraste + ponteiro abaixo)
 * pra comunicar URGENCIA ao piloto.
 *
 * Por que nao um retangulo arredondado (pilula horizontal):
 *  - Tentativa anterior (60-80dp wide pill com texto "SOS") foi cortada
 *    no Android — exatamente o caso descrito em
 *    gotcha-rn-maps-marker-clipping: shapes maiores que ~32dp tendem a
 *    clipar mesmo com padding transparente generoso.
 *  - O Android snapshota a View custom em um bitmap antes de paintar
 *    no mapa, e o tamanho default do bitmap nao cresce com a largura
 *    do shape. Resultado: o lado direito da pilula vira invisivel.
 *  - Mantemos a forma circular (~38dp diametro) que sabidamente
 *    funciona — mesma estrutura do DestinationMarker, escalada um pouco
 *    mais e com decoracao de "!" no centro.
 *
 * Render-safe checklist (per gotcha-rn-maps-marker-clipping):
 *  - tracksViewChanges PERMANENTE true.
 *  - Estrutura plana: pinContainer SEM borderRadius envolve um circulo
 *    COM borderRadius + um triangulo IRMAO (nao filho do circulo). Mesmo
 *    padrao do DestinationMarker que esta em producao ha meses.
 *  - Texto ASCII puro ("!") — char unico, sem unicode/glyph que possa
 *    bagunçar o bounding box.
 *  - Diametro 38dp do shape interno (~44dp com border) — folga sobre o
 *    threshold de 32dp do gotcha mas dentro da janela que o
 *    DestinationMarker (28dp) ja prova ser segura.
 */
export const SOSAlertMarker: React.FC<SOSAlertMarkerProps> = ({
  latitude,
  longitude,
}) => {
  return (
    <Marker
      coordinate={{ latitude, longitude }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges
      zIndex={9999}
    >
      <View style={styles.pinContainer}>
        <View style={styles.circle}>
          <Text style={styles.exclamation} allowFontScaling={false}>
            !
          </Text>
        </View>
        <View style={styles.triangle} />
      </View>
    </Marker>
  );
};

const styles = StyleSheet.create({
  pinContainer: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: colors.danger,
    borderWidth: BORDER_WIDTH,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exclamation: {
    color: '#FFFFFF',
    fontWeight: '900',
    // Tamanho do "!" calibrado pro circulo de 32dp. fontSize 18 com
    // lineHeight 20 mantem o glyph centrado verticalmente sem baseline
    // descer pra fora do snapshot.
    fontSize: 18,
    lineHeight: 20,
    includeFontPadding: false,
    textAlign: 'center',
  },
  triangle: {
    width: 0,
    height: 0,
    borderLeftWidth: TRIANGLE_WIDTH,
    borderRightWidth: TRIANGLE_WIDTH,
    borderTopWidth: TRIANGLE_HEIGHT,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: colors.danger,
    marginTop: -1,
  },
});
