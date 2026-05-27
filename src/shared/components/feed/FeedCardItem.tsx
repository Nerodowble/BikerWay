import React, { useCallback, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { colors, radius, spacing, typography } from '@/shared/theme';
import type { FeedCard } from '@/domains/feed/types';
import { getRouteThemeMeta } from '@/domains/catalog/theme';

/**
 * F35.5 V2 — Card vertical alto com:
 *   - Hero header colorido (kind accent) + emoji + eyebrow
 *   - Headline display grande
 *   - Estado/regiao
 *   - Stats grid (3 celulas: km daqui, duracao, ped/round-trip)
 *   - Chips (tema, dificuldade, curvas)
 *   - Linha de motivo (reason)
 *   - CTA grande full-width
 *
 * Renderizado num carrossel horizontal (FlatList horizontal) na
 * `FeedCardList` abaixo. Cada card ocupa ~88% da largura — o peek
 * lateral revela parcialmente o proximo card pra comunicar
 * "tem mais pra ver".
 */

const KIND_ACCENTS: Record<
  FeedCard['kind'],
  { hero: string; chipBg: string; ctaBg: string; ctaFg: string }
> = {
  opportunity: {
    hero: colors.success,
    chipBg: 'rgba(63,191,111,0.18)',
    ctaBg: colors.success,
    ctaFg: '#000',
  },
  discovery: {
    hero: colors.accent,
    chipBg: 'rgba(255,107,0,0.18)',
    ctaBg: colors.accent,
    ctaFg: '#000',
  },
  seasonal: {
    hero: '#5BD5FF',
    chipBg: 'rgba(91,213,255,0.18)',
    ctaBg: '#5BD5FF',
    ctaFg: '#000',
  },
  caution: {
    hero: colors.warning,
    chipBg: 'rgba(255,204,0,0.18)',
    ctaBg: colors.warning,
    ctaFg: '#000',
  },
};

const KIND_CTAS: Record<FeedCard['kind'], string> = {
  opportunity: 'VER ROTEIRO',
  discovery: 'DESCOBRIR',
  seasonal: 'PLANEJAR',
  caution: 'VER ALTERNATIVAS',
};

const DIFICULDADE_LABEL: Record<NonNullable<FeedCard['dificuldade']>, string> = {
  iniciante: 'INICIANTE',
  intermediario: 'INTERMEDIÁRIO',
  avancado: 'AVANÇADO',
};

const CURVAS_LABEL: Record<FeedCard['nivelCurvas'], string> = {
  baixo: 'CURVAS BAIXAS',
  medio: 'CURVAS MÉDIAS',
  alto: 'CURVAS ALTAS',
};

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function formatReais(value: number): string {
  if (value <= 0) return 'sem pedágio';
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}

interface FeedCardItemProps {
  card: FeedCard;
  width: number;
  onPress: (rotaId: string) => void;
}

export const FeedCardItem: React.FC<FeedCardItemProps> = ({
  card,
  width,
  onPress,
}) => {
  const accent = KIND_ACCENTS[card.kind];
  const themeMeta = getRouteThemeMeta(card.themeRoute);
  return (
    <Pressable
      onPress={() => onPress(card.rotaId)}
      accessibilityRole="button"
      accessibilityLabel={`${card.eyebrow}: ${card.headline}, ${KIND_CTAS[card.kind]}`}
      style={({ pressed }) => [
        styles.card,
        { width },
        pressed ? styles.cardPressed : null,
      ]}
      testID={`feed-card-${card.id}`}
    >
      {/* Hero header — barra colorida com eyebrow + emoji */}
      <View style={[styles.hero, { backgroundColor: accent.hero }]}>
        <Text style={styles.heroIcon}>{card.icon}</Text>
        <Text style={styles.heroEyebrow} numberOfLines={1}>
          {card.eyebrow}
        </Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.headline} numberOfLines={3}>
          {card.headline}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {card.routeName} · {card.estadoPais}
        </Text>

        {/* Stats grid */}
        <View style={styles.statsRow}>
          <StatCell label="DAQUI" value={`${Math.round(card.distanceKmFromUser)} km`} />
          <StatCell
            label="VIAGEM"
            value={formatDuration(card.estimatedDurationMinutes)}
          />
          <StatCell label="PEDÁGIO" value={formatReais(card.tollRoundTripReais)} />
        </View>

        {/* Chips */}
        <View style={styles.chipsRow}>
          <Chip
            label={themeMeta.label}
            bg={themeMeta.bg}
            fg={themeMeta.fg}
          />
          {card.dificuldade !== undefined ? (
            <Chip
              label={DIFICULDADE_LABEL[card.dificuldade]}
              bg={accent.chipBg}
              fg={colors.textPrimary}
            />
          ) : null}
          <Chip
            label={CURVAS_LABEL[card.nivelCurvas]}
            bg={accent.chipBg}
            fg={colors.textPrimary}
          />
        </View>

        {/* Reason */}
        {card.reason.length > 0 ? (
          <Text style={[styles.reason, { color: accent.hero }]} numberOfLines={2}>
            ✨ {card.reason}
          </Text>
        ) : null}

        {/* CTA */}
        <View
          style={[styles.cta, { backgroundColor: accent.ctaBg }]}
          pointerEvents="none"
        >
          <Text style={[styles.ctaLabel, { color: accent.ctaFg }]}>
            {KIND_CTAS[card.kind]} →
          </Text>
        </View>
      </View>
    </Pressable>
  );
};

const StatCell: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <View style={styles.statCell}>
    <Text style={styles.statValue} numberOfLines={1}>
      {value}
    </Text>
    <Text style={styles.statLabel} numberOfLines={1}>
      {label}
    </Text>
  </View>
);

const Chip: React.FC<{ label: string; bg: string; fg: string }> = ({
  label,
  bg,
  fg,
}) => (
  <View style={[styles.chip, { backgroundColor: bg }]}>
    <Text style={[styles.chipText, { color: fg }]} numberOfLines={1}>
      {label}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  cardPressed: {
    opacity: 0.9,
  },
  hero: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroIcon: {
    fontSize: 22,
  },
  heroEyebrow: {
    color: '#000',
    fontSize: typography.eyebrow.fontSize,
    fontWeight: '800',
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    flex: 1,
  },
  body: {
    padding: spacing.lg,
  },
  headline: {
    color: colors.textPrimary,
    fontSize: typography.display.fontSize,
    fontWeight: typography.display.fontWeight,
    lineHeight: typography.display.lineHeight,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: typography.navSecondary.fontWeight,
    lineHeight: typography.navSecondary.lineHeight,
    marginTop: spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  statCell: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '800',
    lineHeight: typography.navSecondary.lineHeight,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  chipText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  reason: {
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: spacing.md,
  },
  cta: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  ctaLabel: {
    fontSize: typography.navSecondary.fontSize,
    fontWeight: '800',
    letterSpacing: 1,
  },
});

// ---------------------------------------------------------------------------
// Carrossel horizontal — FlatList com snap. Cada card ocupa ~88% da largura
// pra deixar ~12% do proximo "peeking" como dica visual de scroll.
// ---------------------------------------------------------------------------

const HORIZONTAL_PADDING = spacing.lg;
const CARD_GAP = spacing.md;
const PEEK = spacing.lg;

interface FeedCardListProps {
  cards: ReadonlyArray<FeedCard>;
  onCardPress: (rotaId: string) => void;
}

export const FeedCardList: React.FC<FeedCardListProps> = ({
  cards,
  onCardPress,
}) => {
  const [containerWidth, setContainerWidth] = useState<number>(
    Dimensions.get('window').width,
  );
  const flatListRef = useRef<FlatList<FeedCard>>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const cardWidth = Math.max(
    240,
    containerWidth - HORIZONTAL_PADDING * 2 - PEEK,
  );
  const snapInterval = cardWidth + CARD_GAP;

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = e.nativeEvent.contentOffset.x;
      const idx = Math.round(offsetX / snapInterval);
      if (idx !== activeIndex) setActiveIndex(idx);
    },
    [activeIndex, snapInterval],
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedCard }): React.ReactElement => (
      <View style={{ width: cardWidth, marginRight: CARD_GAP }}>
        <FeedCardItem card={item} width={cardWidth} onPress={onCardPress} />
      </View>
    ),
    [cardWidth, onCardPress],
  );

  if (cards.length === 0) return null;

  return (
    <View
      style={listStyles.wrap}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      testID="feed-cards"
    >
      <Text style={listStyles.sectionTitle}>FIM DE SEMANA PERFEITO</Text>
      <FlatList
        ref={flatListRef}
        data={cards as FeedCard[]}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={snapInterval}
        decelerationRate="fast"
        contentContainerStyle={{
          paddingHorizontal: HORIZONTAL_PADDING,
        }}
        onScroll={onScroll}
        scrollEventThrottle={16}
      />
      {cards.length > 1 ? (
        <View style={listStyles.dotsRow}>
          {cards.map((c, idx) => (
            <View
              key={c.id}
              style={[
                listStyles.dot,
                idx === activeIndex ? listStyles.dotActive : null,
              ]}
            />
          ))}
        </View>
      ) : null}
      <Text style={listStyles.divider}>TODAS AS ROTAS</Text>
    </View>
  );
};

const listStyles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    marginBottom: spacing.md,
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.borderSubtle,
  },
  dotActive: {
    backgroundColor: colors.accent,
    width: 18,
  },
  divider: {
    color: colors.textMuted,
    fontSize: typography.eyebrow.fontSize,
    fontWeight: typography.eyebrow.fontWeight,
    letterSpacing: typography.eyebrow.letterSpacing,
    lineHeight: typography.eyebrow.lineHeight,
    textTransform: typography.eyebrow.textTransform,
    marginTop: spacing.lg,
    paddingHorizontal: HORIZONTAL_PADDING,
  },
});
