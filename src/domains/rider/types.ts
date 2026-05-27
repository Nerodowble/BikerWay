// Why singleton: BikerWay tem 1 perfil de piloto por dispositivo (o dono da
// moto). Diferente de `motorcycles[]` onde o piloto pode ter varias motos.
// Por isso o `RiderProfile` nao tem array — eh um registro unico.

export type Genero =
  | 'feminino'
  | 'masculino'
  | 'nao-binario'
  | 'prefiro-nao-dizer';

export type EstiloPilotagem = 'urbano' | 'estrada' | 'trail' | 'misto';

export type PreferenciaTempo = 'sol' | 'qualquer' | 'evito-chuva';

export interface RiderProfile {
  id: string;
  /** Apelido / nome curto que aparece em comboios e telas. Obrigatorio. */
  displayName: string;
  /** Cidade onde o piloto mora, ex: "Diadema". Obrigatorio. */
  cidade: string;
  /** Sigla do estado em maiusculas (UF), 2 chars, ex: "SP". Obrigatorio. */
  estado: string;
  /** Tempo de experiencia em anos. Faixa 0-80. Opcional. */
  anosPilotando?: number;
  genero?: Genero;
  estiloPilotagem?: EstiloPilotagem;
  preferenciaTempo?: PreferenciaTempo;
  /** Bio livre, 0-200 chars. Opcional. */
  bio?: string;
  /**
   * URI persistente do avatar (file:// dentro do documentDirectory). Setado
   * apos copia do ImagePicker pra FileSystem.documentDirectory pra
   * sobreviver entre cold-starts. Null/undefined = sem avatar, UI cai pro
   * fallback de inicial do nome. F32.
   */
  avatarUri?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RiderProfileInput {
  displayName: string;
  cidade: string;
  estado: string;
  anosPilotando?: number;
  genero?: Genero;
  estiloPilotagem?: EstiloPilotagem;
  preferenciaTempo?: PreferenciaTempo;
  bio?: string;
  avatarUri?: string;
}
