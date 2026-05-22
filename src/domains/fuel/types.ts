export interface FuelSnapshot {
  maxAutonomyKm: number;       // A_max
  safeAutonomyKm: number;      // A_seg = A_max * (1 - SAFETY_MARGIN)
  distanceTraveledKm: number;  // since last "tanque cheio"
  remainingAutonomyKm: number; // A_rest = max(0, A_seg - distanceTraveled)
  isReserveMode: boolean;      // remainingAutonomyKm <= RESERVE_THRESHOLD_KM
}
