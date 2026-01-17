/**
 * Prompt Generator for Benchmarking
 *
 * Generates prompts with approximate token counts for benchmarking.
 * Uses a 4:1 character-to-token ratio approximation.
 */

// Sample words for generating realistic-looking prompts
const SAMPLE_WORDS = [
  'analyze',
  'explain',
  'describe',
  'compare',
  'evaluate',
  'discuss',
  'consider',
  'the',
  'a',
  'an',
  'of',
  'in',
  'to',
  'for',
  'with',
  'on',
  'at',
  'by',
  'from',
  'this',
  'that',
  'these',
  'those',
  'what',
  'which',
  'how',
  'why',
  'when',
  'where',
  'system',
  'process',
  'method',
  'approach',
  'technique',
  'strategy',
  'framework',
  'data',
  'information',
  'knowledge',
  'understanding',
  'insight',
  'perspective',
  'important',
  'significant',
  'relevant',
  'essential',
  'critical',
  'fundamental',
  'development',
  'implementation',
  'optimization',
  'integration',
  'transformation',
  'performance',
  'efficiency',
  'effectiveness',
  'productivity',
  'scalability',
  'learning',
  'training',
  'model',
  'algorithm',
  'network',
  'architecture',
  'application',
  'solution',
  'problem',
  'challenge',
  'opportunity',
  'outcome',
  'business',
  'technology',
  'innovation',
  'research',
  'analysis',
  'evaluation',
  'quality',
  'improvement',
  'enhancement',
  'advancement',
  'progress',
  'success',
  'context',
  'environment',
  'situation',
  'scenario',
  'condition',
  'circumstance',
  'relationship',
  'connection',
  'interaction',
  'communication',
  'collaboration',
  'decision',
  'action',
  'result',
  'impact',
  'effect',
  'consequence',
  'benefit',
  'resource',
  'capability',
  'capacity',
  'potential',
  'possibility',
  'option',
  'structure',
  'organization',
  'pattern',
  'trend',
  'behavior',
  'characteristic',
  'based',
  'related',
  'associated',
  'connected',
  'linked',
  'integrated',
  'combined',
  'various',
  'different',
  'multiple',
  'several',
  'numerous',
  'diverse',
  'specific',
  'can',
  'may',
  'might',
  'could',
  'would',
  'should',
  'must',
  'will',
  'shall',
  'provide',
  'offer',
  'deliver',
  'create',
  'generate',
  'produce',
  'develop',
  'support',
  'enable',
  'facilitate',
  'enhance',
  'improve',
  'optimize',
  'maximize',
]

// Sentence templates for generating coherent prompts
const SENTENCE_TEMPLATES = [
  'Please {verb} the {noun} in detail.',
  'Can you {verb} how {noun} works?',
  'I need you to {verb} the {adjective} {noun}.',
  'What are the {adjective} aspects of {noun}?',
  'Help me understand the {noun} better.',
  '{Verb} the relationship between {noun} and {noun}.',
  'Describe the {noun} process step by step.',
  'Explain why {noun} is {adjective}.',
  'What makes {noun} so {adjective}?',
  'Consider the {adjective} implications of {noun}.',
]

const VERBS = [
  'analyze',
  'explain',
  'describe',
  'evaluate',
  'discuss',
  'consider',
  'examine',
  'investigate',
  'explore',
  'review',
  'assess',
  'outline',
]

const NOUNS = [
  'system',
  'process',
  'method',
  'approach',
  'technique',
  'strategy',
  'framework',
  'model',
  'algorithm',
  'architecture',
  'solution',
  'concept',
  'implementation',
  'development',
  'optimization',
  'integration',
  'analysis',
]

const ADJECTIVES = [
  'important',
  'significant',
  'relevant',
  'essential',
  'critical',
  'fundamental',
  'complex',
  'sophisticated',
  'advanced',
  'innovative',
  'practical',
  'effective',
]

/**
 * Simple seeded random number generator for reproducible prompts
 */
class SeededRandom {
  private seed: number

  constructor(seed: number) {
    this.seed = seed
  }

  next(): number {
    // Linear congruential generator
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff
    return this.seed / 0x7fffffff
  }

  choice<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }

  shuffle<T>(arr: T[]): T[] {
    const result = [...arr]
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
  }
}

/**
 * Estimate the number of tokens for a given text
 * Uses 4:1 character-to-token ratio approximation
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Generate a prompt with approximately the target number of tokens
 *
 * @param targetTokens - Target number of tokens (approximate)
 * @param seed - Optional seed for reproducible prompts (defaults to current time)
 * @returns Generated prompt text
 */
export function generatePrompt(targetTokens: number, seed?: number): string {
  const rng = new SeededRandom(seed ?? Date.now())

  // Target approximately 4 characters per token
  const targetChars = targetTokens * 4

  const parts: string[] = []
  let currentChars = 0

  // Start with a sentence template
  let template = rng.choice(SENTENCE_TEMPLATES)
  template = template
    .replace('{verb}', rng.choice(VERBS))
    .replace('{Verb}', capitalize(rng.choice(VERBS)))
    .replace(/{noun}/g, () => rng.choice(NOUNS))
    .replace(/{adjective}/g, () => rng.choice(ADJECTIVES))

  parts.push(template)
  currentChars += template.length

  // Add more content until we reach target
  while (currentChars < targetChars) {
    // Add a sentence
    const sentenceLength = Math.floor(rng.next() * 15) + 5 // 5-20 words
    const words: string[] = []

    for (let i = 0; i < sentenceLength; i++) {
      words.push(rng.choice(SAMPLE_WORDS))
    }

    // Capitalize first word and add period
    if (words.length > 0) {
      words[0] = capitalize(words[0])
    }
    const sentence = words.join(' ') + '.'

    parts.push(sentence)
    currentChars += sentence.length + 1 // +1 for space
  }

  // Join and potentially trim to get closer to target
  let result = parts.join(' ')

  // If we went over, trim to approximate target
  if (result.length > targetChars + 20) {
    result = result.substring(0, targetChars)
    // Find last complete word
    const lastSpace = result.lastIndexOf(' ')
    if (lastSpace > targetChars * 0.8) {
      result = result.substring(0, lastSpace) + '.'
    }
  }

  return result
}

/**
 * Generate a chat message for benchmarking
 *
 * @param targetTokens - Target number of tokens for the user message
 * @param seed - Optional seed for reproducible prompts
 * @returns Array of chat messages suitable for chat completion API
 */
export function generateChatMessages(
  targetTokens: number,
  seed?: number
): Array<{ role: 'user' | 'system' | 'assistant'; content: string }> {
  const systemMessage = 'You are a helpful assistant. Respond thoroughly and in detail.'
  const userMessage = generatePrompt(targetTokens, seed)

  return [
    { role: 'system', content: systemMessage },
    { role: 'user', content: userMessage },
  ]
}

function capitalize(str: string): string {
  if (!str) return str
  return str.charAt(0).toUpperCase() + str.slice(1)
}
