export interface ActasPostResponseSuccess {
  estado: 'registrada';
  acta: string;
  version: number;
  dudosa: boolean;
  kind: 'nueva' | 'correccion';
  streamId: string;
}

export interface ActasPostResponseStale {
  estado: 'ya_registrada';
  acta: string;
  version: number;
  motivo: 'idempotencia_idem' | 'version_obsoleta_o_igual';
}

export interface ErrorResponse {
  error: string;
  mensaje?: string;
  retryAfter?: number;
  detalle?: any;
}

export interface WhoamiResponse {
  instancia: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  redis: 'ok' | 'down';
  instancia: string;
}

