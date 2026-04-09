
import { z } from 'zod';
import { sisprotCache } from '../lib/cache.js';

export const getClientContractsSchema = z.object({
  identification: z.string().min(1).describe('Cédula o RIF del cliente (ej: V12345678, J-12345678-9)'),
});

export const getContractDetailsSchema = z.object({
  contractId: z.number().int().positive().describe('ID del contrato en Gsoft'),
});

export type GetClientContractsInput = z.infer<typeof getClientContractsSchema>;
export type GetContractDetailsInput = z.infer<typeof getContractDetailsSchema>;

export interface ContractResumedResponse {
  id: number;
  client_name: string;
  client_last_name: string;
  client_mobile: string;
  client_email: string;
  sector_name: string;
  plan_name: string;
  debt: number;
}

export interface ContractSummary {
  id: number;
  client_id: number;
  name: string;
  last_name: string;
  identification: string;
  status: number;
  status_name: string;
  sector_name: string;
  plan_name?: string;
  debt: number;
  mobile: string;
  email: string;
}

export interface ContractDetails extends ContractSummary {
  installation_order: string;
  latitude: string;
  longitude: string;
  pin_code: string;
  client_type: number;
  client_type_name: string;
  sector_id: number;
  parish_id: number;
  parish_name: string;
  cycle: number;
  cycle_end: number;
  address: string;
  migrate: boolean;
  contract_detail: ContractServiceDetail[];
  contract_bank_associated: unknown[];
}

export interface ServiceDetail {
  id: number;
  mac: string;
  ip: string;
  redipv4: string | null;
  nap_port: string | null;
  serial: string;
  ppuser: string | null;
  pppassw: string | null;
  interface: string | null;
  queue: string | null;
  contract_detail: number;
  contract: number;
  debt_to_pay: string;
  created_at: string;
  updated_at: string;
}

export interface ContractServiceDetail {
  id: number;
  nodo: number | null;
  nodo_name: string | null;
  service_type: number;
  service_type_name: string;
  plan: number;
  plan_name: string;
  plan_cost: number | string;
  status: number;
  status_name: string;
  date_end: string | null;
  service_detail?: ServiceDetail[];
}

export interface SisprotApiResponse<T> {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: T[];
  id?: number;
}

export interface PlanDetails {
  id: number;
  name: string;
  code: string;
  description: string;
  profile: string;
  profile_id: number;
  status: boolean;
  cost: string;
  client_type: number;
  client_type_name: string;
}

export const GSOFT_STATUS = {
  16: 'ACTIVO',
  18: 'POR_INSTALAR', 
  19: 'SUSPENDIDO',
  20: 'PAUSADO',
  34: 'CANCELADO',
} as const;

export type GsoftStatusCode = keyof typeof GSOFT_STATUS;

const SISPROT_API_BASE = process.env.SISPROT_API_URL || 'https://api.sisprotgf.com/api';
const SISPROT_API_KEY = process.env.SISPROT_API_KEY || '';

async function sisprotFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  if (!SISPROT_API_KEY) {
    throw new Error('SISPROT_API_KEY no configurada. Configure la variable de entorno.');
  }
  
  const url = `${SISPROT_API_BASE}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': SISPROT_API_KEY,
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    
    let errorMessage = errorText;
    try {
      const errorJson = JSON.parse(errorText);
      
      if (errorJson.detail && 
          (errorJson.detail.includes('Http404') || 
           errorJson.detail.includes('get_object_or_404'))) {
        
        const pathMatch = endpoint.match(/\/contracts\/(\d+)\//);
        const contractId = pathMatch ? pathMatch[1] : 'desconocido';
        throw new Error(`NOT_FOUND:El contrato ${contractId} no existe en Sisprot`);
      }
      
      errorMessage = errorJson.detail || errorJson.error || errorText;
    } catch (parseError) {
      
      if (errorText.length > 200) {
        errorMessage = errorText.substring(0, 200) + '...';
      }
    }
    
    throw new Error(`Sisprot API Error (${response.status}): ${errorMessage}`);
  }

  return response.json() as Promise<T>;
}

export async function getClientContracts(input: GetClientContractsInput): Promise<{
  success: boolean;
  data?: ContractDetails[];
  error?: string;
}> {
  try {
    const validated = getClientContractsSchema.parse(input);
    
    const cleanId = validated.identification.replace(/[-\s]/g, '').toUpperCase();
    
    const response = await sisprotFetch<SisprotApiResponse<ContractResumedResponse>>(
      `/public/contracts/?client_identification=${encodeURIComponent(cleanId)}&resumed=true`
    );

    const resumedContracts = response.results || [];
    
    if (resumedContracts.length === 0) {
      return {
        success: true,
        data: [],
      };
    }

    const detailsPromises = resumedContracts.map(contract => 
      getContractDetails({ contractId: contract.id })
    );
    
    const detailsResults = await Promise.all(detailsPromises);
    
    const contracts: ContractDetails[] = detailsResults
      .filter(result => result.success && result.data)
      .map(result => result.data!);
    
    return {
      success: true,
      data: contracts,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido consultando contratos',
    };
  }
}

export async function getContractDetails(input: GetContractDetailsInput): Promise<{
  success: boolean;
  data?: ContractDetails;
  error?: string;
}> {
  try {
    const validated = getContractDetailsSchema.parse(input);
    
    const response = await sisprotFetch<ContractDetails>(
      `/public/contracts/${validated.contractId}/`
    );

    return {
      success: true,
      data: response,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido consultando contrato',
    };
  }
}

export async function getClientServiceStatus(identification: string): Promise<{
  success: boolean;
  data?: {
    identification: string;
    contracts: Array<{
      contractId: number;
      clientName: string;
      status: string;
      statusCode: number;
      isSuspended: boolean;
      isActive: boolean;
      debt: string;
      hasDebt: boolean;
      plan?: string;
      sector?: string;
      onuSerial?: string;
      onuMac?: string;
      ppuser?: string;
    }>;
    summary: {
      totalContracts: number;
      activeContracts: number;
      suspendedContracts: number;
      hasAnyDebt: boolean;
    };
  };
  error?: string;
}> {
  try {
    const result = await getClientContracts({ identification });
    
    if (!result.success || !result.data) {
      return {
        success: false,
        error: result.error || 'No se encontraron contratos',
      };
    }

    const contracts = result.data.map((contract) => {
      
      const internetService = contract.contract_detail?.find(d => d.service_type === 1); 
      const serviceDetail = internetService?.service_detail?.[0];
      
      return {
        contractId: contract.id,
        clientName: `${contract.name} ${contract.last_name}`.trim(),
        status: contract.status_name || GSOFT_STATUS[contract.status as GsoftStatusCode] || 'DESCONOCIDO',
        statusCode: contract.status,
        isSuspended: contract.status === 19,
        isActive: contract.status === 16,
        debt: contract.debt?.toFixed(2) || '0.00',
        hasDebt: (contract.debt || 0) > 0,
        plan: contract.plan_name,
        sector: contract.sector_name,
        onuSerial: serviceDetail?.serial,
        onuMac: serviceDetail?.mac,
        ppuser: serviceDetail?.ppuser ?? undefined,
      };
    });

    return {
      success: true,
      data: {
        identification,
        contracts,
        summary: {
          totalContracts: contracts.length,
          activeContracts: contracts.filter(c => c.isActive).length,
          suspendedContracts: contracts.filter(c => c.isSuspended).length,
          hasAnyDebt: contracts.some(c => c.hasDebt),
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error consultando estado del cliente',
    };
  }
}

export async function getPlanDetails(planId: number): Promise<{
  success: boolean;
  data?: PlanDetails;
  error?: string;
}> {
  return sisprotCache.getOrSet(`plan:${planId}`, async () => {
    try {
      const response = await sisprotFetch<SisprotApiResponse<PlanDetails>>(
        `/public/plan?id=${planId}`
      );

      const plan = response.results?.[0];

      if (!plan) {
        return {
          success: false,
          error: `Plan con ID ${planId} no encontrado en resultados`,
        };
      }

      return {
        success: true,
        data: plan,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error consultando plan',
      };
    }
  });
}

export async function activateContract(contractId: number): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  try {
    await sisprotFetch<unknown>(
      `/public/contracts/${contractId}/`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status: 16,
          detail: 'CLIENTE SOLICITO REACTIVACION',
        }),
      }
    );

    return {
      success: true,
      message: `Contrato ${contractId} activado correctamente (status: 16 ACTIVO)`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error activando contrato',
    };
  }
}
