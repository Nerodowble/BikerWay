/**
 * SOS Comunitário (F29) — tipos compartilhados.
 *
 * O modulo de SOS dispara um pedido de socorro pra motociclistas em um raio
 * de ~15km via PeerJS (F29.2) e, no caso de Saude, abre fluxo direto pra
 * SAMU/Bombeiros (F29.1). Esses tipos sao a interface estavel entre a UI,
 * o store e a camada de rede (que ainda vai ser plugada).
 */

export type SOSProblemType =
  | 'pneu_furado'
  | 'pane_mecanica'
  | 'pane_eletrica'
  | 'pane_seca'
  | 'saude';

export type SOSStatus = 'open' | 'resolved' | 'cancelled';

export interface SOSAlert {
  /**
   * Identificador local ao dispositivo. UUID v4 lite gerado no client.
   * Em F29.2 vai pra payload PeerJS pra correlacionar broadcast e cancel.
   */
  id: string;
  /**
   * Tipo de problema escolhido na grade. Define o icone, a cor e o fluxo
   * pos-ativacao (saude abre modal extra, demais so disparam broadcast).
   */
  problem_type: SOSProblemType;
  /**
   * Mensagem livre do piloto (opcional). Aparece no card de alerta recebido
   * pra dar contexto ("estou sem camara de ar reserva"). 120 chars max
   * pra caber confortavel em uma linha do card.
   */
  message?: string;
  /**
   * Coordenadas do disparo. Capturadas via expo-location no momento da
   * ativacao do slider — nao acompanham o piloto depois do disparo.
   */
  latitude: number;
  longitude: number;
  /**
   * Epoch ms do disparo. Usado pra calcular janela do anti-abuso (3 SOS+
   * cancel em 7 dias) e pra ordenar historico no Settings.
   */
  created_at: number;
  status: SOSStatus;
}

/**
 * Metadata visual de cada tipo de problema. Centralizado aqui pra que o
 * card de alerta recebido (F29.3) e a grade de disparo (F29.1) mostrem o
 * mesmo icone/cor/nome em todo lugar.
 */
export interface SOSProblemMeta {
  emoji: string;
  label: string;
  /**
   * Cor de destaque do card na grade. Saude usa tom de perigo (vermelho);
   * panes usam ambar pra diferenciar de UI primaria sem assustar o piloto.
   */
  accentColor: string;
  isHealth: boolean;
}

export const SOS_PROBLEMS: Record<SOSProblemType, SOSProblemMeta> = {
  pneu_furado: {
    emoji: '🛞',
    label: 'Pneu Furado',
    accentColor: '#FFCC00',
    isHealth: false,
  },
  pane_mecanica: {
    emoji: '🛠️',
    label: 'Pane Mecânica',
    accentColor: '#FFCC00',
    isHealth: false,
  },
  pane_eletrica: {
    emoji: '⚡',
    label: 'Pane Elétrica',
    accentColor: '#FFCC00',
    isHealth: false,
  },
  pane_seca: {
    emoji: '⛽',
    label: 'Pane Seca',
    accentColor: '#FFCC00',
    isHealth: false,
  },
  saude: {
    emoji: '🏥',
    label: 'Emergência de Saúde',
    accentColor: '#E63946',
    isHealth: true,
  },
};
