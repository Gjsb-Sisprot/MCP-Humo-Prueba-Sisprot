
import { z } from 'zod';
import { defineTool, defineToolGroup } from './types.js';
import {
  diagnoseOnu,
  rebootOnu,
  getUnconfiguredOnus,
  findUnconfiguredOnu,
  getOltsList,
  getZonesList,
  getOnuTypesList,
} from '../services/smartolt/index.js';

const serialSchema = z.object({
  serial: z.string().min(1).describe('Serial (SN) de la ONU del cliente'),
});

const onuIdSchema = z.object({
  onuId: z.string().min(1).describe('ID externo único de la ONU (de get_onu_diagnostic)'),
});

const unconfiguredSchema = z.object({
  oltId: z.string().optional().describe('ID del OLT para filtrar (opcional)'),
  serial: z.string().optional().describe('Serial específico a buscar (opcional)'),
  onuType: z.string().optional().describe('Tipo de ONU para filtrar (opcional)'),
});

const findUnconfiguredSchema = z.object({
  serial: z.string().min(1).describe('Serial (SN) de la ONU a buscar'),
  oltId: z.string().optional().describe('ID del OLT para filtrar (opcional)'),
});


const emptySchema = z.object({});

export const supportTools = defineToolGroup('support', {
  
  get_onu_diagnostic: defineTool(serialSchema, {
    description: `Realiza un diagnóstico completo de una ONU (equipo del cliente).

INFORMACIÓN QUE RETORNA:
- Estado operativo (Online/Offline/LOS/Power fail)
- Clasificación de causa: Dying Gasp (corte eléctrico) vs LOS (corte de fibra)
- Nivel de señal (buena/límite/crítica)
- Estado administrativo (habilitada/suspendida)
- Detección de intermitencia y flapping (reconexiones frecuentes)
- Contexto del OLT (uptime, temperatura ambiente)
- URL del gráfico de señal histórico
- Recomendaciones específicas según cada caso

CASOS QUE DETECTA:
1. SUSPENSION_ADMINISTRATIVA - Servicio bloqueado (falta de pago)
2. DYING_GASP - Corte de energía eléctrica (el equipo se apagó)
3. LOS_FIBRA - Corte de fibra óptica o conector dañado
4. ONLINE_SEÑAL_CRITICA - Funciona pero señal muy baja
5. FLAPPING - Reconexiones frecuentes (conector flojo, fibra dañada)
6. INTERMITENCIA_PROBABLE - Online pero con indicadores de inestabilidad
7. OPERATIVA - Todo funcionando correctamente

CONTEXTO OLT:
- Si el OLT reinició recientemente, descarta flapping causado por reconexión masiva
- Alerta de temperatura elevada del OLT

IMPORTANTE: Busca la ONU por serial (SN).`,
    
    execute: async (args) => {
      const result = await diagnoseOnu({ serial: args.serial });
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Error en diagnóstico');
      }
      
      return {
        success: true,
        diagnostic: result.data,
        summary: {
          diagnosis: result.data.analysis.diagnosis,
          offlineCause: result.data.analysis.offlineCause,
          requiresTechnicalVisit: result.data.analysis.requiresTechnicalVisit,
          issueCount: result.data.analysis.issues.length,
          signalGraphUrl: result.data.analysis.signalGraphUrl,
          lastStatusChange: result.data.analysis.lastStatusChange,
          oltContext: result.data.analysis.oltContext,
        },
      };
    },
    
    tags: ['onu', 'diagnostic', 'smartolt'],
    requiresAuth: true,
  }),

  reboot_onu: defineTool(onuIdSchema, {
    description: `Reinicia remotamente una ONU (equipo del cliente).

IMPORTANTE:
- El cliente quedará SIN SERVICIO durante 2-3 minutos
- Solo usar cuando sea necesario para resolver problemas
- Confirmar con el cliente antes de reiniciar

FLUJO RECOMENDADO:
1. Primero usar get_onu_diagnostic para verificar el problema
2. Solo reiniciar si el diagnóstico indica que podría ayudar
3. Informar al cliente que tardará 2-3 minutos

REQUIERE: onuId (ID externo de la ONU, obtenido del diagnóstico)`,
    
    execute: async (args) => {
      const result = await rebootOnu({ onuId: args.onuId });
      
      if (!result.success) {
        throw new Error(result.error || 'No se pudo reiniciar');
      }
      
      return {
        success: true,
        message: result.message,
        warning: 'El cliente estará sin servicio ~2-3 minutos mientras la ONU se reinicia.',
      };
    },
    
    tags: ['onu', 'reboot', 'smartolt'],
    requiresAuth: true,
  }),

  get_unconfigured_onus: defineTool(unconfiguredSchema, {
    description: `Lista las ONUs detectadas por las OLTs pero NO autorizadas en el sistema.

USOS:
- Ver equipos nuevos pendientes de configurar
- Verificar si una ONU específica necesita autorización
- Filtrar por OLT, serial o tipo de ONU

Una ONU aparece aquí cuando:
- Es un equipo nuevo recién conectado
- Fue reseteada de fábrica
- Fue eliminada del sistema pero sigue conectada`,
    
    execute: async (args) => {
      const result = await getUnconfiguredOnus({
        oltId: args.oltId,
        serial: args.serial,
        onuType: args.onuType,
      });
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Error consultando ONUs');
      }
      
      return {
        success: true,
        total: result.data.total,
        onus: result.data.onus,
        message: result.data.total === 0 
          ? 'No hay ONUs sin configurar'
          : `Encontradas ${result.data.total} ONUs sin configurar`,
      };
    },
    
    tags: ['onu', 'unconfigured', 'smartolt'],
    requiresAuth: true,
  }),


  get_olts_list: defineTool(emptySchema, {
    description: `Lista todos los OLTs disponibles en el sistema.

Útil para obtener el ID del OLT necesario para:
- Autorizar ONUs
- Filtrar ONUs no configuradas`,
    
    execute: async () => {
      const result = await getOltsList();
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Error obteniendo OLTs');
      }
      
      return {
        success: true,
        count: result.data.length,
        olts: result.data,
      };
    },
    
    tags: ['olt', 'list', 'smartolt'],
    requiresAuth: true,
  }),

  get_zones_list: defineTool(emptySchema, {
    description: `Lista todas las zonas disponibles en SmartOLT.

Las zonas representan ubicaciones geográficas y son necesarias
para autorizar ONUs con ubicación correcta.`,
    
    execute: async () => {
      const result = await getZonesList();
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Error obteniendo zonas');
      }
      
      return {
        success: true,
        count: result.data.length,
        zones: result.data,
      };
    },
    
    tags: ['zone', 'list', 'smartolt'],
    requiresAuth: true,
  }),

  get_onu_types_list: defineTool(emptySchema, {
    description: `Lista todos los tipos de ONU configurados en SmartOLT.

Los tipos de ONU definen el modelo del equipo y son necesarios
para autorizar ONUs con la configuración correcta.`,
    
    execute: async () => {
      const result = await getOnuTypesList();
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Error obteniendo tipos');
      }
      
      return {
        success: true,
        count: result.data.length,
        onuTypes: result.data,
      };
    },
    
    tags: ['onutype', 'list', 'smartolt'],
    requiresAuth: true,
  }),

  find_unconfigured_onu: defineTool(findUnconfiguredSchema, {
    description: `Verifica si una ONU específica está en la lista de no configuradas.

CUÁNDO USAR:
- Cliente reporta internet intermitente y la ONU podría haber perdido configuración
- Verificar rápidamente si una ONU necesita ser re-autorizada
- Antes de iniciar el proceso completo de autorización

QUÉ RETORNA:
- Si la ONU fue encontrada como no configurada: datos de ubicación (OLT, board, puerto)
- Si NO fue encontrada: puede estar ya configurada o no detectada por la OLT

DIFERENCIA con get_unconfigured_onus:
- Esta herramienta busca UNA ONU específica por serial
- get_unconfigured_onus lista TODAS las ONUs no configuradas (con filtros opcionales)

NO confundir con el flujo de autorización (authorize_onu).
Esta herramienta es SOLO de consulta, no modifica nada.`,
    
    execute: async (args) => {
      const result = await findUnconfiguredOnu(args.serial, args.oltId);
      
      if (!result.success) {
        throw new Error(result.error || 'Error buscando ONU');
      }
      
      return {
        success: true,
        found: result.data?.found || false,
        onu: result.data?.onu || null,
        message: result.data?.message || 'Sin resultado',
      };
    },
    
    tags: ['onu', 'unconfigured', 'search', 'smartolt'],
    requiresAuth: true,
  }),
});
