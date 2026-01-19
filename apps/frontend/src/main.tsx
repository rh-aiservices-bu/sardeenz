import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@patternfly/react-core/dist/styles/base.css'
import '@patternfly/chatbot/dist/css/main.css'
import './index.css'
import App from './App'
import { NotificationProvider } from './contexts/NotificationContext'
import { AuthProvider } from './contexts/AuthContext'
import { ConnectionProvider } from './contexts/ConnectionContext'
import { OperationsProvider } from './contexts/OperationsContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <NotificationProvider>
      <OperationsProvider>
        <BrowserRouter>
          <ConnectionProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ConnectionProvider>
        </BrowserRouter>
      </OperationsProvider>
    </NotificationProvider>
  </React.StrictMode>
)
