/**
 * In-memory embedding and similarity utilities
 * Uses Ollama for embeddings, computes similarity locally
 */

const OLLAMA_URL = process.env.WORK_LLM_URL || process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';

export interface EmbeddedChunk {
  text: string;
  embedding: number[];
  sourceUrl?: string;
  sourceTitle?: string;
}

/**
 * Get embedding for a single text
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      prompt: text
    })
  });

  if (!response.ok) {
    throw new Error(`Embedding failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { embedding: number[] };
  return data.embedding;
}

/**
 * Get embeddings for multiple texts (sequential to avoid overloading)
 */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  
  // Process in small batches to avoid timeout
  for (const text of texts) {
    try {
      const embedding = await getEmbedding(text);
      embeddings.push(embedding);
    } catch (e) {
      // On error, push zero vector (will have low similarity)
      embeddings.push([]);
    }
  }
  
  return embeddings;
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Chunk text into smaller pieces
 */
export function chunkText(
  text: string, 
  chunkSize: number = 400, 
  overlap: number = 50
): string[] {
  const chunks: string[] = [];
  
  // Clean and normalize
  const cleaned = text.replace(/\s+/g, ' ').trim();
  
  if (cleaned.length <= chunkSize) {
    return [cleaned];
  }

  let start = 0;
  while (start < cleaned.length) {
    let end = start + chunkSize;
    
    // Try to break at sentence boundary
    if (end < cleaned.length) {
      const slice = cleaned.slice(start, end + 50);
      const sentenceEnd = slice.search(/[.!?]\s/);
      if (sentenceEnd > chunkSize * 0.7) {
        end = start + sentenceEnd + 1;
      }
    }
    
    const chunk = cleaned.slice(start, end).trim();
    if (chunk.length > 50) {
      chunks.push(chunk);
    }
    
    start = end - overlap;
  }

  return chunks;
}

/**
 * Find most relevant chunks for a query using vector similarity
 */
export async function findRelevantChunks(
  query: string,
  chunks: Array<{ text: string; sourceUrl?: string; sourceTitle?: string }>,
  topK: number = 10
): Promise<Array<{ text: string; score: number; sourceUrl?: string; sourceTitle?: string }>> {
  
  if (chunks.length === 0) {
    return [];
  }

  // Get query embedding
  const queryEmbedding = await getEmbedding(query);
  
  // Get chunk embeddings
  const chunkTexts = chunks.map(c => c.text);
  const chunkEmbeddings = await getEmbeddings(chunkTexts);
  
  // Calculate similarities
  const scored = chunks.map((chunk, i) => ({
    ...chunk,
    score: cosineSimilarity(queryEmbedding, chunkEmbeddings[i])
  }));
  
  // Sort by score and return top K
  scored.sort((a, b) => b.score - a.score);
  
  return scored.slice(0, topK);
}
