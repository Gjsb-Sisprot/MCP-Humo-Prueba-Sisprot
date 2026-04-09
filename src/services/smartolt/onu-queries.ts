
import type { 
  GetOnuBySerialInput, 
  GetOnuByIdInput, 
  OnuDetails, 
  OnuDetailsRaw, 
  SmartOltBaseResponse 
} from './types.js';
import { getOnuBySerialSchema, getOnuByIdSchema } from './types.js';
import { smartOltFetch, normalizeOnuDetails, SMARTOLT_API_BASE } from './client.js';

export async function getOnuBySerial(input: GetOnuBySerialInput): Promise<{
  success: boolean; data?: OnuDetails; error?: string;
}> {
  try {
    const { serial } = getOnuBySerialSchema.parse(input);
    
    interface OnusBySnResponse extends SmartOltBaseResponse {
      onus: OnuDetailsRaw[];
    }
    
    const response = await smartOltFetch<OnusBySnResponse>(
      `/api/onu/get_onus_details_by_sn/${encodeURIComponent(serial)}`
    );
    if (!response.status || !response.onus?.length) {
      return { success: false, error: 'ONU no encontrada con ese serial' };
    }
    return { success: true, data: normalizeOnuDetails(response.onus[0]) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error consultando ONU' };
  }
}

export async function getOnuDetails(input: GetOnuByIdInput): Promise<{
  success: boolean; data?: OnuDetails; error?: string;
}> {
  try {
    const { onuId } = getOnuByIdSchema.parse(input);
    
    interface OnuDetailsResponse extends SmartOltBaseResponse {
      onu_details: OnuDetailsRaw;
    }
    
    const response = await smartOltFetch<OnuDetailsResponse>(
      `/api/onu/get_onu_details/${encodeURIComponent(onuId)}`
    );
    if (!response.status || !response.onu_details) {
      return { success: false, error: 'ONU no encontrada' };
    }
    return { success: true, data: normalizeOnuDetails(response.onu_details) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error consultando ONU' };
  }
}

export async function getOnuStatus(input: GetOnuByIdInput): Promise<{
  success: boolean; data?: { status: string; lastStatusChange: string | null }; error?: string;
}> {
  try {
    const { onuId } = getOnuByIdSchema.parse(input);
    
    interface OnuStatusResponse extends SmartOltBaseResponse {
      onu_status: string;
      last_status_change?: string;
    }
    
    const response = await smartOltFetch<OnuStatusResponse>(
      `/api/onu/get_onu_status/${encodeURIComponent(onuId)}`
    );
    if (!response.status) {
      return { success: false, error: 'No se pudo obtener estado de la ONU' };
    }
    return { 
      success: true, 
      data: { 
        status: response.onu_status,
        lastStatusChange: response.last_status_change || null,
      } 
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error consultando estado ONU' };
  }
}

export function getOnuSignalGraphUrl(onuId: string): string | null {
  if (!SMARTOLT_API_BASE) return null;
  return `${SMARTOLT_API_BASE}/api/onu/get_onu_signal_graph/${encodeURIComponent(onuId)}`;
}

export async function getOnuSignalBulk(onuId: string): Promise<{
  success: boolean;
  data?: { signal: string; signal1490: string; signal1310: string };
  error?: string;
}> {
  try {
    interface BulkSignalResponse extends SmartOltBaseResponse {
      response: Array<{
        unique_external_id: string;
        signal: string;
        signal_1490: string;
        signal_1310: string;
      }>;
    }
    
    const response = await smartOltFetch<BulkSignalResponse>('/api/onu/get_onus_signals');
    
    if (!response.status && !response.response) {
      return { success: false, error: 'No se pudo obtener señales bulk' };
    }
    
    const onu = (response.response || []).find(o => o.unique_external_id === onuId);
    if (!onu) {
      return { success: false, error: 'ONU no encontrada en señales bulk' };
    }
    
    return {
      success: true,
      data: {
        signal: onu.signal,
        signal1490: onu.signal_1490,
        signal1310: onu.signal_1310,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error consultando señales bulk' };
  }
}

export async function getOnuSignal(input: GetOnuByIdInput): Promise<{
  success: boolean; 
  data?: { quality: string; rxPower: string; txPower: string; rawValue: string }; 
  error?: string;
}> {
  try {
    const { onuId } = getOnuByIdSchema.parse(input);
    
    interface OnuSignalResponse extends SmartOltBaseResponse {
      onu_signal: string;
      onu_signal_1490: string;
      onu_signal_1310: string;
      onu_signal_value: string;
    }
    
    const response = await smartOltFetch<OnuSignalResponse>(
      `/api/onu/get_onu_signal/${encodeURIComponent(onuId)}`
    );
    if (!response.status) {
      return { success: false, error: 'No se pudo obtener señal de la ONU' };
    }
    return { 
      success: true, 
      data: {
        quality: response.onu_signal,
        rxPower: response.onu_signal_1490,
        txPower: response.onu_signal_1310,
        rawValue: response.onu_signal_value,
      }
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error consultando señal ONU' };
  }
}
