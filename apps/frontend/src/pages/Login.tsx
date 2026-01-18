import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import brandImg from '../../../../assets/sardeenz.svg'
import { LoginPage, LoginForm, ListItem, ListVariant } from '@patternfly/react-core'
import { ExclamationCircleIcon } from '@patternfly/react-icons'
import { useAuth } from '../contexts/AuthContext'

export const Login: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { authMode, login, loginWithOAuth, error, clearError, isLoading } = useAuth()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Get the redirect path from location state, or default to home
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/'

  const handleUsernameChange = (_event: React.FormEvent<HTMLInputElement>, value: string) => {
    setUsername(value)
    if (error) clearError()
  }

  const handlePasswordChange = (_event: React.FormEvent<HTMLInputElement>, value: string) => {
    setPassword(value)
    if (error) clearError()
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!username || !password) return

    setIsSubmitting(true)
    try {
      await login({ username, password })
      navigate(from, { replace: true })
    } catch {
      // Error is handled in AuthContext
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOAuthLogin = () => {
    loginWithOAuth()
  }

  // Show loading while auth is initializing
  if (isLoading) {
    return (
      <div className="pf-v6-u-display-flex pf-v6-u-justify-content-center pf-v6-u-align-items-center pf-v6-u-h-100">
        <span>Loading...</span>
      </div>
    )
  }

  // For OAuth mode, show SSO button
  if (authMode === 'oauth') {
    return (
      <LoginPage
        loginTitle="Log in to Sardeenz"
        loginSubtitle="Sardeenz is a proof-of-concept application that allows you to load more than one model on a given GPU. It allows you to add more and more models onto a GPU, until it is fully utilized."
        brandImgSrc={brandImg}
        socialMediaLoginContent={
          <div className="pf-v6-u-mt-md">
            <button
              className="pf-v6-c-button pf-m-primary pf-m-block"
              onClick={handleOAuthLogin}
              type="button"
            >
              Log in with SSO
            </button>
          </div>
        }
        footerListVariants={ListVariant.inline}
      >
        {error && (
          <div className="pf-v6-u-mb-md pf-v6-u-color-danger">
            <ExclamationCircleIcon /> {error}
          </div>
        )}
      </LoginPage>
    )
  }

  // For simple mode, show username/password form
  return (
    <LoginPage
      loginTitle="Log in to Sardeenz"
      loginSubtitle="Multi-model management platform"
      brandImgSrc={brandImg}
      footerListItems={
        <>
          <ListItem>
            <a href="#">Terms of Use</a>
          </ListItem>
          <ListItem>
            <a href="#">Help</a>
          </ListItem>
        </>
      }
      footerListVariants={ListVariant.inline}
    >
      <LoginForm
        showHelperText={!!error}
        helperText={error || ''}
        helperTextIcon={<ExclamationCircleIcon />}
        usernameLabel="Username"
        usernameValue={username}
        onChangeUsername={handleUsernameChange}
        isValidUsername={!error}
        passwordLabel="Password"
        passwordValue={password}
        onChangePassword={handlePasswordChange}
        isShowPasswordEnabled
        showPasswordAriaLabel="Show password"
        isValidPassword={!error}
        onLoginButtonClick={handleSubmit}
        loginButtonLabel={isSubmitting ? 'Logging in...' : 'Log in'}
        isLoginButtonDisabled={isSubmitting || !username || !password}
      />
    </LoginPage>
  )
}

export default Login
