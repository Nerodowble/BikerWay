export interface Motorcycle {
  id: string;
  /**
   * Rider's display name / apelido — shown to other riders in the comboio
   * voice room. Optional for back-compat with bikes created before Fase 7.
   */
  ownerName?: string;
  brand: string;
  model: string;
  tankCapacity: number;   // liters
  averageConsump: number; // km per liter
  createdAt: number;      // epoch ms
  updatedAt: number;      // epoch ms
}

export type MotorcycleInput = Omit<Motorcycle, 'id' | 'createdAt' | 'updatedAt'>;
