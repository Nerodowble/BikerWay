import type { CatalogRoute } from '../catalog/types';
import type { SavedTrip } from './types';

/**
 * F35.7 — Formata uma SavedTrip pra texto puro que cabe no clipboard /
 * WhatsApp / qualquer messenger. Pure: nao tem side effect; o caller
 * decide o que faz com a string (Share API, Linking, Clipboard).
 *
 * Formato segue o esboco do brainstorm:
 *   🏍️ Plano de Trip BikerWay
 *
 *   Dia 1: <Rota> (<inicio> → <fim>)
 *   Dia 2: ...
 *
 *   Total: X km • R$ Y pedagio
 *   [Pernoites: ...]
 *   [Saida: dd/mm/yyyy]
 *   [Notas: ...]
 */

function formatBrazilianDate(epoch: number): string {
  const d = new Date(epoch);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function formatReais(value: number): string {
  if (value <= 0) return 'sem pedágio';
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}

export function formatTripForShare(
  trip: SavedTrip,
  catalogById: ReadonlyMap<string, CatalogRoute>,
): string {
  const lines: string[] = [];
  lines.push('🏍️ Plano de Trip BikerWay');
  lines.push('');
  if (trip.name && trip.name.length > 0) {
    lines.push(`📍 ${trip.name}`);
    lines.push('');
  }
  let totalKm = 0;
  let totalToll = 0;
  trip.rotaIds.forEach((rotaId, idx) => {
    const route = catalogById.get(rotaId);
    if (!route) {
      lines.push(`Dia ${idx + 1}: ${rotaId}`);
      return;
    }
    totalKm += route.distancia_total_km;
    totalToll += route.total_pedagios_moto_reais;
    lines.push(
      `Dia ${idx + 1}: ${route.nome_rota} (${route.coordenada_inicio.cidade} → ${route.coordenada_fim.cidade}) — ${Math.round(route.distancia_total_km)} km`,
    );
  });
  lines.push('');
  lines.push(`Total: ${Math.round(totalKm)} km · ${formatReais(totalToll)}`);
  if (trip.pernoiteLocations && trip.pernoiteLocations.length > 0) {
    lines.push(`Pernoites: ${trip.pernoiteLocations.join(' · ')}`);
  }
  if (trip.scheduledFor !== undefined) {
    lines.push(`Saída prevista: ${formatBrazilianDate(trip.scheduledFor)}`);
  }
  if (trip.notes && trip.notes.length > 0) {
    lines.push('');
    lines.push(trip.notes);
  }
  lines.push('');
  lines.push('— enviado pelo BikerWay');
  return lines.join('\n');
}
