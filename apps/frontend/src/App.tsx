import { useState, useEffect } from 'react'
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
  Divider,
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
} from '@patternfly/react-core'
import { BarsIcon, SunIcon, MoonIcon, ExclamationCircleIcon, UserIcon } from '@patternfly/react-icons'
import sardeenzLogo from '../../../assets/sardeenz.svg'
import ModelManagement from './pages/ModelManagement'
import ModelBenchmark from './pages/ModelBenchmark'
import GpuInfo from './pages/GpuInfo'
import Settings from './pages/Settings'
import { useNotifications } from './contexts/NotificationContext'
import { useConnection } from './contexts/ConnectionContext'
import { NotificationDrawer, NotificationBadgeButton } from './components/NotificationDrawer'
import { AlertToastGroup } from './components/AlertToastGroup'

function App() {
  const location = useLocation()
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false)
  const [isDarkTheme, setIsDarkTheme] = useState(() => {
    const stored = localStorage.getItem('theme')
    if (stored) return stored === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  const { toastNotifications, removeToastNotification, unreadCount } = useNotifications()
  const { status, retryConnection } = useConnection()

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
                  User
                </MenuToggle>
              )}
            >
              <DropdownList>
                <DropdownItem key="profile" isDisabled>
                  Profile
                </DropdownItem>
                <Divider component="li" />
                <DropdownItem key="logout" isDisabled>
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
      <PageSidebarBody>
        <Nav>
          <NavList>
            <NavItem itemId="model-management" isActive={location.pathname === '/'}>
              <Link to="/">Model Management</Link>
            </NavItem>
            <NavItem itemId="gpu-info" isActive={location.pathname === '/gpu'}>
              <Link to="/gpu">GPU Info</Link>
            </NavItem>
            <NavItem itemId="model-benchmark" isActive={location.pathname === '/benchmark'}>
              <Link to="/benchmark">Model Benchmark</Link>
            </NavItem>
            <NavItem itemId="settings" isActive={location.pathname === '/settings'}>
              <Link to="/settings">Settings</Link>
            </NavItem>
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  )

  const drawerPanelContent = (
    <DrawerPanelContent>
      <NotificationDrawer onClose={() => setIsDrawerOpen(false)} />
    </DrawerPanelContent>
  )

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
    <>
      <AlertToastGroup
        notifications={toastNotifications}
        onRemove={removeToastNotification}
      />
      <Page masthead={masthead} sidebar={sidebar}>
        <Drawer isExpanded={isDrawerOpen} onExpand={() => setIsDrawerOpen(true)}>
          <DrawerContent panelContent={drawerPanelContent}>
            <DrawerContentBody>
              <Routes>
                <Route path="/" element={<ModelManagement />} />
                <Route path="/gpu" element={<GpuInfo />} />
                <Route path="/benchmark" element={<ModelBenchmark />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </DrawerContentBody>
          </DrawerContent>
        </Drawer>
      </Page>
    </>
  )
}

export default App
