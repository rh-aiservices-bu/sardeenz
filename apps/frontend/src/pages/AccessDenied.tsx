import {
  Page,
  PageSection,
  EmptyState,
  EmptyStateBody,
  EmptyStateFooter,
  EmptyStateActions,
  Button,
  Content,
  ContentVariants,
  Masthead,
  MastheadMain,
  MastheadBrand,
  MastheadLogo,
  Brand,
} from '@patternfly/react-core'
import { LockIcon } from '@patternfly/react-icons'
import { useAuth } from '../contexts/AuthContext'
import sardeenzLogo from '../../../../assets/sardeenz.svg'

/**
 * Access Denied page shown when a user authenticates via OAuth
 * but is not a member of any authorized groups.
 */
export function AccessDenied() {
  const { logout, clearError } = useAuth()

  const handleTryAgain = () => {
    clearError()
    logout()
  }

  const masthead = (
    <Masthead>
      <MastheadMain>
        <MastheadBrand>
          <MastheadLogo>
            <Brand src={sardeenzLogo} alt="Sardeenz" heights={{ default: '48px' }} />
          </MastheadLogo>
        </MastheadBrand>
      </MastheadMain>
    </Masthead>
  )

  return (
    <Page masthead={masthead}>
      <PageSection isFilled>
        <EmptyState titleText="Access Denied" headingLevel="h1" icon={LockIcon} status="danger">
          <EmptyStateBody>
            <Content component={ContentVariants.p}>
              You are not a member of any authorized groups for this application.
            </Content>
            <Content component={ContentVariants.p}>
              To access Sardeenz, you must be added to one of the following OpenShift groups:
            </Content>
            <Content component="ul" style={{ textAlign: 'left', display: 'inline-block' }}>
              <li>
                <strong>sardeenz-admins</strong> - Full access (load/unload models, manage settings)
              </li>
              <li>
                <strong>sardeenz-admins-readonly</strong> - Read-only access (view models, run
                tests)
              </li>
            </Content>
            <Content component={ContentVariants.p}>
              Please contact your OpenShift administrator to request access.
            </Content>
          </EmptyStateBody>
          <EmptyStateFooter>
            <EmptyStateActions>
              <Button variant="primary" onClick={handleTryAgain}>
                Try Again
              </Button>
            </EmptyStateActions>
          </EmptyStateFooter>
        </EmptyState>
      </PageSection>
    </Page>
  )
}

export default AccessDenied
