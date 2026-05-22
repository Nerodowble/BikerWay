import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigationStore } from '@/state/navigationStore';
import {
  deriveNavigationState,
  type NavigationDerivedState,
} from '@/domains/navigation/engine';

export interface UseNavigationEngineResult {
  derived: NavigationDerivedState | null;
}

export function useNavigationEngine(): UseNavigationEngineResult {
  const route = useNavigationStore((s) => s.activeRoute);
  const position = useNavigationStore((s) => s.currentPosition);
  const isNavigating = useNavigationStore((s) => s.isNavigating);

  const offRouteSinceMsRef = useRef<number | null>(null);
  const [derived, setDerived] = useState<NavigationDerivedState | null>(null);

  useEffect(() => {
    if (!isNavigating || !route || !position) {
      offRouteSinceMsRef.current = null;
      setDerived(null);
      return;
    }
    const next = deriveNavigationState(
      route,
      { latitude: position.latitude, longitude: position.longitude },
      offRouteSinceMsRef.current,
    );
    offRouteSinceMsRef.current = next.offRouteSinceMs;
    setDerived(next);
  }, [route, position, isNavigating]);

  return useMemo(() => ({ derived }), [derived]);
}
