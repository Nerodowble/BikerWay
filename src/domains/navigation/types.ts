export interface GeoPosition {
  latitude: number;
  longitude: number;
  altitude?: number | null;
  accuracy?: number | null;
  speed?: number | null;   // meters/second
  heading?: number | null;
  timestamp: number;       // epoch ms
}

export interface NavigationState {
  currentPosition: GeoPosition | null;
  destination: GeoPosition | null;
  isNavigating: boolean;
  distanceTraveledKm: number;
  isReserveMode: boolean;
}

export interface RouteSettings {
  type: 'express' | 'scenic';
  allowUnpaved: boolean;
}
