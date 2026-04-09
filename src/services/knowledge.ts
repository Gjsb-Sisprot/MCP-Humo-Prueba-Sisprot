
import { z } from 'zod';
import { supabase } from '../db/index.js';
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
  
  const queryEmbedding = await generateQueryEmbedding(query);
  
  // Usamos RPC para búsqueda vectorial en Supabase
  // Es necesario crear la función 'match_knowledge' en Supabase (ver README o documentación)
  const { data, error } = await supabase.rpc('match_knowledge', {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
    match_count: limit,
  });

  if (error) {
    console.warn('Error en búsqueda vectorial RPC, intentando fallback simple:', error);
    // Fallback simple si no hay RPC (sin vectores, solo texto)
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('knowledge_base')
      .select('id, content, title, source')
      .ilike('content', `%${query}%`)
      .limit(limit);
    
    if (fallbackError) throw fallbackError;
    return (fallbackData || []).map(r => ({ ...r, similarity: 0.5 }));
  }
  
  const results = (data || []).map((r: any) => ({
    id: r.id,
    content: r.content,
    title: r.title,
    source: r.source,
    similarity: r.similarity,
  }));
  
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
  
  const { data: parent, error: parentError } = await supabase
    .from('knowledge_base')
    .insert({
      content,
      title: title || null,
      source: source || null,
      metadata: metadata || null
    })
    .select('id')
    .single();
  
  if (parentError) throw parentError;
  const parentId = parent.id;
  
  const chunks = chunkText(content, chunkSize, chunkOverlap);
  const chunkRows = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = await generateDocumentEmbedding(chunk);
    
    chunkRows.push({
      content: chunk,
      title: title ? `${title} (chunk ${i + 1})` : null,
      source: source || null,
      embedding,
      parent_id: parentId,
      chunk_index: i,
      metadata: metadata || null
    });
  }

  const { error: insertError } = await supabase
    .from('knowledge_base')
    .insert(chunkRows);
  
  if (insertError) throw insertError;
  
  knowledgeCache.delete('stats');
  
  return {
    parentId,
    chunksCreated: chunks.length,
  };
}

export async function deleteKnowledgeBySource(source: string): Promise<{ deletedCount: number }> {
  const { error, count } = await supabase
    .from('knowledge_base')
    .delete({ count: 'exact' })
    .eq('source', source);
  
  if (error) throw error;
  
  knowledgeCache.delete('stats');
  
  return {
    deletedCount: count || 0,
  };
}

export async function getKnowledgeStats(): Promise<{
  totalDocuments: number;
  totalChunks: number;
  documentsWithEmbeddings: number;
}> {
  return knowledgeCache.getOrSet('stats', async () => {
    const { count: total, error: totalErr } = await supabase
      .from('knowledge_base')
      .select('*', { count: 'exact', head: true })
      .is('parent_id', null);

    const { count: chunks, error: chunksErr } = await supabase
      .from('knowledge_base')
      .select('*', { count: 'exact', head: true })
      .not('parent_id', 'is', null);

    const { count: embeddings, error: embErr } = await supabase
      .from('knowledge_base')
      .select('*', { count: 'exact', head: true })
      .not('embedding', 'is', null);
    
    return {
      totalDocuments: total || 0,
      totalChunks: chunks || 0,
      documentsWithEmbeddings: embeddings || 0,
    };
  });
}
