import { PageSection, Content, Flex, FlexItem } from '@patternfly/react-core'
import { InferenceWorkspace } from '../components/inference/InferenceWorkspace'

function ChatbotPlayground() {
  return (
    <PageSection
      isFilled
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 0,
      }}
    >
      {/* Header */}
      <Flex
        justifyContent={{ default: 'justifyContentSpaceBetween' }}
        alignItems={{ default: 'alignItemsCenter' }}
        style={{
          padding: 'var(--pf-t--global--spacer--md) var(--pf-t--global--spacer--lg)',
          borderBottom: '1px solid var(--pf-t--global--border--color--default)',
          background: 'var(--pf-t--global--background--color--primary--default)',
        }}
      >
        <FlexItem>
          <Content component="h1" style={{ margin: 0 }}>
            Chatbot Playground
          </Content>
        </FlexItem>
      </Flex>

      {/* Workspace */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <InferenceWorkspace />
      </div>
    </PageSection>
  )
}

export default ChatbotPlayground
