import { useState, useEffect, useRef } from 'react'
import {
  Card,
  CardBody,
  Flex,
  FlexItem,
  Checkbox,
  Alert,
  Button,
  Bullseye,
} from '@patternfly/react-core'
import type { SessionStatus } from './workspace-types'
import Chatbot, { ChatbotDisplayMode } from '@patternfly/chatbot/dist/dynamic/Chatbot'
import ChatbotContent from '@patternfly/chatbot/dist/dynamic/ChatbotContent'
import MessageBox from '@patternfly/chatbot/dist/dynamic/MessageBox'
import Message from '@patternfly/chatbot/dist/dynamic/Message'
import ChatbotHeader, {
  ChatbotHeaderActions,
  ChatbotHeaderMain,
  ChatbotHeaderTitle,
} from '@patternfly/chatbot/dist/dynamic/ChatbotHeader'
import ChatbotFooter from '@patternfly/chatbot/dist/dynamic/ChatbotFooter'
import MessageBar from '@patternfly/chatbot/dist/dynamic/MessageBar'
import ChatbotWelcomePrompt from '@patternfly/chatbot/dist/dynamic/ChatbotWelcomePrompt'
import type { ModelInstanceDTO } from '@sardeenz/types'
import { useChatSession } from './useChatSession'
import type { ChatMessage } from './types'
import userAvatar from '../../../../../assets/avatars/user-avatar.svg'
import botAvatar from '../../../../../assets/avatars/bot-avatar.svg'

interface ModelChatCardProps {
  model: ModelInstanceDTO
  /** Callback when generation status changes */
  onStatusChange?: (status: SessionStatus) => void
}

/**
 * Build timestamp with metrics for bot messages
 */
function buildTimestamp(message: ChatMessage): string {
  const time = new Date(message.timestamp).toLocaleTimeString()

  if (message.role === 'bot' && message.metrics && !message.isLoading) {
    const parts = [time]
    parts.push(`${message.metrics.latencyMs}ms`)
    if (message.metrics.ttftMs !== undefined) {
      parts.push(`TTFT: ${message.metrics.ttftMs}ms`)
    }
    if (message.metrics.tokensPerSecond !== undefined) {
      parts.push(`${message.metrics.tokensPerSecond} tok/s`)
    }
    return parts.join(' | ')
  }

  return time
}

/**
 * Renders a chat card for a specific model with PatternFly Chatbot components.
 */
export function ModelChatCard({ model, onStatusChange }: ModelChatCardProps) {
  const {
    messages,
    isGenerating,
    useDirectCall,
    useStreaming,
    sendMessage,
    stopGeneration,
    updateSettings,
    clearHistory,
  } = useChatSession(model)

  // Controlled input with default prompt
  const [inputValue, setInputValue] = useState('Why is the sky blue?')

  // Use ref to stabilize onStatusChange callback
  // This prevents infinite re-renders when parent passes inline arrow functions
  const onStatusChangeRef = useRef(onStatusChange)
  onStatusChangeRef.current = onStatusChange

  // Notify parent of status changes - only depend on isGenerating
  useEffect(() => {
    onStatusChangeRef.current?.(isGenerating ? 'generating' : 'idle')
  }, [isGenerating])

  const modelName = model.model_path.split('/').pop() || model.model_path

  const handleSendMessage = (message: string | number) => {
    sendMessage(String(message))
    setInputValue('') // Clear after send
  }

  const handleInputChange = (
    _event: React.ChangeEvent<HTMLTextAreaElement>,
    value: string | number
  ) => {
    setInputValue(String(value))
  }

  return (
    <Card style={{ height: '100%' }}>
      <CardBody style={{ padding: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Chatbot container */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Chatbot displayMode={ChatbotDisplayMode.embedded}>
            <ChatbotHeader className="chat-header">
              <ChatbotHeaderMain>
                <ChatbotHeaderTitle className="chat-header-title">
                  <Bullseye>
                    <Flex
                      justifyContent={{ default: 'justifyContentSpaceBetween' }}
                      alignItems={{ default: 'alignItemsCenter' }}
                    >
                      <FlexItem>
                        <strong>{modelName}</strong>
                        {model.has_chat_template === false && (
                          <span
                            style={{
                              marginLeft: 'var(--pf-t--global--spacer--sm)',
                              fontSize: 'var(--pf-t--global--font--size--body--sm)',
                              color: 'var(--pf-t--global--color--status--warning--default)',
                            }}
                          >
                            (no chat template)
                          </span>
                        )}
                      </FlexItem>
                      <FlexItem>
                        <span style={{ fontSize: 'var(--pf-t--global--font--size--body--sm)' }}>
                          &nbsp;(p: {model.port})
                        </span>
                      </FlexItem>
                    </Flex>
                  </Bullseye>
                </ChatbotHeaderTitle>
              </ChatbotHeaderMain>
              <ChatbotHeaderActions>
                <Flex
                  gap={{ default: 'gapSm' }}
                  style={{
                    padding: '0',
                  }}
                  alignItems={{ default: 'alignItemsFlexStart' }}
                >
                  <FlexItem>
                    <Flex
                      direction={{ default: 'column' }}
                      spaceItems={{ default: 'spaceItemsNone' }}
                      alignItems={{ default: 'alignItemsStretch' }}
                      style={{
                        padding: '0',
                      }}
                    >
                      <FlexItem>
                        <Checkbox
                          id={`streaming-${model.id}`}
                          label="Streaming"
                          isChecked={useStreaming}
                          isDisabled={isGenerating}
                          onChange={(_, checked) => updateSettings({ useStreaming: checked })}
                          className="chat-header-actions-text"
                        />
                      </FlexItem>
                      <FlexItem>
                        <Checkbox
                          id={`direct-${model.id}`}
                          label="Proxy"
                          isChecked={!useDirectCall}
                          isDisabled={isGenerating}
                          onChange={(_, checked) => updateSettings({ useDirectCall: !checked })}
                          className="chat-header-actions-text"
                        />
                      </FlexItem>
                    </Flex>
                  </FlexItem>
                  <FlexItem align={{ default: 'alignRight' }}>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={clearHistory}
                      isDisabled={messages.length === 0 || isGenerating}
                    >
                      Clear
                    </Button>
                  </FlexItem>
                </Flex>
              </ChatbotHeaderActions>
            </ChatbotHeader>
            <ChatbotContent>
              {messages.length === 0 ? (
                <ChatbotWelcomePrompt
                  title={`Chat with ${modelName}`}
                  description="Click Send to test inference."
                  style={{ paddingLeft: '10px', paddingRight: '10px' }}
                />
              ) : (
                <MessageBox>
                  {messages.map((msg) => (
                    <MessageWithTimestamp key={msg.id} message={msg} modelName={modelName} />
                  ))}
                </MessageBox>
              )}
            </ChatbotContent>
            <ChatbotFooter>
              <MessageBar
                value={inputValue}
                onChange={handleInputChange}
                onSendMessage={handleSendMessage}
                placeholder="Enter your prompt..."
                isSendButtonDisabled={isGenerating}
                hasStopButton={isGenerating}
                handleStopButton={stopGeneration}
                hasAttachButton={false}
                isCompact
              />
            </ChatbotFooter>
          </Chatbot>
        </div>
      </CardBody>
    </Card>
  )
}

/**
 * Message component with timestamp that includes metrics for bot messages.
 */
function MessageWithTimestamp({ message, modelName }: { message: ChatMessage; modelName: string }) {
  return (
    <div>
      <Message
        role={message.role}
        content={message.content || (message.isLoading ? '' : 'No response')}
        name={message.role === 'user' ? 'You' : modelName}
        avatar={message.role === 'user' ? userAvatar : botAvatar}
        timestamp={buildTimestamp(message)}
        isLoading={message.isLoading}
      />
      {message.error && (
        <Alert
          variant="danger"
          isInline
          isPlain
          title={message.error.statusCode ? `Error ${message.error.statusCode}` : 'Error'}
          style={{
            marginLeft: 'var(--pf-t--global--spacer--2xl)',
            marginTop: 'var(--pf-t--global--spacer--xs)',
          }}
        >
          {message.error.message}
        </Alert>
      )}
    </div>
  )
}
