
import { z } from 'zod';
import { defineTool, defineToolGroup } from './types.js';
import {
  searchKnowledgeBase,
  addKnowledge,
  getKnowledgeStats,
} from '../services/knowledge.js';

const searchSchema = z.object({
  query: z.string().describe('Texto de búsqueda'),
  limit: z.number().min(1).max(20).optional().default(5)
    .describe('Máximo de resultados'),
  threshold: z.number().min(0).max(1).optional().default(0.5)
    .describe('Umbral de similitud mínima (0-1)'),
});

const addDocSchema = z.object({
  content: z.string().describe('Contenido del documento'),
  title: z.string().optional().describe('Título del documento'),
  source: z.string().optional().describe('Fuente/origen'),
  chunkSize: z.number().optional().default(1000)
    .describe('Tamaño de cada chunk'),
  chunkOverlap: z.number().optional().default(200)
    .describe('Solapamiento entre chunks'),
});

const emptySchema = z.object({});

export const ragTools = defineToolGroup('rag', {
  
  search_knowledge_base: defineTool(searchSchema, {
    description: `Busca documentos relevantes en la knowledge base usando similitud semántica.

CUÁNDO USAR:
- Preguntas sobre políticas, procedimientos, tarifas
- Información técnica sobre servicios
- FAQs y respuestas comunes

RETORNA documentos ordenados por relevancia (0-1, mayor es mejor).
Si highConfidence=true, el primer resultado tiene >90% de similitud y 
probablemente responde la pregunta completa sin necesidad de consultar APIs externas.`,
    
    execute: async (args) => {
      const results = await searchKnowledgeBase({
        query: args.query,
        limit: args.limit ?? 5,
        threshold: args.threshold ?? 0.5,
      });
      
      const topSimilarity = results.length > 0 ? results[0].similarity : 0;
      const highConfidence = topSimilarity >= 0.9;
      
      return {
        query: args.query,
        resultCount: results.length,
        highConfidence,
        ...(highConfidence && {
          hint: 'Alta confianza: el primer resultado probablemente responde la pregunta completa. No es necesario consultar APIs externas.',
        }),
        results: results.map((r) => ({
          content: r.content,
          title: r.title,
          source: r.source,
          relevance: Math.round(r.similarity * 100) + '%',
        })),
      };
    },
    
    tags: ['search', 'knowledge', 'semantic'],
  }),

  add_to_knowledge_base: defineTool(addDocSchema, {
    description: `Agrega un documento a la knowledge base.

El documento se divide automáticamente en chunks y se generan embeddings
para cada uno, permitiendo búsqueda semántica posterior.

PARÁMETROS DE CHUNKING:
- chunkSize: Tamaño de cada chunk (default: 1000 caracteres)
- chunkOverlap: Solapamiento entre chunks (default: 200 caracteres)`,
    
    execute: async (args) => {
      const result = await addKnowledge({
        content: args.content,
        title: args.title,
        source: args.source,
        chunkSize: args.chunkSize ?? 1000,
        chunkOverlap: args.chunkOverlap ?? 200,
      });
      
      return {
        documentId: result.parentId,
        chunksCreated: result.chunksCreated,
        message: `Documento agregado con ${result.chunksCreated} chunks`,
      };
    },
    
    tags: ['create', 'knowledge', 'document'],
  }),

  get_knowledge_stats: defineTool(emptySchema, {
    description: `Obtiene estadísticas de la knowledge base.

Retorna:
- Total de documentos
- Total de chunks
- Distribución por fuente
- Fecha del último documento`,
    
    execute: async () => {
      const stats = await getKnowledgeStats();
      return stats;
    },
    
    tags: ['stats', 'knowledge'],
  }),
});
