import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, hitTarget, radius, spacing, typography } from '@/shared/theme';
import { calculateHaversineDistance } from '@/domains/catalog/haversine';
import type {
  CatalogPontoApoio,
  PedagioPraca,
} from '@/domains/catalog/types';

function formatReais(value: number): string {
  const safe = Number.isFinite(value) && value >= 0 ? value : 0;
  return `R$ ${safe.toFixed(2).replace('.', ',')}`;
}

/**
 * Sub-components extracted from `RouteDetailScreen.tsx` so the screen file
 * stays under its 500-line target. These pieces never render outside the
 * detail screen, hence they live in a sibling folder instead of
 * `shared/components`.
 */

function formatKm(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? value : 0;
  return `${Math.round(safe)} km`;
}

/**
 * Labelled stat tile used in the "Números da viagem" grid.
 */
export const StatCell: React.FC<{
  label: string;
  value: string;
  testID?: string;
}> = ({ label, value, testID }) => (
  <View
    style={statCellStyles.cell}
    testID={testID}
    accessibilityRole="text"
    accessibilityLabel={`${label} ${value}`}
  >
    <Text style={statCellStyles.label}>{label}</Text>
    <Text style={statCellStyles.value}>{value}</Text>
  </View>
);

/**
 * Section wrapper with an eyebrow label header. Each section is a landmark
 * for screen readers so the rider can jump between blocks.
 */
export const Section: React.FC<{
  eyebrow: string;
  children: React.ReactNode;
  testID?: string;
}> = ({ eyebrow, children, testID }) => (
  <View style={sectionStyles.section} testID={testID}>
    <Text style={sectionStyles.eyebrow} accessibilityRole="header">
      {eyebrow}
    </Text>
    {children}
  </View>
);

/**
 * Visual translation table for the `tipo` field used by curated points of
 * support. The catalog schema does not enforce an enum (only validates that
 * the field is a non-empty string), so we fall back to a neutral treatment
 * for unknown types instead of crashing.
 */
function getPontoApoioStyle(tipo: string): {
  bg: string;
  fg: string;
  label: string;
} {
  const normalised = tipo.toLowerCase();
  if (normalised.includes('posto')) {
    return { bg: 'rgba(63,191,111,0.18)', fg: colors.success, label: 'POSTO' };
  }
  if (normalised.includes('mirante')) {
    return {
      bg: 'rgba(255,107,0,0.18)',
      fg: colors.accent,
      label: 'MIRANTE',
    };
  }
  if (normalised.includes('restaurante') || normalised.includes('lanchonete')) {
    return {
      bg: 'rgba(255,204,0,0.18)',
      fg: colors.warning,
      label: tipo.toUpperCase(),
    };
  }
  return {
    bg: colors.surfaceElevated,
    fg: colors.textSecondary,
    label: tipo.toUpperCase(),
  };
}

export const PontoApoioRow: React.FC<{
  ponto: CatalogPontoApoio;
  userLat: number | null;
  userLng: number | null;
  testID?: string;
}> = ({ ponto, userLat, userLng, testID }) => {
  const style = getPontoApoioStyle(ponto.tipo);
  const distanceLabel = useMemo(() => {
    if (userLat === null || userLng === null) return null;
    const km = calculateHaversineDistance(
      { latitude: userLat, longitude: userLng },
      { latitude: ponto.latitude, longitude: ponto.longitude },
    );
    if (km <= 0) return null;
    return `${formatKm(km)} de você`;
  }, [ponto.latitude, ponto.longitude, userLat, userLng]);

  return (
    <View style={pontoStyles.row} testID={testID}>
      <View style={[pontoStyles.typePill, { backgroundColor: style.bg }]}>
        <Text style={[pontoStyles.typePillText, { color: style.fg }]}>
          {style.label}
        </Text>
      </View>
      <Text style={pontoStyles.name}>{ponto.nome}</Text>
      {distanceLabel !== null ? (
        <Text style={pontoStyles.distance}>{distanceLabel}</Text>
      ) : null}
      <Text style={pontoStyles.description}>{ponto.descricao_biker}</Text>
    </View>
  );
};

/**
 * Per-plaza toll row used inside the "PEDÁGIOS DA ROTA" section.
 * Mirrors PontoApoioRow's visual rhythm (pill + name + meta + body)
 * so the detail screen reads consistently. `free_flow` plazas get a
 * cyan-ish pill because there's no physical cancela — handy hint for
 * the rider that they need to pay later via app/site of the
 * concessionária instead of at the booth.
 */
export const PedagioPracaRow: React.FC<{
  praca: PedagioPraca;
  onOpenSource: (url: string) => void;
  testID?: string;
}> = ({ praca, onOpenSource, testID }) => {
  const isFreeFlow = praca.sistema === 'free_flow';
  const pillBg = isFreeFlow ? 'rgba(0,194,255,0.16)' : 'rgba(255,107,0,0.18)';
  const pillFg = isFreeFlow ? '#5BD5FF' : colors.accent;
  const pillLabel = isFreeFlow ? 'FREE FLOW' : 'PRAÇA FÍSICA';
  const kmLabel =
    typeof praca.km === 'number' && praca.km > 0
      ? `km ${praca.km.toString().replace('.', ',')}`
      : null;

  return (
    <View style={pedagioStyles.row} testID={testID}>
      <View style={pedagioStyles.headerRow}>
        <View style={[pedagioStyles.typePill, { backgroundColor: pillBg }]}>
          <Text style={[pedagioStyles.typePillText, { color: pillFg }]}>
            {pillLabel}
          </Text>
        </View>
        <Text style={pedagioStyles.value} testID={`${testID ?? 'pedagio'}-value`}>
          {formatReais(praca.valor_moto_reais)}
        </Text>
      </View>
      <Text style={pedagioStyles.name}>{praca.nome}</Text>
      {kmLabel !== null || praca.concessionaria !== undefined ? (
        <Text style={pedagioStyles.meta}>
          {[kmLabel, praca.concessionaria].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
      {praca.fonte_url !== undefined ? (
        <Pressable
          onPress={() => onOpenSource(praca.fonte_url as string)}
          hitSlop={6}
          style={({ pressed }) => [
            pedagioStyles.sourceLink,
            pressed ? pedagioStyles.sourceLinkPressed : null,
          ]}
          accessibilityRole="link"
          accessibilityLabel={`Abrir tabela de pedágios da ${praca.concessionaria ?? 'concessionária'}`}
        >
          <Text style={pedagioStyles.sourceLinkText} numberOfLines={1}>
            Ver fonte
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

export const SourceLink: React.FC<{
  url: string;
  onPress: (url: string) => void;
  testID?: string;
}> = ({ url, onPress, testID }) => (
  <Pressable
    onPress={() => onPress(url)}
    hitSlop={8}
    style={({ pressed }) => [
      sourceStyles.item,
      pressed ? sourceStyles.itemPressed : null,
    ]}
    accessibilityRole="link"
    accessibilityLabel={`Abrir fonte ${url}`}
    testID={testID}
  >
    <Text style={sourceStyles.text} numberOfLines={2}>
      {url}
    </Text>
  </Pressable>
);

const statCellStyles = StyleSheet.create({
  cell: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  label: {
    color: colors.textMuted,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  value: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '800',
    lineHeight: typography.navSecondary.lineHeight,
    marginTop: 2,
  },
});

const sectionStyles = StyleSheet.create({
  section: {
    marginTop: spacing.lg,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    marginBottom: spacing.sm,
  },
});

const pontoStyles = StyleSheet.create({
  row: {
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
  },
  typePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  typePillText: {
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  name: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
    marginTop: spacing.xs,
  },
  distance: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    lineHeight: typography.caption.lineHeight,
    marginTop: 2,
  },
  description: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
});

const pedagioStyles = StyleSheet.create({
  row: {
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  typePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  typePillText: {
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
  },
  value: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '800',
    lineHeight: typography.navSecondary.lineHeight,
  },
  name: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: typography.navSecondary.lineHeight,
    marginTop: spacing.xs,
  },
  meta: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    lineHeight: typography.caption.lineHeight,
    marginTop: 2,
  },
  sourceLink: {
    marginTop: spacing.xs,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  sourceLinkPressed: {
    opacity: 0.6,
  },
  sourceLinkText: {
    color: colors.accent,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    lineHeight: typography.caption.lineHeight,
    textDecorationLine: 'underline',
  },
});

const sourceStyles = StyleSheet.create({
  item: {
    paddingVertical: spacing.sm,
    minHeight: hitTarget.min / 2,
    justifyContent: 'center',
  },
  itemPressed: {
    opacity: 0.6,
  },
  text: {
    color: colors.accent,
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    lineHeight: 18,
    textDecorationLine: 'underline',
  },
});
