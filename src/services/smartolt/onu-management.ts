
import type { 
  RebootOnuInput, 
  GetUnconfiguredOnusInput, 
  AuthorizeOnuInput, 
  UnconfiguredOnu, 
  SmartOltBaseResponse 
} from './types.js';
import { rebootOnuSchema, getUnconfiguredOnusSchema, authorizeOnuSchema } from './types.js';
import { smartOltFetch, SMARTOLT_API_BASE, SMARTOLT_API_KEY } from './client.js';

export async function rebootOnu(input: RebootOnuInput): Promise<{
  success: boolean; message?: string; error?: string;
}> {
  try {
    const { onuId } = rebootOnuSchema.parse(input);
    const response = await smartOltFetch<SmartOltBaseResponse>(
      `/api/onu/reboot_onu/${encodeURIComponent(onuId)}`,
      { method: 'POST' }
    );
    if (!response.status) {
      return { success: false, error: response.message || 'No se pudo reiniciar la ONU' };
    }
    return { success: true, message: 'ONU reiniciada. Tardará ~2-3 minutos en reconectarse.' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error reiniciando ONU' };
  }
}

export async function getUnconfiguredOnus(input: GetUnconfiguredOnusInput = {}): Promise<{
  success: boolean; 
  data?: { onus: UnconfiguredOnu[]; total: number; oltId?: string }; 
  error?: string;
}> {
  try {
    const { oltId, serial, onuType } = getUnconfiguredOnusSchema.parse(input);
    
    let url = oltId 
      ? `/api/onu/unconfigured_onus_for_olt/${encodeURIComponent(oltId)}`
      : '/api/onu/unconfigured_onus';
    
    const params = new URLSearchParams();
    if (serial) params.append('sn', serial);
    if (onuType) params.append('onu_type', onuType);
    
    if (params.toString()) {
      url += `?${params.toString()}`;
    }
    
    interface UnconfiguredOnusResponse extends SmartOltBaseResponse {
      response: Array<{
        pon_type: string;
        board: string;
        port: string;
        onu: string;
        sn: string;
        onu_type_name: string;
        onu_type_id: string;
        olt_id: string;
        is_disabled: string;
        actions?: string[];
      }>;
    }
    
    const response = await smartOltFetch<UnconfiguredOnusResponse>(url);
    
    if (!response.status) {
      return { success: false, error: 'No se pudo obtener lista de ONUs no configuradas' };
    }
    
    const onus: UnconfiguredOnu[] = (response.response || []).map(raw => ({
      ponType: raw.pon_type,
      board: raw.board,
      port: raw.port,
      onuNumber: raw.onu,
      serial: raw.sn,
      onuTypeName: raw.onu_type_name,
      onuTypeId: raw.onu_type_id,
      oltId: raw.olt_id,
      isDisabled: raw.is_disabled === '1',
      actions: raw.actions || ['view', 'authorize'],
    }));
    
    return { 
      success: true, 
      data: { onus, total: onus.length, ...(oltId && { oltId }) } 
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error consultando ONUs no configuradas' };
  }
}

export async function findUnconfiguredOnu(serial: string, oltId?: string): Promise<{
  success: boolean;
  data?: { found: boolean; onu?: UnconfiguredOnu; message: string };
  error?: string;
}> {
  try {
    const result = await getUnconfiguredOnus({ oltId, serial });
    
    if (!result.success) {
      return { success: false, error: result.error };
    }
    
    const onu = result.data?.onus.find(o => 
      o.serial.toLowerCase() === serial.toLowerCase()
    );
    
    if (onu) {
      return {
        success: true,
        data: {
          found: true,
          onu,
          message: `ONU ${serial} encontrada como NO CONFIGURADA en OLT ${onu.oltId}, Board ${onu.board}, Puerto ${onu.port}. Requiere autorización.`,
        },
      };
    }
    
    return {
      success: true,
      data: {
        found: false,
        message: `ONU ${serial} NO está en la lista de no configuradas. Puede estar ya configurada o no detectada por la OLT.`,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error buscando ONU no configurada' };
  }
}

export async function authorizeOnu(input: AuthorizeOnuInput): Promise<{
  success: boolean; message?: string; error?: string;
}> {
  try {
    const params = authorizeOnuSchema.parse(input);
    
    const formData = new FormData();
    formData.append('olt_id', params.oltId);
    formData.append('sn', params.serial);
    formData.append('onu_type', params.onuType);
    formData.append('zone', params.zone);
    formData.append('name', params.name);
    formData.append('onu_mode', params.onuMode);
    formData.append('pon_type', params.ponType || 'gpon');
    
    if (params.board) formData.append('board', params.board);
    if (params.port) formData.append('port', params.port);
    if (params.vlan !== undefined) formData.append('vlan', params.vlan.toString());
    if (params.addressOrComment) formData.append('address_or_comment', params.addressOrComment);
    if (params.odbSplitter) formData.append('odb', params.odbSplitter);
    if (params.onuExternalId) formData.append('onu_external_id', params.onuExternalId);
    if (params.uploadSpeedProfile) formData.append('upload_speed_profile_name', params.uploadSpeedProfile);
    if (params.downloadSpeedProfile) formData.append('download_speed_profile_name', params.downloadSpeedProfile);
    if (params.contact) formData.append('contact', params.contact);
    
    interface AuthorizeOnuResponse extends SmartOltBaseResponse {
      response: string;
    }
    
    const response = await fetch(`${SMARTOLT_API_BASE}/api/onu/authorize_onu`, {
      method: 'POST',
      headers: { 'X-Token': SMARTOLT_API_KEY },
      body: formData,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Error de SmartOLT (${response.status}): ${errorText}` };
    }
    
    const data = await response.json() as AuthorizeOnuResponse;
    
    if (!data.status) {
      return { success: false, error: data.message || 'No se pudo autorizar la ONU' };
    }
    
    return { 
      success: true, 
      message: data.response || 'ONU autorizada correctamente. La configuración ha sido guardada.',
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error autorizando ONU' };
  }
}
