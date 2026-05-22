import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';
import type { GeoPosition } from '@/domains/navigation/types';
import { colors } from '@/shared/theme';

export interface MotorcycleMarkerProps {
  position: GeoPosition;
  accent?: string;
  sizeDp?: number;
}

/**
 * Minimal current-position marker — used to verify base rendering works.
 * Once a plain disc renders end-to-end, we layer the chevron back on top.
 */
export const MotorcycleMarker: React.FC<MotorcycleMarkerProps> = ({
  position,
  accent,
  sizeDp = 28,
}) => {
  const fillColor = accent ?? colors.accent;

  return (
    <Marker
      coordinate={{
        latitude: position.latitude,
        longitude: position.longitude,
      }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges
      zIndex={1000}
    >
      <View style={styles.padding}>
        <View
          style={[
            styles.disc,
            {
              width: sizeDp,
              height: sizeDp,
              borderRadius: sizeDp / 2,
              backgroundColor: fillColor,
            },
          ]}
        />
      </View>
    </Marker>
  );
};

const styles = StyleSheet.create({
  padding: {
    padding: 8,
    backgroundColor: 'transparent',
  },
  disc: {
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
});
