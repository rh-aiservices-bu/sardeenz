import { useCallback, useEffect, useState } from 'react'
import {
  PageSection,
  Content,
  Card,
  CardTitle,
  CardBody,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  TextInput,
  Button,
  Alert,
  AlertVariant,
  Flex,
  FlexItem,
  Spinner,
  Tabs,
  Tab,
  TabTitleText,
  InputGroup,
  InputGroupItem,
} from '@patternfly/react-core'
import {
  EyeIcon,
  EyeSlashIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@patternfly/react-icons'
import { apiClient } from '../services/api'
import { useNotifications } from '../contexts/NotificationContext'
import { useAuth } from '../contexts/AuthContext'
import type { SettingsResponse } from '@sardeenz/types'

function Settings() {
  const { addNotification } = useNotifications()
  const { canWrite } = useAuth()

  // Settings state
  const [settings, setSettings] = useState<SettingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // HuggingFace token form state
  const [hfToken, setHfToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    valid: boolean
    username?: string
    error?: string
  } | null>(null)

  // Active tab
  const [activeTabKey, setActiveTabKey] = useState(0)

  const fetchSettings = useCallback(async () => {
    try {
      setError(null)
      const data = await apiClient.getSettings()
      setSettings(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const handleSaveToken = async () => {
    if (!hfToken.trim()) {
      addNotification({
        title: 'Token required',
        description: 'Please enter a HuggingFace token',
        variant: 'warning',
      })
      return
    }

    setSaving(true)
    try {
      const result = await apiClient.updateSettings({ hf_token: hfToken })
      setSettings(result)
      setHfToken('')
      setTestResult(null)
      addNotification({
        title: 'Token saved',
        description: 'HuggingFace token has been updated successfully',
        variant: 'success',
      })
    } catch (err) {
      addNotification({
        title: 'Failed to save token',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'danger',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleTestToken = async () => {
    const tokenToTest = hfToken.trim() || null
    if (!tokenToTest && !settings?.hf_token) {
      addNotification({
        title: 'No token to test',
        description: 'Please enter a token or save one first',
        variant: 'warning',
      })
      return
    }

    setTesting(true)
    setTestResult(null)
    try {
      // Use the entered token if available, otherwise we can't test the saved one (it's masked)
      if (!tokenToTest) {
        addNotification({
          title: 'Cannot test saved token',
          description: 'Enter the token again to test it, or save a new one',
          variant: 'warning',
        })
        setTesting(false)
        return
      }

      const result = await apiClient.testHfToken(tokenToTest)
      setTestResult(result)

      if (result.valid) {
        addNotification({
          title: 'Token is valid',
          description: `Connected as ${result.username}`,
          variant: 'success',
        })
      } else {
        addNotification({
          title: 'Token is invalid',
          description: result.error || 'Token validation failed',
          variant: 'danger',
        })
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setTestResult({ valid: false, error: errorMessage })
      addNotification({
        title: 'Test failed',
        description: errorMessage,
        variant: 'danger',
      })
    } finally {
      setTesting(false)
    }
  }

  const handleClearToken = async () => {
    setSaving(true)
    try {
      const result = await apiClient.updateSettings({ hf_token: '' })
      setSettings(result)
      setHfToken('')
      setTestResult(null)
      addNotification({
        title: 'Token cleared',
        description: 'HuggingFace token has been removed',
        variant: 'success',
      })
    } catch (err) {
      addNotification({
        title: 'Failed to clear token',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'danger',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleTabSelect = (
    _event: React.MouseEvent<HTMLElement, MouseEvent>,
    tabIndex: string | number
  ) => {
    setActiveTabKey(tabIndex as number)
  }

  if (loading) {
    return (
      <PageSection>
        <Flex justifyContent={{ default: 'justifyContentCenter' }}>
          <FlexItem>
            <Spinner size="xl" aria-label="Loading settings" />
          </FlexItem>
        </Flex>
      </PageSection>
    )
  }

  return (
    <>
      <PageSection hasShadowBottom>
        <Flex
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
          alignItems={{ default: 'alignItemsCenter' }}
        >
          <FlexItem>
            <Content component="h1">Settings</Content>
          </FlexItem>
        </Flex>
      </PageSection>

      <PageSection>
        {error && (
          <Alert
            variant={AlertVariant.danger}
            title="Error loading settings"
            isInline
            style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
          >
            {error}
          </Alert>
        )}

        <Tabs activeKey={activeTabKey} onSelect={handleTabSelect} aria-label="Settings tabs">
          <Tab
            eventKey={0}
            title={<TabTitleText>HuggingFace</TabTitleText>}
            aria-label="HuggingFace settings"
          >
            <div style={{ marginTop: 'var(--pf-t--global--spacer--lg)' }}>
              <Card>
                <CardTitle>HuggingFace Token</CardTitle>
                <CardBody>
                  <Alert
                    variant={AlertVariant.info}
                    isInline
                    title="Runtime setting"
                    style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
                  >
                    Changes to this setting are stored in memory and will be lost when the server
                    restarts. For production deployments, set the <code>HF_TOKEN</code> environment
                    variable.
                  </Alert>

                  {settings?.hf_token && (
                    <Alert
                      variant={
                        settings.hf_token_source === 'env'
                          ? AlertVariant.success
                          : AlertVariant.info
                      }
                      isInline
                      title={`Current token: ${settings.hf_token}`}
                      style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
                    >
                      Source:{' '}
                      {settings.hf_token_source === 'env' ? 'Environment variable' : 'Set via API'}
                    </Alert>
                  )}

                  <Form>
                    <FormGroup label="HuggingFace Token" fieldId="hf-token">
                      <InputGroup>
                        <InputGroupItem isFill>
                          <TextInput
                            id="hf-token"
                            type={showToken ? 'text' : 'password'}
                            value={hfToken}
                            onChange={(_event, value) => {
                              setHfToken(value)
                              setTestResult(null)
                            }}
                            placeholder="hf_..."
                            aria-label="HuggingFace token"
                          />
                        </InputGroupItem>
                        <InputGroupItem>
                          <Button
                            variant="control"
                            onClick={() => setShowToken(!showToken)}
                            aria-label={showToken ? 'Hide token' : 'Show token'}
                          >
                            {showToken ? <EyeSlashIcon /> : <EyeIcon />}
                          </Button>
                        </InputGroupItem>
                      </InputGroup>
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            Your HuggingFace access token for downloading gated models
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>

                    {testResult && (
                      <FormGroup fieldId="test-result">
                        <Alert
                          variant={testResult.valid ? AlertVariant.success : AlertVariant.danger}
                          isInline
                          title={testResult.valid ? 'Token is valid' : 'Token is invalid'}
                          customIcon={
                            testResult.valid ? <CheckCircleIcon /> : <ExclamationCircleIcon />
                          }
                        >
                          {testResult.valid
                            ? `Connected as: ${testResult.username}`
                            : testResult.error || 'Token validation failed'}
                        </Alert>
                      </FormGroup>
                    )}

                    <Flex gap={{ default: 'gapSm' }}>
                      <FlexItem>
                        <Button
                          variant="secondary"
                          onClick={handleTestToken}
                          isLoading={testing}
                          isDisabled={
                            testing ||
                            saving ||
                            (!hfToken.trim() && !settings?.hf_token) ||
                            !canWrite
                          }
                          title={
                            !canWrite ? 'You do not have permission to test tokens' : undefined
                          }
                        >
                          Test Connection
                        </Button>
                      </FlexItem>
                      <FlexItem>
                        <Button
                          variant="primary"
                          onClick={handleSaveToken}
                          isLoading={saving}
                          isDisabled={saving || testing || !hfToken.trim() || !canWrite}
                          title={
                            !canWrite ? 'You do not have permission to modify settings' : undefined
                          }
                        >
                          Save Token
                        </Button>
                      </FlexItem>
                      {settings?.hf_token && (
                        <FlexItem>
                          <Button
                            variant="link"
                            isDanger
                            onClick={handleClearToken}
                            isDisabled={saving || testing || !canWrite}
                            title={
                              !canWrite
                                ? 'You do not have permission to modify settings'
                                : undefined
                            }
                          >
                            Clear Token
                          </Button>
                        </FlexItem>
                      )}
                    </Flex>
                  </Form>
                </CardBody>
              </Card>
            </div>
          </Tab>
        </Tabs>
      </PageSection>
    </>
  )
}

export default Settings
