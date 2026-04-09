
import { z } from 'zod';

export const getOnuBySerialSchema = z.object({
  serial: z.string().min(1).describe('Serial (SN) de la ONU'),
});

export const getOnuByIdSchema = z.object({
  onuId: z.string().min(1).describe('ID externo único de la ONU'),
});

export const rebootOnuSchema = z.object({
  onuId: z.string().min(1).describe('ID externo único de la ONU a reiniciar'),
});

export const getUnconfiguredOnusSchema = z.object({
  oltId: z.string().optional().describe('ID del OLT para filtrar'),
  serial: z.string().optional().describe('Serial (SN) para buscar'),
  onuType: z.string().optional().describe('Tipo de ONU para filtrar'),
});

export const authorizeOnuSchema = z.object({
  oltId: z.string().min(1).describe('ID del OLT donde autorizar'),
  serial: z.string().min(1).describe('Serial (SN) de la ONU'),
  onuType: z.string().min(1).describe('Tipo de ONU (ej: ZTE-F660V6.0)'),
  zone: z.string().min(1).describe('Zona donde está ubicada'),
  name: z.string().min(1).describe('Nombre del cliente'),
  onuMode: z.enum(['Routing', 'Bridging']).describe('Modo de operación'),
  ponType: z.enum(['gpon', 'epon']).default('gpon'),
  board: z.coerce.string().optional().describe('Board (opcional)'),
  port: z.coerce.string().optional().describe('Port (opcional)'),
  vlan: z.number().optional().describe('VLAN-ID'),
  addressOrComment: z.string().optional().describe('Dirección o comentario'),
  odbSplitter: z.string().optional().describe('ODB/Splitter'),
  onuExternalId: z.string().optional().describe('ID externo único'),
  uploadSpeedProfile: z.string().optional().describe('Perfil velocidad subida'),
  downloadSpeedProfile: z.string().optional().describe('Perfil velocidad bajada'),
  contact: z.string().optional().describe('Teléfono de contacto del cliente'),
});

export type GetOnuBySerialInput = z.infer<typeof getOnuBySerialSchema>;
export type GetOnuByIdInput = z.infer<typeof getOnuByIdSchema>;
export type RebootOnuInput = z.infer<typeof rebootOnuSchema>;
export type GetUnconfiguredOnusInput = z.infer<typeof getUnconfiguredOnusSchema>;
export type AuthorizeOnuInput = z.infer<typeof authorizeOnuSchema>;

export interface OnuDetails {
  id: string;
  serial: string;
  name: string;
  oltId: string;
  oltName: string;
  board: string;
  port: string;
  onuNumber: string;
  onuType: string;
  zone: string;
  address: string;
  odbName: string;
  mode: string;
  ipAddress: string;
  adminStatus: string;
  authorizationDate: string | null;
  status?: string;
  signalQuality?: string;
  rxPower?: string;
  txPower?: string;
}

export interface OltContext {
  oltId: string;
  oltName: string;
  uptime: string;
  uptimeDays: number | null;
  envTemp: string;
  envTempCelsius: number | null;
  recentReboot: boolean;
  highTemperature: boolean;
}

export type OfflineCause = 
  | 'DYING_GASP'         
  | 'LOS_FIBER'          
  | 'ADMIN_DISABLED'     
  | 'UNKNOWN_OFFLINE'    
  | 'ONLINE';            

export interface OnuDiagnostic {
  onu: OnuDetails;
  signal: {
    rxPower: number | null;
    txPower: number | null;
    quality: string;
    rawValue: string;
  };
  analysis: {
    signalQuality: 'BUENA' | 'LIMITE' | 'CRITICA' | 'SIN_SENAL';
    isOnline: boolean;
    isLos: boolean;
    isPowerFail: boolean;
    isAdminDisabled: boolean;
    offlineCause: OfflineCause;
    requiresTechnicalVisit: boolean;
    issues: string[];
    recommendations: string[];
    diagnosis: string;
    lastStatusChange: string | null;
    signalGraphUrl: string | null;
    oltContext: OltContext | null;
  };
}

export interface UnconfiguredOnu {
  ponType: string;
  board: string;
  port: string;
  onuNumber: string;
  serial: string;
  onuTypeName: string;
  onuTypeId: string;
  oltId: string;
  isDisabled: boolean;
  actions: string[];
}

export interface SmartOltBaseResponse {
  status: boolean;
  message?: string;
}

export interface OnuDetailsRaw {
  unique_external_id: string;
  sn: string;
  name: string;
  olt_id: string;
  olt_name: string;
  board: string;
  port: string;
  onu: string;
  onu_type_name: string;
  zone_name: string;
  address: string;
  odb_name: string;
  mode: string;
  ip_address: string;
  administrative_status: string;
  authorization_date?: string;
}

export const SIGNAL_THRESHOLD = {
  GOOD_MIN: -25,  
  LIMIT: -28,     
} as const;
