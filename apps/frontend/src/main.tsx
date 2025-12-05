import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@patternfly/react-core/dist/styles/base.css'
import '@patternfly/chatbot/dist/css/main.css'
import App from './App'
import { NotificationProvider } from './contexts/NotificationContext'
import { ConnectionProvider } from './contexts/ConnectionContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <NotificationProvider>
      <ConnectionProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ConnectionProvider>
    </NotificationProvider>
  </React.StrictMode>
)
