
import { z } from 'zod';
import { defineTool, defineToolGroup } from './types.js';
import {
  listConversations,
  searchConversations,
  getPendingConversations,
  getActiveConversations,
  getSpecialistStats,
} from '../services/search.js';

const listSchema = z.object({
  userId: z.string().optional().describe('Filtrar por usuario propietario'),
  status: z.enum(['active', 'paused', 'waiting_specialist', 'handed_over', 'closed']).optional()
    .describe('Filtrar por estado'),
  limit: z.number().min(1).max(100).optional().default(20).describe('Máximo de resultados'),
  offset: z.number().min(0).optional().default(0).describe('Offset para paginación'),
  orderBy: z.enum(['created_at', 'updated_at']).optional().default('updated_at'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

const searchSchema = z.object({
  userId: z.string().optional().describe('Filtrar por usuario propietario'),
  identification: z.string().optional().describe('RIF o cédula'),
  contract: z.string().optional().describe('Número de contrato'),
  sector: z.string().optional().describe('Sector/zona'),
  limit: z.number().min(1).max(100).optional().default(20),
});

const emptySchema = z.object({});

const specialistSchema = z.object({
  specialistEmail: z.string().describe('Email del especialista'),
});

export const searchTools = defineToolGroup('search', {
  
  list_conversations: defineTool(listSchema, {
    description: `Lista conversaciones con filtros y paginación.

FILTROS:
- status: Filtrar por estado
- orderBy: created_at o updated_at
- order: asc o desc

Retorna conversaciones con count de mensajes.`,
    
    execute: async (args) => {
      const result = await listConversations({
        userId: args.userId,
        status: args.status,
        limit: args.limit,
        offset: args.offset,
        orderBy: args.orderBy,
        order: args.order,
      });
      
      return {
        success: true,
        total: result.total,
        count: result.conversations.length,
        conversations: result.conversations,
      };
    },
    
    tags: ['conversation', 'list', 'filter'],
  }),

  search_conversations: defineTool(searchSchema, {
    description: `Busca conversaciones por identificación, contrato o sector.

ÚTIL PARA:
- Encontrar historial de un cliente
- Ver conversaciones de una zona
- Buscar por número de contrato`,
    
    execute: async (args) => {
      const results = await searchConversations({
        userId: args.userId,
        identification: args.identification,
        contract: args.contract,
        sector: args.sector,
        limit: args.limit,
      });
      
      return {
        success: true,
        count: results.length,
        conversations: results,
      };
    },
    
    tags: ['conversation', 'search', 'client'],
  }),

  get_pending_conversations: defineTool(emptySchema, {
    description: `Obtiene conversaciones esperando ser atendidas por un especialista.

Estado: waiting_specialist

Útil para el panel de especialistas.`,
    
    execute: async () => {
      const conversations = await getPendingConversations();
      
      return {
        success: true,
        count: conversations.length,
        conversations,
      };
    },
    
    tags: ['conversation', 'pending', 'queue'],
  }),

  get_active_conversations: defineTool(emptySchema, {
    description: `Obtiene conversaciones activas (en curso con el bot).

Estado: active`,
    
    execute: async () => {
      const conversations = await getActiveConversations();
      
      return {
        success: true,
        count: conversations.length,
        conversations,
      };
    },
    
    tags: ['conversation', 'active', 'bot'],
  }),

  get_specialist_stats: defineTool(specialistSchema, {
    description: `Obtiene estadísticas de un especialista.

RETORNA:
- Conversaciones activas asignadas
- Conversaciones cerradas hoy`,
    
    execute: async (args) => {
      const stats = await getSpecialistStats(args.specialistEmail);
      
      return {
        success: true,
        specialistEmail: args.specialistEmail,
        stats,
      };
    },
    
    tags: ['specialist', 'stats', 'metrics'],
  }),
});
