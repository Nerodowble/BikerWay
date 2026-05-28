import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type MapView from 'react-native-maps';
import {
  colorForParticipant,
  initialForParticipant,
} from '@/domains/voice/participantColor';
import type { ComboioPeerPosition } from '@/state/voiceGroupStore';

export interface PeerLabelsOverlayProps {
  /** Ref to the underlying MapView so we can call pointForCoordinate. */
  mapRef: React.RefObject<MapView | null>;
  peerMembers: ComboioPeerPosition[];
  /** Tick this number whenever the map region changes (pan/zoom) so we re-project. */
  regionTick: number;
  /** F34.2 — Peer id do admin do comboio (renderiza coroa 👑 acima do pin).
   *  V1 e local-only: so populated quando o LOCAL e admin (eu nao apareço
   *  nessa lista, mas peers remotos vao ser admins em sessoes futuras
   *  quando F34.2.1 propagar via wire). */
  adminPeerId?: string | null;
  /** F34.2 — Peer id do sucessor escolhido pelo admin (renderiza estrela
   *  ⭐ acima do pin). */
  successorPeerId?: string | null;
}

interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Renders peer-name labels as plain React Native Views layered ABOVE the
 * MapView in screen space. We project each peer's lat/lng to a pixel
 * coordinate with `mapRef.pointForCoordinate()` and absolutely-position the
 * label there.
 *
 * Why this exists instead of putting the label inside the Marker child:
 *   - react-native-maps on Android takes a single bitmap snapshot per
 *     custom-view Marker and clips it aggressively (text gets cut off, the
 *     "Honda " / "Yama" symptom the rider kept seeing).
 *   - Drawing the label OUTSIDE the marker, in normal RN UI, sidesteps the
 *     snapshot entirely. Text renders crisp at full width forever.
 *
 * The label is updated on every render (peerMembers change) and whenever
 * the parent bumps `regionTick` (map pan/zoom). pointForCoordinate is
 * cheap; calling it for ~6 peers a couple of times per pan is negligible.
 */
export const PeerLabelsOverlay: React.FC<PeerLabelsOverlayProps> = ({
  mapRef,
  peerMembers,
  regionTick,
  adminPeerId = null,
  successorPeerId = null,
}) => {
  const [points, setPoints] = useState<Record<string, ScreenPoint>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reproject = useCallback(async () => {
    const map = mapRef.current;
    if (!map || peerMembers.length === 0) {
      if (Object.keys(points).length > 0) setPoints({});
      return;
    }
    const next: Record<string, ScreenPoint> = {};
    for (const peer of peerMembers) {
      try {
        const pt = await map.pointForCoordinate({
          latitude: peer.latitude,
          longitude: peer.longitude,
        });
        if (
          pt &&
          typeof pt.x === 'number' &&
          typeof pt.y === 'number' &&
          Number.isFinite(pt.x) &&
          Number.isFinite(pt.y)
        ) {
          next[peer.id] = { x: pt.x, y: pt.y };
        }
      } catch {
        // pointForCoordinate can throw before the map is fully laid out
        // (very first frame). Skipping silently is fine; the next tick
        // will retry.
      }
    }
    if (mountedRef.current) {
      setPoints(next);
    }
    // We intentionally exclude `points` from the dependency array — including
    // it would create a setState loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, peerMembers]);

  useEffect(() => {
    void reproject();
  }, [reproject, regionTick]);

  if (peerMembers.length === 0) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {peerMembers.map((peer) => {
        const pt = points[peer.id];
        if (!pt) return null;
        const labelText =
          (peer.displayName ?? '').trim().length > 0
            ? peer.displayName
            : 'Piloto';
        const bg = colorForParticipant(peer.id);
        const initial = initialForParticipant(peer.displayName);
        const isAdmin = adminPeerId !== null && peer.id === adminPeerId;
        const isSuccessor =
          successorPeerId !== null && peer.id === successorPeerId;
        return (
          <View
            key={peer.id}
            style={[
              styles.labelWrap,
              {
                left: pt.x - 100,
                top: pt.y + 18, // 18dp below the disc anchor
              },
            ]}
          >
            {/* F34.2 — Coroa 👑 acima do pin do admin; ⭐ acima do pin do
                sucessor. Apenas um dos dois renderiza (admin tem
                prioridade visual se algum dia o ID coincidir). */}
            {isAdmin || isSuccessor ? (
              <View style={styles.adminBadge}>
                <Text style={styles.adminBadgeEmoji} allowFontScaling={false}>
                  {isAdmin ? '👑' : '⭐'}
                </Text>
              </View>
            ) : null}
            {/* F34.1 — Pill com badge da inicial + nome. */}
            <View style={[styles.pill, { backgroundColor: bg }]}>
              <View style={styles.initialBadge}>
                <Text
                  style={styles.initialText}
                  allowFontScaling={false}
                >
                  {initial}
                </Text>
              </View>
              <Text
                style={styles.pillText}
                numberOfLines={1}
                allowFontScaling={false}
              >
                {labelText}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  labelWrap: {
    position: 'absolute',
    width: 200,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  initialBadge: {
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 14,
  },
  pillText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  adminBadge: {
    alignSelf: 'center',
    marginBottom: 2,
  },
  adminBadgeEmoji: {
    fontSize: 18,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
