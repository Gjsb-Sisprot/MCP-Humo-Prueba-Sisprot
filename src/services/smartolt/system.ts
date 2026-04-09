
import { smartoltCache } from '../../lib/cache.js';
import type { SmartOltBaseResponse, OltContext } from './types.js';
import { smartOltFetch } from './client.js';

const OLT_RECENT_REBOOT_DAYS = 1;

const OLT_HIGH_TEMP_CELSIUS = 45;

export async function getOltsList(): Promise<{
  success: boolean;
  data?: Array<{ id: string; name: string; hardwareVersion: string; ip: string }>;
  error?: string;
}> {
  return smartoltCache.getOrSet('olts_list', async () => {
    try {
      interface OltsListResponse extends SmartOltBaseResponse {
        response: Array<{
          id: string;
          name: string;
          olt_hardware_version: string;
          ip: string;
        }>;
      }
      
      const response = await smartOltFetch<OltsListResponse>('/api/system/get_olts');
      
      if (!response.status || !response.response) {
        return { success: false, error: 'No se pudo obtener lista de OLTs' };
      }
      
      return {
        success: true,
        data: response.response.map(olt => ({
          id: olt.id,
          name: olt.name,
          hardwareVersion: olt.olt_hardware_version,
          ip: olt.ip,
        })),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Error obteniendo lista de OLTs' };
    }
  });
}

export async function getZonesList(): Promise<{
  success: boolean;
  data?: Array<{ id: string; name: string }>;
  error?: string;
}> {
  return smartoltCache.getOrSet('zones_list', async () => {
    try {
      interface ZonesListResponse extends SmartOltBaseResponse {
        response: Array<{ id: string; name: string }>;
      }
      
      const response = await smartOltFetch<ZonesListResponse>('/api/system/get_zones');
      
      if (!response.status || !response.response) {
        return { success: false, error: 'No se pudo obtener lista de zonas' };
      }
      
      return {
        success: true,
        data: response.response.map(zone => ({ id: zone.id, name: zone.name })),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Error obteniendo lista de zonas' };
    }
  });
}

export async function getOnuTypesList(): Promise<{
  success: boolean;
  data?: Array<{ id: string; name: string; ponType: string }>;
  error?: string;
}> {
  return smartoltCache.getOrSet('onu_types_list', async () => {
    try {
      interface OnuTypesListResponse extends SmartOltBaseResponse {
        response: Array<{ id: string; name: string; pon_type: string }>;
      }
      
      const response = await smartOltFetch<OnuTypesListResponse>('/api/system/get_onu_types');
      
      if (!response.status || !response.response) {
        return { success: false, error: 'No se pudo obtener lista de tipos de ONU' };
      }
      
      return {
        success: true,
        data: response.response.map(type => ({
          id: type.id,
          name: type.name,
          ponType: type.pon_type,
        })),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Error obteniendo lista de tipos de ONU' };
    }
  });
}

function parseUptimeDays(uptime: string): number | null {
  const match = uptime.match(/(\d+)\s*days?/i);
  return match ? parseInt(match[1], 10) : null;
}

function parseTempCelsius(temp: string): number | null {
  const match = temp.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

export async function getOltContext(oltId: string): Promise<OltContext | null> {
  try {
    interface OltUptimeResponse {
      response: Array<{
        olt_id: string;
        olt_name: string;
        uptime: string;
        env_temp: string;
      }>;
    }

    const data = await smartoltCache.getOrSet('olts_uptime_temp', async () => {
      const response = await smartOltFetch<OltUptimeResponse>(
        '/api/olt/get_olts_uptime_and_env_temperature'
      );
      return response.response || [];
    });

    const olt = data.find((o: { olt_id: string }) => o.olt_id === oltId);
    if (!olt) return null;

    const uptimeDays = parseUptimeDays(olt.uptime);
    const envTempCelsius = parseTempCelsius(olt.env_temp);

    return {
      oltId: olt.olt_id,
      oltName: olt.olt_name.trim(),
      uptime: olt.uptime,
      uptimeDays,
      envTemp: olt.env_temp,
      envTempCelsius,
      recentReboot: uptimeDays !== null && uptimeDays < OLT_RECENT_REBOOT_DAYS,
      highTemperature: envTempCelsius !== null && envTempCelsius > OLT_HIGH_TEMP_CELSIUS,
    };
  } catch (error) {
    return null;
  }
}
