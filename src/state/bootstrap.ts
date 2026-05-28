import { initDatabase } from '../infrastructure/db/sqlite';
import { getRideHistoryRepo } from '../infrastructure/db/rideHistoryRepository';
import { getOsrmCacheRepo } from '../infrastructure/db/osrmCacheRepository';
import { getPoiCacheRepo } from '../infrastructure/db/poiCacheRepository';
import { useComboioPreferencesStore } from './comboioPreferencesStore';
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
  // F36.1 — Restaura a rota ativa persistida. Permite ao piloto continuar
  // de onde parou se o app foi morto durante a navegacao. Best-effort.
  await useNavigationStore.getState().hydrateActiveRoute();
  // F29.4: carrega historico de cancels do SOS pra alimentar o anti-abuso.
  // Best-effort: se SQLite falhar a UI assume sem historico (recentCancels=[]).
  await useSOSStore.getState().hydrateAbuseHistory();

  // F35.2 rev — Limpa trips iniciados ha mais de 24h sem completar. Sem
  // isso, um trip que o piloto comecou e abandonou (fechou o app, esqueceu)
  // ficaria pra sempre pendente e tentaria ser retomado em sessoes futuras.
  // Best-effort: falha aqui nao impede o app de subir.
  try {
    const repo = await getRideHistoryRepo();
    await repo.cleanupAbandonedTrips();
  } catch {
    // best-effort
  }

  // F36.2 — Limpa cache OSRM antigo (TTL 7d + cap 200 entradas). Roda 1x
  // por boot pra manter o banco com tamanho previsivel.
  try {
    const osrmRepo = await getOsrmCacheRepo();
    await osrmRepo.cleanup();
  } catch {
    // best-effort
  }

  // F36.4 — Limpa cache POI antigo (TTL 30d + cap 100 entradas).
  try {
    const poiRepo = await getPoiCacheRepo();
    await poiRepo.cleanup();
  } catch {
    // best-effort
  }

  // F34.0 — Hidrata preferencias do comboio (6 toggles) ANTES de qualquer
  // tela montar. Default seguro embutido no store, entao falha aqui nao
  // bloqueia o app.
  await useComboioPreferencesStore.getState().hydrate();

  if (initError) {
    return { success: false, error: initError.message };
  }
  return { success: true };
}
