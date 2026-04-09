
import { smartoltCache } from '../../lib/cache.js';
import type { OnuDetailsRaw, OnuDetails, SmartOltBaseResponse, SIGNAL_THRESHOLD } from './types.js';
import { SIGNAL_THRESHOLD as THRESHOLDS } from './types.js';

const SMARTOLT_API_BASE = process.env.SMARTOLT_API_URL || '';
const SMARTOLT_API_KEY = process.env.SMARTOLT_API_KEY || '';

export { SMARTOLT_API_BASE, SMARTOLT_API_KEY };

export async function smartOltFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  if (!SMARTOLT_API_BASE) throw new Error('SMARTOLT_API_URL no configurada');
  if (!SMARTOLT_API_KEY) throw new Error('SMARTOLT_API_KEY no configurada');

  const url = `${SMARTOLT_API_BASE}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: { 
      'Content-Type': 'application/json', 
      'X-Token': SMARTOLT_API_KEY, 
      ...options?.headers 
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SmartOLT API Error (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<T>;
}

export function parseSignalPower(value: string | undefined | null): number | null {
  if (!value) return null;
  const match = value.match(/-?\d+\.?\d*/);
  return match ? parseFloat(match[0]) : null;
}

export function normalizeOnuDetails(raw: OnuDetailsRaw): OnuDetails {
  return {
    id: raw.unique_external_id,
    serial: raw.sn,
    name: raw.name,
    oltId: raw.olt_id,
    oltName: raw.olt_name,
    board: raw.board,
    port: raw.port,
    onuNumber: raw.onu,
    onuType: raw.onu_type_name,
    zone: raw.zone_name,
    address: raw.address,
    odbName: raw.odb_name,
    mode: raw.mode,
    ipAddress: raw.ip_address,
    adminStatus: raw.administrative_status,
    authorizationDate: raw.authorization_date || null,
  };
}

export function analyzeSignalQuality(rxPower: number | null): {
  quality: 'BUENA' | 'LIMITE' | 'CRITICA' | 'SIN_SENAL';
  issues: string[];
  recommendations: string[];
} {
  if (rxPower === null) {
    return {
      quality: 'SIN_SENAL',
      issues: ['No se puede leer la potencia de recepción'],
      recommendations: ['Verificar conexión física de la fibra', 'Posible corte de fibra'],
    };
  }
  if (rxPower >= THRESHOLDS.GOOD_MIN) {
    return { quality: 'BUENA', issues: [], recommendations: [] };
  }
  if (rxPower >= THRESHOLDS.LIMIT) {
    return {
      quality: 'LIMITE',
      issues: [`Potencia en límite operativo (${rxPower} dBm)`],
      recommendations: ['Monitorear la señal', 'Programar revisión preventiva de conectores'],
    };
  }
  return {
    quality: 'CRITICA',
    issues: [`Potencia crítica (${rxPower} dBm)`, 'Señal por debajo del límite operativo (-28 dBm)'],
    recommendations: ['Requiere visita técnica', 'Posibles causas: cable doblado, conector sucio, corte parcial'],
  };
}

export async function getOnuTypeName(onuTypeId: string): Promise<string | null> {
  try {
    const mapKey = 'onu_types_map';
    let typesMap = smartoltCache.get(mapKey) as Map<string, string> | undefined;
    
    if (!typesMap) {
      interface OnuTypesResponse extends SmartOltBaseResponse {
        response: Array<{ id: string; name: string; pon_type: string; capability: string }>;
      }
      const response = await smartOltFetch<OnuTypesResponse>('/api/system/get_onu_types');
      if (!response.status || !response.response) return null;
      
      typesMap = new Map();
      for (const type of response.response) {
        typesMap.set(type.id, type.name);
      }
      smartoltCache.set(mapKey, typesMap);
    }
    
    return typesMap.get(onuTypeId) || null;
  } catch (error) {
    return null;
  }
}
