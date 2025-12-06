/**
 * Chat message for inference testing conversations
 */
export interface ChatMessage {
  id: string
  role: 'user' | 'bot'
  content: string
  timestamp: string
  isLoading?: boolean
  metrics?: {
    latencyMs: number
    ttftMs?: number
    tokensPerSecond?: number
    promptTokens?: number
    completionTokens?: number
  }
  error?: {
    message: string
    statusCode?: number
  }
}

/**
 * State for each model's chat session
 */
export interface ModelChatState {
  messages: ChatMessage[]
  useDirectCall: boolean
  useStreaming: boolean
  isGenerating: boolean
  abortController?: AbortController
}
