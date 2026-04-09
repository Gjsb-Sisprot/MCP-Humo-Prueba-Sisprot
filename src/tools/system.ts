import { z } from 'zod';
import { defineTool, defineToolGroup } from './types.js';
import { getKnowledgeStats } from '../services/knowledge.js';

const emptySchema = z.object({});

export const systemTools = defineToolGroup('system', {
  get_system_status: defineTool(emptySchema, {
    description: 'Obtiene el estado actual del sistema MCP SISPROT: versión, capacidades, endpoints',
    execute: async () => {
      const sisprotConfigured = !!(process.env.SISPROT_API_URL && process.env.SISPROT_API_KEY);
      const smartoltConfigured = !!(process.env.SMARTOLT_API_URL && process.env.SMARTOLT_API_KEY);
      
      return {
        success: true,
        status: {
          name: 'SISPROT MCP Server (Hono)',
          version: '1.0.0',
          status: 'operational',
          timestamp: new Date().toISOString(),
          capabilities: {
            memory: true,
            rag: true,
            handover: true,
            smartolt: smartoltConfigured,
            sisprot: sisprotConfigured,
          },
        }
      };
    },
    tags: ['system', 'status'],
    requiresAuth: true,
  }),

  get_knowledge_stats: defineTool(emptySchema, {
    description: 'Obtiene estadísticas de la base de conocimientos: total documentos, chunks, fuentes',
    execute: async () => {
      const stats = await getKnowledgeStats();
      return { success: true, stats };
    },
    tags: ['system', 'knowledge', 'stats'],
    requiresAuth: true,
  })
});
