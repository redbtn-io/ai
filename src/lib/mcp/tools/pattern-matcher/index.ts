import Fuse from 'fuse.js';
import patternsData from './patterns.json';

interface PatternMatchInput {
  query: string;
  patterns?: string[];
}

interface PatternMatchOutput {
  matched: boolean;
  pattern?: string;
  confidence: number;
  category?: string;
  fastpathTool?: string;
  metadata?: {
    matchType: 'exact' | 'fuzzy' | 'regex';
    rawScore: number;
  };
}

interface PatternGroup {
  id: string;
  patterns: string[];
  confidence: number;
  fastpathTool: string | null;
  category: string;
}

/**
 * Match user query against predefined patterns for fast routing
 * Supports exact matching and fuzzy matching for typos/variations
 */
export async function patternMatcher(
  input: PatternMatchInput
): Promise<PatternMatchOutput> {
  const query = input.query.toLowerCase().trim();
  const patterns: PatternGroup[] = patternsData.patterns;
  
  // 1. Check exact matches (highest priority)
  // Use word boundary regex to avoid matching substrings like "hi" in "machine"
  for (const patternGroup of patterns) {
    for (const pattern of patternGroup.patterns) {
      const patternLower = pattern.toLowerCase();
      // Create regex with word boundaries for single words, or exact match for phrases
      const regex = pattern.includes(' ') 
        ? new RegExp(patternLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        : new RegExp(`\\b${patternLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      
      if (regex.test(query)) {
        return {
          matched: true,
          pattern: pattern,
          confidence: patternGroup.confidence,
          category: patternGroup.category,
          fastpathTool: patternGroup.fastpathTool || undefined,
          metadata: {
            matchType: 'exact',
            rawScore: 1.0
          }
        };
      }
    }
  }
  
  // 2. Fuzzy matching (for typos, variations)
  const allPatterns = patterns.flatMap(group =>
    group.patterns.map(p => ({
      text: p,
      group: group
    }))
  );
  
  const fuse = new Fuse(allPatterns, {
    keys: ['text'],
    threshold: 0.5, // 50% similarity required (more lenient for typos)
    includeScore: true
  });
  
  const results = fuse.search(query);
  
  if (results.length > 0 && results[0].score! < 0.5) {
    const match = results[0];
    const group = match.item.group;
    
    return {
      matched: true,
      pattern: match.item.text,
      confidence: group.confidence * (1 - match.score!), // Adjust by fuzzy score
      category: group.category,
      fastpathTool: group.fastpathTool || undefined,
      metadata: {
        matchType: 'fuzzy',
        rawScore: 1 - match.score!
      }
    };
  }
  
  // 3. No match found
  return {
    matched: false,
    confidence: 0.0
  };
}

// MCP Tool Registration
export const patternMatcherTool = {
  name: 'pattern_matcher',
  description: 'Match user query against predefined patterns for fast routing',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'User query to match against patterns'
      },
      patterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: specific patterns to check'
      }
    },
    required: ['query']
  },
  handler: patternMatcher
};
