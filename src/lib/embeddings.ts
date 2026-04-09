
import { embeddingCache } from './cache.js';

const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSIONS = 768; 
const API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

type TaskType = 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' | 'SEMANTIC_SIMILARITY';

interface EmbedContentResponse {
  embedding: {
    values: number[];
  };
}

async function generateEmbeddingWithTask(text: string, taskType: TaskType): Promise<number[]> {
  if (!text.trim()) {
    throw new Error('El texto no puede estar vacío');
  }

  const url = `${API_BASE_URL}/models/${EMBEDDING_MODEL}:embedContent?key=${GOOGLE_API_KEY}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: {
        parts: [{ text }],
      },
      outputDimensionality: EMBEDDING_DIMENSIONS,
      taskType,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as EmbedContentResponse;
  return data.embedding.values;
}

export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const cacheKey = `query:${query}`;
  return embeddingCache.getOrSet(cacheKey, () =>
    generateEmbeddingWithTask(query, 'RETRIEVAL_QUERY')
  );
}

export async function generateDocumentEmbedding(document: string): Promise<number[]> {
  return generateEmbeddingWithTask(document, 'RETRIEVAL_DOCUMENT');
}

export async function generateEmbedding(text: string): Promise<number[]> {
  return generateQueryEmbedding(text);
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const results = await Promise.all(
    texts.map(text => generateDocumentEmbedding(text))
  );
  
  return results;
}
