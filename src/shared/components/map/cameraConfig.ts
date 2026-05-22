/**
 * Camera configuration for the BikerWay map.
 *
 * Two modes:
 *   - `idle`: top-down overview camera. Used on home/exploration screens.
 *     Pitch is 0 and heading stays at north so the rider can read the map
 *     like a paper map.
 *   - `navigating`: Waze-style 3D follow camera. The map is pitched, zoomed
 *     in tight, and rotated so the user's heading always points "up". The
 *     center is shifted forward along the heading so the rider sees more of
 *     the road ahead than behind.
 *
 * Animation gates exist to prevent jitter: the camera should not be animated
 * faster than once per `minIntervalMs`, nor for sub-meter GPS noise.
 */

export const CAMERA_CONFIG = {
  idle: {
    zoom: 14,
    pitch: 0,
    headingFollowsUser: false,
  },
  navigating: {
    zoom: 17.5,
    pitch: 45,
    headingFollowsUser: true,
    // The map center is offset toward the bottom so the user marker sits ~30%
    // from the bottom edge and ~70% of the route ahead is visible. Implement
    // this by shifting the center latitude slightly forward along heading.
    centerForwardOffsetMeters: 80,
  },
  animation: {
    durationMs: 600,
    minIntervalMs: 800,        // throttle: do not animate more than once per 800ms
    minDeltaMeters: 5,         // skip if user moved <5m
    minHeadingDeltaDegrees: 5, // skip if heading changed <5 degrees
  },
} as const;

export type CameraMode = 'idle' | 'navigating';
