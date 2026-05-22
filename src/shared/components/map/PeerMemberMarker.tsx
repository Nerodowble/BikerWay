import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { colorForParticipant } from '@/domains/voice/participantColor';
import type { ComboioPeerPosition } from '@/state/voiceGroupStore';

export interface PeerMemberMarkerProps {
  position: ComboioPeerPosition;
}

/**
 * Renders ONLY the coloured anchor disc for a peer on the map. The label
 * with the rider's name is drawn separately by `PeerLabelsOverlay` as a
 * pure React Native View positioned via `mapRef.pointForCoordinate()`.
 *
 * Why split this way: react-native-maps on Android takes a single bitmap
 * snapshot per Marker and clips it aggressively whenever the snapshot
 * contains text or borderRadius. Keeping the disc free of any Text child
 * sidesteps the clipping entirely, and the overlay approach for the label
 * means the text lives in normal RN UI - no snapshot, no clipping.
 */
export const PeerMemberMarker: React.FC<PeerMemberMarkerProps> = ({
  position,
}) => {
  const tagColor = colorForParticipant(position.id);
  return (
    <Marker
      coordinate={{
        latitude: position.latitude,
        longitude: position.longitude,
      }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges
      zIndex={700}
    >
      <View style={styles.padding} testID={`peer-marker-${position.id}`}>
        <View style={[styles.disc, { backgroundColor: tagColor }]} />
      </View>
    </Marker>
  );
};

const styles = StyleSheet.create({
  padding: {
    padding: 10,
    backgroundColor: 'transparent',
  },
  disc: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
});
