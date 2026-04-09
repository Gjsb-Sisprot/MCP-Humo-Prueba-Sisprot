
import { z } from 'zod';
import { defineTool, defineToolGroup } from './types.js';
import { 
  saveInteraction, 
  getConversationHistory,
  updateClientInfo,
} from '../services/conversation.js';
import {
  setSessionState,
  getSessionState,
  deleteSessionState,
  clearSessionStates,
  setMultipleSessionStates,
  incrementSessionState,
  getSessionStatesSummary,
} from '../services/session-state.js';

const saveInteractionSchema = z.object({
  sessionId: z.string().describe('ID único de la sesión'),
  userId: z.string().optional().describe('ID del usuario propietario (para aislar conversaciones)'),
  role: z.enum(['user', 'model', 'assistant', 'system', 'tool']).describe('Rol del mensaje'),
  content: z.string().describe('Contenido del mensaje'),
  toolName: z.string().optional().describe('Nombre de la herramienta (si role=tool)'),
  toolCallId: z.string().optional().describe('ID de la llamada de herramienta asociada'),
  identification: z.string().optional().describe('RIF o cédula del cliente'),
  contract: z.string().optional().describe('Número de contrato'),
  sector: z.string().optional().describe('Ubicación o sector del cliente'),
  contactName: z.string().optional().describe('Nombre de contacto del cliente'),
  contactEmail: z.string().optional().describe('Email de contacto del cliente'),
  contactPhone: z.string().optional().describe('Teléfono de contacto del cliente'),
});

const getHistorySchema = z.object({
  sessionId: z.string().describe('ID único de la sesión'),
  limit: z.number().min(1).max(100).optional().default(50).describe('Máximo de mensajes'),
});

const updateClientInfoSchema = z.object({
  sessionId: z.string().describe('ID único de la sesión'),
  identification: z.string().optional().describe('RIF o cédula'),
  contract: z.string().optional().describe('Número de contrato'),
  sector: z.string().optional().describe('Ubicación/barrio'),
  contactName: z.string().optional().describe('Nombre de contacto'),
  contactEmail: z.string().optional().describe('Email'),
  contactPhone: z.string().optional().describe('Teléfono'),
});

const setStateSchema = z.object({
  sessionId: z.string().describe('ID único de la sesión'),
  key: z.string().describe('Clave del estado (usar namespacing: "workflow:step")'),
  value: z.unknown().describe('Valor a guardar (cualquier JSON válido)'),
  expiresInMinutes: z.number().min(1).nullable().optional()
    .describe('Minutos hasta expirar (null=permanente, default=60). Presets: 5=quick, 30=workflow, 60=session, 480=workday, 1440=escalation'),
});

const getStateSchema = z.object({
  sessionId: z.string().describe('ID único de la sesión'),
  key: z.string().describe('Clave del estado a obtener'),
});

const deleteStateSchema = z.object({
  sessionId: z.string().describe('ID único de la sesión'),
  key: z.string().describe('Clave del estado a eliminar'),
});

const sessionIdSchema = z.object({
  sessionId: z.string().describe('ID único de la sesión'),
});

const setMultipleSchema = z.object({
  sessionId: z.string().describe('ID único de la sesión'),
  states: z.array(z.object({
    key: z.string().describe('Clave del estado'),
    value: z.unknown().describe('Valor a guardar'),
    expiresInMinutes: z.number().min(1).nullable().optional().describe('TTL en minutos'),
  })).describe('Array de estados a guardar'),
});

const incrementSchema = z.object({
  sessionId: z.string().describe('ID único de la sesión'),
  key: z.string().describe('Clave del contador'),
  delta: z.number().optional().default(1).describe('Cantidad a incrementar (default: 1, usar negativo para decrementar)'),
  initialValue: z.number().optional().default(0).describe('Valor inicial si el contador no existe (default: 0)'),
  expiresInMinutes: z.number().min(1).nullable().optional().describe('TTL en minutos (solo aplica si no existía)'),
});

export const memoryTools = defineToolGroup('memory', {
  
  save_interaction: defineTool(saveInteractionSchema, {
    description: `Guarda un mensaje en el historial de la conversación.

ROLES DISPONIBLES:
- user: Mensaje del cliente
- model/assistant: Respuesta del asistente
- system: Mensaje del sistema
- tool: Resultado de herramienta

Se usa para mantener el contexto de la conversación entre requests.`,
    
    execute: async (args) => {
      const result = await saveInteraction({
        sessionId: args.sessionId,
        userId: args.userId,
        role: args.role,
        content: args.content,
        toolName: args.toolName,
        toolCallId: args.toolCallId,
        identification: args.identification,
        contract: args.contract,
        sector: args.sector,
        contactName: args.contactName,
        contactEmail: args.contactEmail,
        contactPhone: args.contactPhone,
      });
      
      return {
        success: true,
        messageId: result.id,
        message: 'Mensaje guardado correctamente',
      };
    },
    
    tags: ['conversation', 'history', 'save'],
  }),

  get_conversation_history: defineTool(getHistorySchema, {
    description: `Obtiene el historial de mensajes de una sesión.

Retorna los últimos N mensajes en orden cronológico,
junto con información de la conversación (estado, identificación, etc).`,
    
    execute: async (args) => {
      const result = await getConversationHistory({
        sessionId: args.sessionId,
        limit: args.limit ?? 50,
      });
      
      return {
        success: true,
        conversation: result.conversation ? {
          status: result.conversation.status,
          identification: result.conversation.identification,
          contract: result.conversation.contract,
          sector: result.conversation.sector,
          contactName: result.conversation.contact_name,
          contactEmail: result.conversation.contact_email,
          contactPhone: result.conversation.contact_phone,
          summary: result.conversation.summary,
        } : null,
        messageCount: result.messages.length,
        messages: result.messages,
      };
    },
    
    tags: ['conversation', 'history', 'read'],
  }),

  update_client_info: defineTool(updateClientInfoSchema, {
    description: `Actualiza la información del cliente en la conversación.

CAMPOS:
- identification: RIF o cédula (ej: J-12345678)
- contract: Número de contrato
- sector: Ubicación/barrio del cliente
- contactName: Nombre de contacto
- contactEmail: Email de contacto
- contactPhone: Teléfono de contacto

Los datos de contacto son REQUERIDOS para escalar a un agente.`,
    
    execute: async (args) => {
      const result = await updateClientInfo({
        sessionId: args.sessionId,
        identification: args.identification,
        contract: args.contract,
        sector: args.sector,
        contactName: args.contactName,
        contactEmail: args.contactEmail,
        contactPhone: args.contactPhone,
      });
      
      return {
        success: true,
        clientInfo: {
          identification: result.identification,
          contract: result.contract,
          sector: result.sector,
          contactName: result.contact_name,
          contactEmail: result.contact_email,
          contactPhone: result.contact_phone,
        },
      };
    },
    
    tags: ['conversation', 'client', 'update'],
  }),

  set_session_state: defineTool(setStateSchema, {
    description: `Guarda un valor temporal asociado a la sesión (key-value con TTL).

CASOS DE USO:
- workflow:current_step → Paso actual de un flujo multi-step
- client:id → ID del cliente identificado durante la conversación
- escalation:reason → Razón de escalación pendiente
- flag:awaiting_confirmation → Esperando confirmación del usuario
- cache:onu_data → Cache de datos de ONU consultados

TTL PRESETS (minutos):
- QUICK: 5 (confirmaciones rápidas)
- WORKFLOW: 30 (flujos de proceso)
- SESSION: 60 (datos de sesión normal, DEFAULT)
- WORKDAY: 480 (8 horas)
- ESCALATION: 1440 (24 horas)
- null: Sin expiración (eliminar manualmente)

MEJORES PRÁCTICAS:
- Usar namespacing en keys: "workflow:step", "client:contract"
- TTL corto para datos temporales, largo para contexto crítico
- Limpiar estados cuando ya no se necesitan`,
    
    execute: async (args) => {
      const ttl = args.expiresInMinutes === undefined ? 60 : args.expiresInMinutes;
      
      await setSessionState({
        sessionId: args.sessionId,
        key: args.key,
        value: args.value,
        expiresInMinutes: ttl,
      });
      
      return {
        success: true,
        message: `Estado '${args.key}' guardado`,
        ttlMinutes: ttl,
        expiresAt: ttl ? new Date(Date.now() + ttl * 60 * 1000).toISOString() : null,
      };
    },
    
    tags: ['state', 'session', 'save'],
  }),

  get_session_state: defineTool(getStateSchema, {
    description: `Obtiene un valor temporal de la sesión.

Retorna null si:
- La clave no existe
- El valor expiró

TIP: Usa get_all_session_states para ver todo el contexto guardado.`,
    
    execute: async (args) => {
      const value = await getSessionState({
        sessionId: args.sessionId,
        key: args.key,
      });
      
      return {
        success: true,
        key: args.key,
        value,
        exists: value !== null,
      };
    },
    
    tags: ['state', 'session', 'read'],
  }),

  delete_session_state: defineTool(deleteStateSchema, {
    description: `Elimina un valor temporal de la sesión.

CUÁNDO USAR:
- Al completar un flujo de trabajo
- Cuando el cliente se identifica con nueva info
- Para limpiar flags que ya no aplican`,
    
    execute: async (args) => {
      const deleted = await deleteSessionState({
        sessionId: args.sessionId,
        key: args.key,
      });
      
      return {
        success: true,
        deleted,
        message: deleted ? `Estado '${args.key}' eliminado` : `Estado '${args.key}' no existía`,
      };
    },
    
    tags: ['state', 'session', 'delete'],
  }),

  get_all_session_states: defineTool(sessionIdSchema, {
    description: `Obtiene TODOS los estados temporales de una sesión con metadata.

ÚTIL PARA:
- Ver todo el contexto guardado
- Debugging de flujos
- Antes de escalar a especialista (pasar contexto completo)

Retorna:
- states: Objeto key-value simple
- statesWithMeta: Array con TTL restante, fechas, etc.`,
    
    execute: async (args) => {
      const summary = await getSessionStatesSummary(args.sessionId);
      
      return {
        success: true,
        ...summary,
        hint: summary.totalStates === 0 
          ? 'No hay estados guardados para esta sesión'
          : `${summary.totalStates} estado(s) encontrado(s)`,
      };
    },
    
    tags: ['state', 'session', 'read'],
  }),

  clear_session_states: defineTool(sessionIdSchema, {
    description: `Elimina TODOS los estados temporales de una sesión.

CUÁNDO USAR:
- Al cerrar una conversación
- Al iniciar un nuevo flujo desde cero
- Para resetear el contexto

⚠️ CUIDADO: Esta acción no se puede deshacer.`,
    
    execute: async (args) => {
      const deletedCount = await clearSessionStates(args.sessionId);
      
      return {
        success: true,
        deletedCount,
        message: deletedCount > 0 
          ? `${deletedCount} estado(s) eliminado(s)`
          : 'No había estados para eliminar',
      };
    },
    
    tags: ['state', 'session', 'delete'],
  }),

  set_multiple_states: defineTool(setMultipleSchema, {
    description: `Guarda múltiples estados en una sola operación.

ÚTIL PARA:
- Inicializar contexto de flujo (paso, datos, timestamp)
- Guardar datos de cliente identificado (id, nombre, contrato)
- Actualizar múltiples flags a la vez

Ejemplo:
{
  "sessionId": "wa-123",
  "states": [
    {"key": "workflow:step", "value": "verificando_onu", "expiresInMinutes": 30},
    {"key": "client:id", "value": "12345", "expiresInMinutes": 60}
  ]
}`,
    
    execute: async (args) => {
      const count = await setMultipleSessionStates({
        sessionId: args.sessionId,
        states: args.states,
      });
      
      return {
        success: true,
        savedCount: count,
        keys: args.states.map(s => s.key),
        message: `${count} estado(s) guardado(s)`,
      };
    },
    
    tags: ['state', 'session', 'batch'],
  }),

  increment_session_state: defineTool(incrementSchema, {
    description: `Incrementa un contador numérico atómicamente.

ÚTIL PARA:
- flag:retry_count → Contar reintentos
- counter:messages → Contar mensajes
- counter:errors → Contar errores consecutivos

El contador se inicializa en 0 si no existe.`,
    
    execute: async (args) => {
      const newValue = await incrementSessionState({
        sessionId: args.sessionId,
        key: args.key,
        delta: args.delta ?? 1,
        initialValue: args.initialValue ?? 0,
        expiresInMinutes: args.expiresInMinutes,
      });
      
      return {
        success: true,
        key: args.key,
        newValue,
        delta: args.delta ?? 1,
      };
    },
    
    tags: ['state', 'session', 'counter'],
  }),
});
