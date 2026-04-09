
import { z } from 'zod';
import { sql } from '../db/index.js';
import { generateQueryEmbedding, generateDocumentEmbedding } from '../lib/embeddings.js';
import { knowledgeCache } from '../lib/cache.js';
import type { KnowledgeBase } from '../db/types.js';

export const searchKnowledgeSchema = z.object({
  query: z.string().min(1),
  limit: z.number().min(1).max(20).optional().default(5),
  threshold: z.number().min(0).max(1).optional().default(0.3),
});

export const addKnowledgeSchema = z.object({
  content: z.string().min(1),
  title: z.string().optional(),
  source: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  chunkSize: z.number().min(100).max(4000).default(1000),
  chunkOverlap: z.number().min(0).max(500).default(200),
});

export type SearchKnowledgeInput = z.infer<typeof searchKnowledgeSchema>;
export type AddKnowledgeInput = z.infer<typeof addKnowledgeSchema>;

export interface KnowledgeSearchResult {
  id: number;
  content: string;
  title: string | null;
  source: string | null;
  similarity: number;
}

export async function searchKnowledgeBase(input: SearchKnowledgeInput): Promise<KnowledgeSearchResult[]> {
  const startTime = performance.now();
  const { query, limit, threshold } = searchKnowledgeSchema.parse(input);
  
  const cacheKey = `search:${query}:${limit}:${threshold}`;
  const cached = knowledgeCache.get(cacheKey) as KnowledgeSearchResult[] | undefined;
  if (cached) {
    return cached;
  }
  
  const embStart = performance.now();
  const queryEmbedding = await generateQueryEmbedding(query);
  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  const embMs = (performance.now() - embStart).toFixed(1);
  
  const dbStart = performance.now();
  const rawResults = await sql<(KnowledgeBase & { similarity: number })[]>`
    SELECT 
      id,
      content,
      title,
      source,
      1 - (embedding <=> ${embeddingStr}::vector) as similarity
    FROM knowledge_base
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${limit}
  `;
  const dbMs = (performance.now() - dbStart).toFixed(1);
  
  const results = rawResults
    .filter(r => r.similarity >= threshold)
    .map(r => ({
      id: r.id,
      content: r.content,
      title: r.title,
      source: r.source,
      similarity: r.similarity,
    }));
  
  const totalMs = (performance.now() - startTime).toFixed(1);
  
  knowledgeCache.set(cacheKey, results, 2 * 60 * 1000);
  
  return results;
}

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start = end - overlap;
    
    if (start >= text.length - overlap) break;
  }
  
  return chunks;
}

export async function addKnowledge(input: AddKnowledgeInput): Promise<{
  parentId: number;
  chunksCreated: number;
}> {
  const { content, title, source, metadata, chunkSize, chunkOverlap } = addKnowledgeSchema.parse(input);
  
  const parentResult = await sql<{ id: number }[]>`
    INSERT INTO knowledge_base (content, title, source, metadata)
    VALUES (${content}, ${title || null}, ${source || null}, ${metadata ? JSON.stringify(metadata) : null})
    RETURNING id
  `;
  
  const parentId = parentResult[0].id;
  
  const chunks = chunkText(content, chunkSize, chunkOverlap);
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = await generateDocumentEmbedding(chunk);
    const embeddingStr = `[${embedding.join(',')}]`;
    
    await sql`
      INSERT INTO knowledge_base (content, title, source, embedding, parent_id, chunk_index, metadata)
      VALUES (
        ${chunk}, 
        ${title ? `${title} (chunk ${i + 1})` : null}, 
        ${source || null}, 
        ${embeddingStr}::vector,
        ${parentId},
        ${i},
        ${metadata ? JSON.stringify(metadata) : null}
      )
    `;
  }
  
  knowledgeCache.delete('stats');
  
  return {
    parentId,
    chunksCreated: chunks.length,
  };
}

export async function deleteKnowledgeBySource(source: string): Promise<{ deletedCount: number }> {
  const result = await sql`
    DELETE FROM knowledge_base 
    WHERE source = ${source}
    RETURNING id
  `;
  
  knowledgeCache.delete('stats');
  
  return {
    deletedCount: result.length,
  };
}

export async function getKnowledgeStats(): Promise<{
  totalDocuments: number;
  totalChunks: number;
  documentsWithEmbeddings: number;
}> {
  return knowledgeCache.getOrSet('stats', async () => {
    const [totalResult, chunksResult, embeddingsResult] = await Promise.all([
      sql<{ count: string }[]>`
        SELECT COUNT(*)::text as count FROM knowledge_base WHERE parent_id IS NULL
      `,
      sql<{ count: string }[]>`
        SELECT COUNT(*)::text as count FROM knowledge_base WHERE parent_id IS NOT NULL
      `,
      sql<{ count: string }[]>`
        SELECT COUNT(*)::text as count FROM knowledge_base WHERE embedding IS NOT NULL
      `,
    ]);
    
    return {
      totalDocuments: parseInt(totalResult[0]?.count || '0', 10),
      totalChunks: parseInt(chunksResult[0]?.count || '0', 10),
      documentsWithEmbeddings: parseInt(embeddingsResult[0]?.count || '0', 10),
    };
  });
}
