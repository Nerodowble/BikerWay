import { initDatabase } from '../infrastructure/db/sqlite';
import { useMotorcycleStore } from './motorcycleStore';
import { useNavigationStore } from './navigationStore';
import { useRiderStore } from './riderStore';
import { useSOSStore } from './sosStore';

export interface BootstrapResult {
  success: boolean;
  error?: string;
}

export async function bootstrapApp(): Promise<BootstrapResult> {
  let initError: Error | null = null;
  try {
    await initDatabase();
  } catch (err) {
    initError = err instanceof Error ? err : new Error('Database init failed');
  }
  // hydrate has its own try/catch and always sets isHydrated=true (via finally)
  await useMotorcycleStore.getState().hydrate();
  // Best-effort rider profile load. We never block bootstrap on a missing
  // profile — first-run users will simply see `profile: null` and can fill
  // in the form whenever they visit RiderProfileScreen.
  await useRiderStore.getState().loadProfile();
  // Restore persisted trip odometer state (RF03). Best-effort: never block
  // bootstrap on failure — surface as routeError if applicable.
  try {
    await useNavigationStore.getState().hydrateTripState();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Trip state hydration failed';
    useNavigationStore.getState().setRouteError(message);
  }
  // F29.4: carrega historico de cancels do SOS pra alimentar o anti-abuso.
  // Best-effort: se SQLite falhar a UI assume sem historico (recentCancels=[]).
  await useSOSStore.getState().hydrateAbuseHistory();
  if (initError) {
    return { success: false, error: initError.message };
  }
  return { success: true };
}
