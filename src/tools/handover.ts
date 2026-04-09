
import { z } from 'zod';
import { defineTool, defineToolGroup } from './types.js';
import { updateSummary } from '../services/conversation.js';
import {
  escalateToSpecialist,
  takeoverConversation,
  closeConversation,
  pauseConversation,
  getConversationStatus,
} from '../services/handover.js';

const updateSummarySchema = z.object({
  sessionId: z.string().describe('ID único de la sesión'),
  summary: z.string().describe('Resumen de la conversación'),
});

const escalateSchema = z.object({
  sessionId: z.string().describe('ID único de la sesión'),
  reason: z.string().describe('Razón del escalamiento'),
  summary: z.string().optional().describe('Resumen actualizado'),
});

const sessionIdSchema = z.object({
  sessionId: z.string().describe('ID único de la sesión'),
});

const pauseSchema = z.object({
  sessionId: z.string().describe('ID único de la sesión'),
  reason: z.string().describe('Razón por la cual se pausa la conversación'),
  createTicket: z.boolean().optional().default(true)
    .describe('Si crear ticket en GLPI automáticamente (default: true)'),
  ticketTypeId: z.coerce.number().int().positive().optional()
    .describe('ID del tipo de ticket (del catálogo). Acepta número o string numérico; resuelve categoría ITIL y urgencia automáticamente'),
  specialistName: z.string().optional()
    .describe('Nombre del especialista que pausa. Se guarda si la conversación no tiene specialist_name'),
  specialistEmail: z.string().optional()
    .describe('Email del especialista que pausa'),
});

const closeSchema = z.object({
  sessionId: z.string().describe('ID único de la sesión'),
  resolution: z.string().min(10)
    .describe('Descripción de cómo se resolvió (obligatorio, min 10 chars)'),
  closedBy: z.enum(['system', 'agent', 'user']).optional().default('system')
    .describe('Quién cierra: system=IA/automático, agent=especialista, user=cliente'),
  createTicket: z.boolean().optional().default(true)
    .describe('Si crear ticket GLPI al cerrar (solo aplica si no existe ticket previo). Default: true, deja constancia'),
  ticketTypeId: z.coerce.number().int().positive().optional()
    .describe('ID del tipo de ticket (solo si createTicket=true y no hay ticket previo). Acepta número o string numérico'),
  specialistName: z.string().optional()
    .describe('Nombre del especialista que cierra. Se guarda si la conversación no tiene specialist_name'),
  specialistEmail: z.string().optional()
    .describe('Email del especialista que cierra'),
});

const takeoverSchema = z.object({
  sessionId: z.string().describe('ID único de la sesión'),
  specialistEmail: z.string().describe('Email del especialista'),
  specialistName: z.string().describe('Nombre del especialista'),
  createTicket: z.boolean().optional().default(true)
    .describe('Si crear ticket GLPI como constancia al tomar (default: true)'),
  ticketTypeId: z.coerce.number().int().positive().optional()
    .describe('ID del tipo de ticket (del catálogo). Acepta número o string numérico; resuelve categoría ITIL y urgencia automáticamente'),
  reason: z.string().optional()
    .describe('Razón o contexto de por qué se toma la conversación. Se incluye en el ticket GLPI'),
});

export const handoverTools = defineToolGroup('handover', {
  
  update_summary: defineTool(updateSummarySchema, {
    description: `Actualiza el resumen de la conversación.

El resumen es útil para:
- Dar contexto rápido a especialistas
- Historial de qué se ha tratado
- Se incluye en tickets GLPI como referencia

LLAMAR cuando:
- El cliente identificó su problema
- Se llegó a una resolución
- Hay información importante que resumir`,

    execute: async (args) => {
      await updateSummary(args.sessionId, args.summary);
      return { success: true, message: 'Resumen actualizado' };
    },

    tags: ['conversation', 'summary', 'update'],
  }),

  escalate_to_specialist: defineTool(escalateSchema, {
    description: `Escala la conversación a un especialista.

CAMBIO DE ESTADO: active → waiting_specialist

REQUISITOS:
- Debe tener información de contacto (nombre + teléfono o email)

CUÁNDO ESCALAR:
- Problema técnico que requiere visita
- Cliente insatisfecho que necesita atención especial
- Consultas de facturación complejas
- Casos que el bot no puede resolver

PRIORIDADES (se persisten y afectan la urgencia del ticket GLPI):
- low: Consultas generales o sin urgencia
- medium: Problemas de servicio activos (default)
- high: Cliente sin servicio / urgente
- critical: Múltiples clientes afectados / emergencia

NOTA: La prioridad se guarda y se usa como urgencia base del ticket GLPI.
Si luego se pasa ticketTypeId en pause/close, este sobreescribe la urgencia.`,

    execute: async (args) => {
      const result = await escalateToSpecialist({
        sessionId: args.sessionId,
        reason: args.reason,
        summary: args.summary,
      });

      if (!result.success) {
        return {
          success: false,
          message: result.message,
          missingInfo: result.missingInfo,
          hint: 'Usa update_client_info para agregar datos de contacto antes de escalar',
        };
      }

      return {
        success: true,
        message: result.message,
        status: result.conversation.status,
      };
    },

    tags: ['escalation', 'handover', 'human'],
  }),

  get_conversation_status: defineTool(sessionIdSchema, {
    description: `Obtiene el estado actual de una conversación.

ESTADOS DE CONVERSACIÓN (independientes de GLPI):
- active: Conversación en curso con el bot
- waiting_specialist: Escalada, esperando especialista
- handed_over: Especialista atendiendo
- paused: Pausada por especialista (puede o no tener ticket GLPI)
- closed: Conversación cerrada

INFO ADICIONAL:
- glpiTicketId: ID del ticket GLPI asociado (null si no tiene)
- Los estados de conversación y GLPI son independientes`,

    execute: async (args) => {
      const status = await getConversationStatus(args.sessionId);

      if (!status) {
        return { success: true, exists: false, message: 'Conversación no encontrada' };
      }

      return { success: true, exists: true, ...status };
    },

    tags: ['conversation', 'status', 'read'],
  }),

  pause_conversation: defineTool(pauseSchema, {
    description: `Pausa una conversación. Opcionalmente crea ticket GLPI.

CAMBIO DE ESTADO: cualquiera → paused

El estado de la conversación SIEMPRE cambia a 'paused', independientemente de si GLPI funciona o no.

GLPI (opcional):
- Por defecto createTicket=true → crea ticket con datos del cliente, resumen, historial
- Pasar ticketTypeId o ticketTypeName para clasificar y asignar urgencia correcta (VER CATÁLOGO ABAJO)
- Si no llega ninguno, el servidor intenta inferir el tipo por razón, resumen e historial reciente
- Si NO se pasa ticketTypeId, la urgencia se toma de la prioridad de escalación guardada
- Si GLPI falla, la conversación sigue pausada (GLPI no bloquea)

CUÁNDO USAR (especialista):
- Necesita interrumpir la conversación
- Se requiere visita técnica o seguimiento posterior

TIPOS DE TICKET MÁS COMUNES (pasar como ticketTypeId):
  1=ONU Rojo(5) | 2=Intermitencia(3) | 7=Sin internet(5) | 12=Cambio de plan(4)
  13=Cancelación(5) | 16=Reactivación(5) | 17=Reclamo admin(5) | 18=Consulta factura(5)
  28=Reportes de pago(5) | 53=Atención ineficiente(5) | 54=Caída servicio(5)
  83=Cliente molesto(5) | 85=Sin respuesta(4)
  → Para ver los 93 tipos completos: recurso ticket-types://catalog

URGENCIA: 1=Muy baja | 2=Baja | 3=Media | 4=Alta | 5=Mayor (solo override manual)`,

    execute: async (args) => {
      const result = await pauseConversation({
        sessionId: args.sessionId,
        reason: args.reason,
        createTicket: args.createTicket,
        specialistName: args.specialistName,
        specialistEmail: args.specialistEmail,
      });

      return {
        success: result.success,
        message: result.message,
        status: result.conversation.status,
        glpiTicketId: result.conversation.glpi_ticket_id,
        ticket: result.ticket ? {
          created: result.ticket.success,
          ticketId: result.ticket.ticketId,
          error: result.ticket.error,
        } : undefined,
      };
    },

    tags: ['conversation', 'pause', 'glpi', 'ticket'],
  }),

  close_conversation: defineTool(closeSchema, {
    description: `Cierra una conversación con resolución obligatoria.

CAMBIO DE ESTADO: cualquiera → closed

El estado de la conversación SIEMPRE cambia a 'closed', independientemente de GLPI.

GLPI (comportamiento automático):
- Si la conversación YA tiene ticket GLPI (fue pausada antes) → cierra el ticket con la solución
- Si NO tiene ticket previo y createTicket=true (default) → crea ticket + solución + cierra
- Si GLPI falla, la conversación sigue cerrada

CUÁNDO USAR:
- La IA resolvió el problema → closedBy='system', pasar ticketTypeId según el tema
- Especialista cierra tras atender → closedBy='agent'
- Cliente indica que no necesita más ayuda → closedBy='user'

IMPORTANTE: Prioriza pasar ticketTypeId o ticketTypeName para fijar categoría y urgencia correctas.
Si no llega ninguno, el servidor intenta inferir el tipo por resolución, resumen e historial.

TIPOS DE TICKET MÁS COMUNES (pasar como ticketTypeId según el problema resuelto):
  1=ONU Rojo(5) | 2=Intermitencia(3) | 7=Sin internet(5) | 12=Cambio de plan(4)
  13=Cancelación(5) | 14=Consultas admin(4) | 16=Reactivación(5) | 17=Reclamo admin(5)
  18=Consulta factura(5) | 20=Datos bancarios(3) | 21=Facturas pendientes(3)
  24=Registros de pago(2) | 28=Reportes pago(5) | 31=Prueba velocidad(3)
  83=Cliente molesto(5) | 84=Desconocimiento cliente(5) | 85=Sin respuesta(4)
  → Para todos los tipos: recurso ticket-types://catalog

RESOLUCIÓN: Obligatoria, mínimo 10 caracteres. Describe cómo se resolvió.`,

    execute: async (args) => {
      const result = await closeConversation({
        sessionId: args.sessionId,
        resolution: args.resolution,
        closedBy: args.closedBy || 'system',
        createTicket: args.createTicket,
        specialistName: args.specialistName,
        specialistEmail: args.specialistEmail,
      });

      return {
        success: result.success,
        message: result.message,
        status: result.conversation.status,
        glpiTicketId: result.conversation.glpi_ticket_id,
        ticket: result.ticket ? {
          processed: result.ticket.success,
          ticketId: result.ticket.ticketId,
          error: result.ticket.error,
        } : undefined,
      };
    },

    tags: ['conversation', 'close', 'complete', 'glpi'],
  }),

  takeover_conversation: defineTool(takeoverSchema, {
    description: `Un especialista toma control de la conversación.

CAMBIO DE ESTADO: waiting_specialist → handed_over

Registra qué especialista está atendiendo.

GLPI (opcional):
- Por defecto createTicket=true → crea ticket como constancia de la toma con datos del cliente, resumen e historial
- Pasar createTicket=false si no se necesita ticket
- Si GLPI falla, la toma sigue (GLPI no bloquea)
- Pasar ticketTypeId o ticketTypeName para clasificar (del catálogo de 93 tipos)
- Si no llega ninguno, el servidor intenta inferirlo con el contexto disponible
- Pasar reason para incluir contexto en el ticket`,

    execute: async (args) => {
      const result = await takeoverConversation({
        sessionId: args.sessionId,
        specialistEmail: args.specialistEmail,
        specialistName: args.specialistName,
        createTicket: args.createTicket,
        reason: args.reason,
      });

      return {
        success: true,
        message: result.message,
        status: result.conversation.status,
        specialistId: result.conversation.specialist_id,
        glpiTicketId: result.conversation.glpi_ticket_id,
        ticket: result.ticket ? {
          created: result.ticket.success,
          ticketId: result.ticket.ticketId,
          error: result.ticket.error,
        } : undefined,
      };
    },

    tags: ['escalation', 'handover', 'takeover', 'glpi', 'ticket'],
  }),
});
