export type LocationPermissionStatus = 'undetermined' | 'denied' | 'granted' | 'restricted';

export interface LocationState {
  permission: LocationPermissionStatus;
  isWatching: boolean;
  lastError: string | null;
}
