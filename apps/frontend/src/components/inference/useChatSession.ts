import { useState, useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import { apiClient, extractErrorDetails } from '../../services/api'
import type { ModelInstanceDTO, ChatCompletionRequest } from '@sardeenz/types'
import type { ChatMessage, ModelChatState } from './types'

/**
 * Custom hook for managing a chat session with a specific model.
 * Handles message sending, streaming, and state management.
 */
export function useChatSession(model: ModelInstanceDTO) {
  const [state, setState] = useState<ModelChatState>({
    messages: [],
    useDirectCall: false,
    useStreaming: true,
    isGenerating: false,
  })

  // Track the current bot message ID for streaming updates
  const currentBotMessageIdRef = useRef<string | null>(null)

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || state.isGenerating) return

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: content.trim(),
        timestamp: new Date().toISOString(),
      }

      const botMessageId = crypto.randomUUID()
      currentBotMessageIdRef.current = botMessageId

      const botMessage: ChatMessage = {
        id: botMessageId,
        role: 'bot',
        content: '',
        timestamp: new Date().toISOString(),
        isLoading: true,
      }

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage, botMessage],
        isGenerating: true,
      }))

      const startTime = performance.now()
      let firstTokenTime: number | undefined

      // Build the chat completion request
      const request: ChatCompletionRequest = {
        model: model.model_name,
        messages: [{ role: 'user' as const, content: content.trim() }],
        max_tokens: 512,
        temperature: 0.7,
      }

      // If model doesn't have chat template, include manual template
      if (model.has_chat_template === false) {
        request.chat_template =
          '{% for m in messages %}{{ m.role|upper }}: {{ m.content }}\n{% endfor %}ASSISTANT:'
      }

      const onChunk = (chunk: string) => {
        if (!firstTokenTime) {
          firstTokenTime = performance.now()
        }

        // Use flushSync to force immediate render for each chunk
        // This prevents React 18's automatic batching from delaying updates
        flushSync(() => {
          setState((prev) => ({
            ...prev,
            messages: prev.messages.map((msg) =>
              msg.id === botMessageId
                ? { ...msg, content: msg.content + chunk, isLoading: false }
                : msg
            ),
          }))
        })
      }

      const onComplete = (fullText: string, tokenCount: number) => {
        const endTime = performance.now()
        const latencyMs = Math.round(endTime - startTime)
        const ttftMs = firstTokenTime ? Math.round(firstTokenTime - startTime) : undefined
        const generationTimeMs = firstTokenTime ? endTime - firstTokenTime : endTime - startTime
        const tokensPerSecond =
          tokenCount > 0 && generationTimeMs > 0
            ? Math.round((tokenCount / (generationTimeMs / 1000)) * 10) / 10
            : undefined

        setState((prev) => ({
          ...prev,
          messages: prev.messages.map((msg) =>
            msg.id === botMessageId
              ? {
                  ...msg,
                  content: fullText,
                  isLoading: false,
                  metrics: { latencyMs, ttftMs, tokensPerSecond },
                }
              : msg
          ),
          isGenerating: false,
          abortController: undefined,
        }))

        currentBotMessageIdRef.current = null
      }

      const onError = (error: { statusCode?: number; message: string }) => {
        const endTime = performance.now()
        const latencyMs = Math.round(endTime - startTime)

        setState((prev) => ({
          ...prev,
          messages: prev.messages.map((msg) =>
            msg.id === botMessageId
              ? {
                  ...msg,
                  isLoading: false,
                  error: { message: error.message, statusCode: error.statusCode },
                  metrics: { latencyMs },
                }
              : msg
          ),
          isGenerating: false,
          abortController: undefined,
        }))

        currentBotMessageIdRef.current = null
      }

      try {
        if (state.useStreaming) {
          // Streaming request
          let abortController: AbortController
          if (state.useDirectCall) {
            abortController = await apiClient.sendStreamingChatCompletionDirect(
              model.port,
              request,
              onChunk,
              onComplete,
              onError
            )
          } else {
            abortController = await apiClient.sendStreamingChatCompletionViaProxy(
              request,
              onChunk,
              onComplete,
              onError
            )
          }

          setState((prev) => ({ ...prev, abortController }))
        } else {
          // Non-streaming request
          try {
            let response
            if (state.useDirectCall) {
              response = await apiClient.sendChatCompletionDirect(model.port, request)
            } else {
              response = await apiClient.sendChatCompletionViaProxy(request)
            }

            const endTime = performance.now()
            const latencyMs = Math.round(endTime - startTime)
            const responseContent = response.choices[0]?.message?.content || ''

            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((msg) =>
                msg.id === botMessageId
                  ? {
                      ...msg,
                      content: responseContent,
                      isLoading: false,
                      metrics: {
                        latencyMs,
                        promptTokens: response.usage?.prompt_tokens,
                        completionTokens: response.usage?.completion_tokens,
                      },
                    }
                  : msg
              ),
              isGenerating: false,
            }))
          } catch (err) {
            onError(extractErrorDetails(err))
          }
        }
      } catch (err) {
        onError(extractErrorDetails(err))
      }
    },
    [model, state.isGenerating, state.useDirectCall, state.useStreaming]
  )

  const stopGeneration = useCallback(() => {
    if (state.abortController) {
      state.abortController.abort()

      // Update the current bot message to remove loading state
      if (currentBotMessageIdRef.current) {
        const botMessageId = currentBotMessageIdRef.current
        setState((prev) => ({
          ...prev,
          messages: prev.messages.map((msg) =>
            msg.id === botMessageId ? { ...msg, isLoading: false } : msg
          ),
          isGenerating: false,
          abortController: undefined,
        }))
        currentBotMessageIdRef.current = null
      } else {
        setState((prev) => ({
          ...prev,
          isGenerating: false,
          abortController: undefined,
        }))
      }
    }
  }, [state.abortController])

  const updateSettings = useCallback(
    (updates: Partial<Pick<ModelChatState, 'useDirectCall' | 'useStreaming'>>) => {
      setState((prev) => ({ ...prev, ...updates }))
    },
    []
  )

  const clearHistory = useCallback(() => {
    setState((prev) => ({ ...prev, messages: [] }))
  }, [])

  return {
    messages: state.messages,
    isGenerating: state.isGenerating,
    useDirectCall: state.useDirectCall,
    useStreaming: state.useStreaming,
    sendMessage,
    stopGeneration,
    updateSettings,
    clearHistory,
  }
}
