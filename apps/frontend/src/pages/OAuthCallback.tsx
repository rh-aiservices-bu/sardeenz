import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bullseye, Spinner } from '@patternfly/react-core'

/**
 * OAuth Callback Handler
 *
 * This page handles the redirect from the OAuth provider.
 * The backend redirects here with the token in the URL hash: /#token=...
 *
 * The AuthContext handles extracting the token on mount, so this component
 * just shows a loading spinner and redirects to home.
 */
export const OAuthCallback: React.FC = () => {
  const navigate = useNavigate()

  useEffect(() => {
    // The AuthContext will handle the token extraction from the URL hash
    // We just need to wait a moment and redirect to home
    const timer = setTimeout(() => {
      navigate('/', { replace: true })
    }, 100)

    return () => clearTimeout(timer)
  }, [navigate])

  return (
    <Bullseye>
      <div className="pf-v6-u-text-align-center">
        <Spinner aria-label="Completing authentication" />
        <div className="pf-v6-u-mt-md">Completing authentication...</div>
      </div>
    </Bullseye>
  )
}

export default OAuthCallback
