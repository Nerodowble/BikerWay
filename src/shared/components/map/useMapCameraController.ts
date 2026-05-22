import { useEffect, useRef } from 'react';
import type MapView from 'react-native-maps';
import type { GeoPosition } from '@/domains/navigation/types';
import { haversineMeters } from '@/shared/utils/haversine';
import { CAMERA_CONFIG, type CameraMode } from './cameraConfig';

export interface UseMapCameraControllerInput {
  mapRef: React.RefObject<MapView | null>;
  mode: CameraMode;
  userPosition: GeoPosition | null;
  enabled?: boolean;
}

const METERS_PER_DEGREE_LAT = 111_320;

/**
 * Returns the absolute shortest-angle difference between two compass headings
 * expressed in degrees. The result is always in the range [0, 180].
 */
function shortestHeadingDelta(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

/**
 * Shifts a center coordinate forward along a heading by `offsetMeters`.
 * Heading is in degrees clockwise from north (0 = north, 90 = east).
 */
function offsetCenterForward(
  latitude: number,
  longitude: number,
  headingDegrees: number,
  offsetMeters: number,
): { latitude: number; longitude: number } {
  const headingRad = (headingDegrees * Math.PI) / 180;
  const dLat = (offsetMeters * Math.cos(headingRad)) / METERS_PER_DEGREE_LAT;
  // Guard against `cos(latitude)` collapsing toward zero at the poles. Outside
  // of that edge case this is simply `meters -> degrees` conversion.
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  const safeCosLat = Math.abs(cosLat) < 1e-6 ? 1e-6 : cosLat;
  const dLng =
    (offsetMeters * Math.sin(headingRad)) /
    (METERS_PER_DEGREE_LAT * safeCosLat);
  return { latitude: latitude + dLat, longitude: longitude + dLng };
}

/**
 * Drives a react-native-maps `MapView` camera so it behaves like a Waze-style
 * navigation camera in `navigating` mode and a calm top-down view in `idle`
 * mode.
 *
 * The hook is safe to call when `userPosition` is null: it will simply wait
 * for the first GPS fix and animate at that point. Throttle / movement gates
 * are skipped on the very first fix so the map snaps to the rider immediately.
 */
export function useMapCameraController(
  input: UseMapCameraControllerInput,
): void {
  const { mapRef, mode, userPosition, enabled = true } = input;

  const lastAnimateAtRef = useRef<number>(0);
  const lastPositionRef = useRef<GeoPosition | null>(null);
  const lastHeadingRef = useRef<number>(0);
  const hasCenteredOnFirstFixRef = useRef<boolean>(false);
  const lastModeRef = useRef<CameraMode>(mode);

  // Re-animate on user position changes (and when mode flips).
  useEffect(() => {
    if (!enabled || !userPosition || !mapRef.current) {
      return;
    }

    const cfg = CAMERA_CONFIG[mode];
    const map = mapRef.current;

    const desiredHeading = cfg.headingFollowsUser
      ? userPosition.heading ?? lastHeadingRef.current
      : 0;

    const animate = (now: number): void => {
      let centerLat = userPosition.latitude;
      let centerLng = userPosition.longitude;

      if (mode === 'navigating') {
        const shifted = offsetCenterForward(
          centerLat,
          centerLng,
          desiredHeading,
          CAMERA_CONFIG.navigating.centerForwardOffsetMeters,
        );
        centerLat = shifted.latitude;
        centerLng = shifted.longitude;
      }

      map.animateCamera(
        {
          center: { latitude: centerLat, longitude: centerLng },
          zoom: cfg.zoom,
          pitch: cfg.pitch,
          heading: desiredHeading,
        },
        { duration: CAMERA_CONFIG.animation.durationMs },
      );

      lastAnimateAtRef.current = now;
      lastPositionRef.current = userPosition;
      lastHeadingRef.current = desiredHeading;
    };

    const now = Date.now();

    // First-fix: always animate, bypassing throttle and delta gates.
    if (!hasCenteredOnFirstFixRef.current) {
      hasCenteredOnFirstFixRef.current = true;
      animate(now);
      return;
    }

    // Time-based throttle.
    if (now - lastAnimateAtRef.current < CAMERA_CONFIG.animation.minIntervalMs) {
      return;
    }

    const prev = lastPositionRef.current;
    const distance = prev ? haversineMeters(prev, userPosition) : Infinity;
    const headingDelta = shortestHeadingDelta(
      desiredHeading,
      lastHeadingRef.current,
    );

    if (mode === 'navigating') {
      const belowDistance = distance < CAMERA_CONFIG.animation.minDeltaMeters;
      const belowHeading =
        headingDelta < CAMERA_CONFIG.animation.minHeadingDeltaDegrees;
      // Both gates must be below threshold to skip — any meaningful change in
      // either dimension still warrants an animation.
      if (belowDistance && belowHeading) {
        return;
      }
    } else {
      // Idle mode is less aggressive: only re-center on substantial movement.
      const idleThreshold = CAMERA_CONFIG.animation.minDeltaMeters * 4;
      if (distance < idleThreshold) {
        return;
      }
    }

    animate(now);
  }, [mapRef, mode, userPosition, enabled]);

  // When mode changes, force an animation to the current position with the
  // new mode's params so the user sees an immediate camera response (e.g. the
  // pitch/zoom transition when entering navigation).
  useEffect(() => {
    if (lastModeRef.current === mode) {
      return;
    }
    lastModeRef.current = mode;

    if (!enabled || !userPosition || !mapRef.current) {
      return;
    }

    const cfg = CAMERA_CONFIG[mode];
    const map = mapRef.current;

    const desiredHeading = cfg.headingFollowsUser
      ? userPosition.heading ?? lastHeadingRef.current
      : 0;

    let centerLat = userPosition.latitude;
    let centerLng = userPosition.longitude;

    if (mode === 'navigating') {
      const shifted = offsetCenterForward(
        centerLat,
        centerLng,
        desiredHeading,
        CAMERA_CONFIG.navigating.centerForwardOffsetMeters,
      );
      centerLat = shifted.latitude;
      centerLng = shifted.longitude;
    }

    map.animateCamera(
      {
        center: { latitude: centerLat, longitude: centerLng },
        zoom: cfg.zoom,
        pitch: cfg.pitch,
        heading: desiredHeading,
      },
      { duration: CAMERA_CONFIG.animation.durationMs },
    );

    lastAnimateAtRef.current = Date.now();
    lastPositionRef.current = userPosition;
    lastHeadingRef.current = desiredHeading;
  }, [mapRef, mode, userPosition, enabled]);
}
