import { useState, useEffect, useCallback } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import {
  Page,
  Masthead,
  MastheadToggle,
  MastheadMain,
  MastheadBrand,
  MastheadLogo,
  MastheadContent,
  PageSidebar,
  PageSidebarBody,
  PageSection,
  Nav,
  NavList,
  NavItem,
  Brand,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
  ToggleGroup,
  ToggleGroupItem,
  Dropdown,
  DropdownItem,
  DropdownList,
  MenuToggle,
  Drawer,
  DrawerContent,
  DrawerContentBody,
  DrawerPanelContent,
  Button,
  EmptyState,
  EmptyStateBody,
  EmptyStateFooter,
  EmptyStateActions,
  Spinner,
  Content,
  FlexItem,
  Flex,
  ContentVariants,
} from '@patternfly/react-core'
import {
  BarsIcon,
  SunIcon,
  MoonIcon,
  ExclamationCircleIcon,
  UserIcon,
} from '@patternfly/react-icons'
import sardeenzLogo from '../../../assets/sardeenz.svg'
import {
  starLogo,
  githubLogo,
  forkLogo,
  starLogoWhite,
  forkLogoWhite,
  githubLogoWhite,
} from './assets'
import { routes } from './routes'
import { useNotifications } from './contexts/NotificationContext'
import { useConnection } from './contexts/ConnectionContext'
import { useAuth } from './contexts/AuthContext'
import { NotificationDrawer, NotificationBadgeButton } from './components/NotificationDrawer'
import { AlertToastGroup } from './components/AlertToastGroup'
import { OperationsIndicator } from './components/OperationsIndicator'
import Login from './pages/Login'
import OAuthCallback from './pages/OAuthCallback'
import AccessDenied from './pages/AccessDenied'
import { InferenceWorkspaceProvider } from './contexts/InferenceWorkspaceContext'
import { AquaBg } from './components/AquaBg'
import { useKeySeq } from './hooks/useKeySeq'
import axios from 'axios'

function App() {
  const location = useLocation()
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [repoStars, setRepoStars] = useState<number | null>(null)
  const [repoForks, setRepoForks] = useState<number | null>(null)
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false)
  const [isDarkTheme, setIsDarkTheme] = useState(() => {
    const stored = localStorage.getItem('theme')
    if (stored) return stored === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  const [spBck, setSpBck] = useState(false)
  const toggleSpBck = useCallback(() => setSpBck((v) => !v), [])
  useKeySeq('sardine', toggleSpBck)

  const { toastNotifications, removeToastNotification, unreadCount } = useNotifications()
  const { status, retryConnection, version } = useConnection()
  const {
    user,
    authMode,
    logout,
    isAuthenticated,
    isLoading: authLoading,
    isAccessDenied,
  } = useAuth()

  // Fetch GitHub stars and forks
  useEffect(() => {
    axios
      .get('https://api.github.com/repos/rh-aiservices-bu/sardeenz')
      .then((response) => {
        setRepoStars(response.data.stargazers_count)
        setRepoForks(response.data.forks_count)
      })
      .catch((error) => {
        console.error('Failed to fetch GitHub stars:', error)
      })
  }, [])

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement
    if (isDarkTheme) {
      root.classList.add('pf-v6-theme-dark')
    } else {
      root.classList.remove('pf-v6-theme-dark')
    }
    localStorage.setItem('theme', isDarkTheme ? 'dark' : 'light')
  }, [isDarkTheme])

  const onUserDropdownToggle = () => {
    setIsUserDropdownOpen(!isUserDropdownOpen)
  }

  const onUserDropdownSelect = () => {
    setIsUserDropdownOpen(false)
  }

  const headerToolbar = (
    <Toolbar isFullHeight isStatic>
      <ToolbarContent>
        <ToolbarGroup
          variant="action-group-plain"
          align={{ default: 'alignEnd' }}
          gap={{ default: 'gapMd' }}
        >
          {/* Theme Toggle */}
          <ToolbarItem>
            <ToggleGroup aria-label="Theme toggle">
              <ToggleGroupItem
                icon={<SunIcon />}
                aria-label="Light theme"
                isSelected={!isDarkTheme}
                onChange={() => setIsDarkTheme(false)}
              />
              <ToggleGroupItem
                icon={<MoonIcon />}
                aria-label="Dark theme"
                isSelected={isDarkTheme}
                onChange={() => setIsDarkTheme(true)}
              />
            </ToggleGroup>
          </ToolbarItem>

          {/* Operations Indicator */}
          <ToolbarItem>
            <OperationsIndicator />
          </ToolbarItem>

          {/* Notification Badge */}
          <ToolbarItem>
            <NotificationBadgeButton
              onClick={() => setIsDrawerOpen(!isDrawerOpen)}
              unreadCount={unreadCount}
            />
          </ToolbarItem>

          {/* User Dropdown */}
          <ToolbarItem>
            <Dropdown
              isOpen={isUserDropdownOpen}
              onSelect={onUserDropdownSelect}
              onOpenChange={(isOpen: boolean) => setIsUserDropdownOpen(isOpen)}
              popperProps={{ position: 'right' }}
              toggle={(toggleRef) => (
                <MenuToggle
                  ref={toggleRef}
                  onClick={onUserDropdownToggle}
                  isExpanded={isUserDropdownOpen}
                  icon={<UserIcon />}
                >
                  {user?.username || 'User'}
                  {user?.roles?.includes('admin')
                    ? ' (admin)'
                    : user?.roles?.includes('admin-readonly')
                      ? ' (admin-readonly)'
                      : ''}
                </MenuToggle>
              )}
            >
              <DropdownList>
                <DropdownItem
                  key="logout"
                  isDisabled={authMode === 'none'}
                  onClick={() => {
                    logout()
                    onUserDropdownSelect()
                  }}
                >
                  Logout
                </DropdownItem>
              </DropdownList>
            </Dropdown>
          </ToolbarItem>
        </ToolbarGroup>
      </ToolbarContent>
    </Toolbar>
  )

  const masthead = (
    <Masthead>
      <MastheadMain>
        <MastheadToggle>
          <Button
            variant="plain"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            aria-label="Global navigation"
          >
            <BarsIcon />
          </Button>
        </MastheadToggle>
        <MastheadBrand>
          <MastheadLogo>
            <Brand src={sardeenzLogo} alt="Sardeenz" heights={{ default: '48px' }} />
          </MastheadLogo>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>{headerToolbar}</MastheadContent>
    </Masthead>
  )

  const sidebar = (
    <PageSidebar isSidebarOpen={isSidebarOpen}>
      <PageSidebarBody
        isFilled
        style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      >
        <Nav>
          <NavList>
            {routes.map((route) => (
              <NavItem
                key={route.itemId}
                itemId={route.itemId}
                isActive={location.pathname === route.path}
              >
                <Link to={route.path}>{route.label}</Link>
              </NavItem>
            ))}
          </NavList>
        </Nav>
        <aside
          role="complementary"
          style={{ marginTop: 'auto', padding: '1rem', textAlign: 'center' }}
        >
          <Content component={ContentVariants.small}>
            {'App by '}
            <a href="http://red.ht/cai-team" target="_blank" rel="noreferrer">
              red.ht/cai team
            </a>
            <br />
            {version && <FlexItem style={{ marginTop: '0.5rem' }}>Version {version}</FlexItem>}
            <Flex direction={{ default: 'column' }} style={{ width: '100%', alignItems: 'center' }}>
              <FlexItem style={{ marginBottom: '0rem' }}>
                <Flex direction={{ default: 'row' }} alignItems={{ default: 'alignItemsCenter' }}>
                  <FlexItem>
                    <Content
                      component={ContentVariants.a}
                      href="https://github.com/rh-aiservices-bu/sardeenz"
                      target="_blank"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: '0.5rem',
                        fontSize: 'var(--pf-t--global--font--size--xs)',
                      }}
                    >
                      <img
                        src={isDarkTheme ? githubLogoWhite : githubLogo}
                        alt={'GitHub logo'}
                        style={{ height: '20px', marginRight: '0.5rem' }}
                      />
                      {'Source on GitHub'}
                    </Content>
                  </FlexItem>
                </Flex>
              </FlexItem>
              <FlexItem>
                <Flex direction={{ default: 'row' }}>
                  <FlexItem style={{ alignmentBaseline: 'middle' }}>
                    {repoStars !== null && (
                      <>
                        <img
                          src={isDarkTheme ? starLogoWhite : starLogo}
                          alt=""
                          style={{
                            height: '15px',
                            marginRight: '0.5rem',
                            verticalAlign: 'text-top',
                          }}
                          aria-hidden="true"
                        />
                        <span className="pf-v6-screen-reader">{'Stars'}</span>
                      </>
                    )}
                    {repoStars !== null ? `${repoStars}` : ''}
                  </FlexItem>
                  <FlexItem>
                    {repoForks !== null && (
                      <>
                        <img
                          src={isDarkTheme ? forkLogoWhite : forkLogo}
                          alt=""
                          style={{
                            height: '15px',
                            marginRight: '0.5rem',
                            verticalAlign: 'text-top',
                          }}
                          aria-hidden="true"
                        />
                        <span className="pf-v6-screen-reader">{'Forks'}</span>
                      </>
                    )}
                    {repoForks !== null ? `${repoForks}` : ''}
                  </FlexItem>
                </Flex>
              </FlexItem>
            </Flex>
          </Content>
        </aside>
      </PageSidebarBody>
    </PageSidebar>
  )

  const drawerPanelContent = (
    <DrawerPanelContent>
      <NotificationDrawer onClose={() => setIsDrawerOpen(false)} />
    </DrawerPanelContent>
  )

  // Show auth loading state
  if (authLoading) {
    return (
      <Page masthead={masthead}>
        <PageSection isFilled>
          <EmptyState titleText="Initializing..." icon={Spinner}>
            <EmptyStateBody>
              <Content component="p">Loading authentication...</Content>
            </EmptyStateBody>
          </EmptyState>
        </PageSection>
      </Page>
    )
  }

  // Show access denied page when user is not in any authorized groups
  if (!isAuthenticated && authMode !== 'none' && isAccessDenied) {
    return <AccessDenied />
  }

  // Show login page for unauthenticated users (when auth is enabled)
  if (!isAuthenticated && authMode !== 'none') {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<OAuthCallback />} />
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  // Show connecting state
  if (status === 'connecting') {
    return (
      <Page masthead={masthead}>
        <PageSection isFilled>
          <EmptyState titleText="Connecting to server..." icon={Spinner}>
            <EmptyStateBody>
              <Content component="p">Waiting for backend to become available.</Content>
              <Content component="p" style={{ marginTop: 'var(--pf-t--global--spacer--sm)' }}>
                <small>This may take a few minutes during initial setup.</small>
              </Content>
            </EmptyStateBody>
          </EmptyState>
        </PageSection>
      </Page>
    )
  }

  // Show connection failed state
  if (status === 'failed') {
    return (
      <Page masthead={masthead}>
        <PageSection isFilled>
          <EmptyState
            titleText="Unable to connect to server"
            icon={ExclamationCircleIcon}
            status="danger"
          >
            <EmptyStateBody>
              The backend server is not responding. Please ensure it is running and try again.
            </EmptyStateBody>
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button variant="primary" onClick={retryConnection}>
                  Retry Connection
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          </EmptyState>
        </PageSection>
      </Page>
    )
  }

  return (
    <InferenceWorkspaceProvider>
      <AlertToastGroup notifications={toastNotifications} onRemove={removeToastNotification} />
      <AquaBg active={spBck} />
      <Page masthead={masthead} sidebar={sidebar}>
        <Drawer isExpanded={isDrawerOpen} onExpand={() => setIsDrawerOpen(true)}>
          <DrawerContent panelContent={drawerPanelContent}>
            <DrawerContentBody>
              <Routes>
                {routes.map((route) => (
                  <Route key={route.path} path={route.path} element={route.element} />
                ))}
              </Routes>
            </DrawerContentBody>
          </DrawerContent>
        </Drawer>
      </Page>
    </InferenceWorkspaceProvider>
  )
}

export default App
