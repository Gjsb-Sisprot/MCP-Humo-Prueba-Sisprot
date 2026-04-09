
import { z } from 'zod';
import { defineTool, defineToolGroup } from './types.js';
import {
  getClientContracts,
  getContractDetails,
  getClientServiceStatus,
} from '../services/sisprot-api.js';

const identificationSchema = z.object({
  identification: z.string().min(1).describe('Cédula o RIF del cliente (ej: V12345678, J-12345678-9)'),
});

const contractIdSchema = z.object({
  contractId: z.number().int().positive().describe('ID numérico del contrato en Gsoft'),
});

export const clientTools = defineToolGroup('client', {

  get_client_contracts: defineTool(identificationSchema, {
    description: `Busca todos los contratos de un cliente por su cédula o RIF.

CUÁNDO USAR:
- El cliente quiere saber sus servicios contratados
- Necesitas verificar la identidad del cliente
- Quieres obtener IDs de contrato para consultas más detalladas

RETORNA: Lista de contratos con nombre, plan, estado, deuda, sector, datos ONU.`,

    execute: async (args) => {
      return await getClientContracts(args);
    },

    tags: ['client', 'contracts', 'lookup'],
  }),

  get_contract_details: defineTool(contractIdSchema, {
    description: `Obtiene detalles completos de un contrato específico por su ID.

CUÁNDO USAR:
- Ya tienes el ID del contrato (obtenido de get_client_contracts)
- Necesitas información detallada: dirección, coordenadas, detalles de servicio
- Quieres ver el serial de la ONU, MAC, usuario PPPoE

RETORNA: Datos completos del contrato incluyendo servicios y detalles técnicos.`,

    execute: async (args) => {
      return await getContractDetails(args);
    },

    tags: ['client', 'contracts', 'details'],
  }),

  get_client_service_status: defineTool(identificationSchema, {
    description: `Obtiene un resumen del estado de servicio de un cliente.

CUÁNDO USAR:
- Primera consulta de soporte nivel 1
- Verificar si el cliente está activo, suspendido, o tiene deuda
- Necesitas un resumen rápido de todos sus contratos
- Quieres saber si tiene ONU y su serial

RETORNA: Resumen con estado (activo/suspendido), deuda, plan, sector, 
serial ONU, y estadísticas generales del cliente.

FLUJO TÍPICO DE SOPORTE:
1. get_client_service_status → ver estado general
2. Si tiene ONU → get_onu_diagnostic con el serial
3. Si está suspendido → verificar deuda`,

    execute: async (args) => {
      return await getClientServiceStatus(args.identification);
    },

    tags: ['client', 'status', 'support'],
  }),

});
