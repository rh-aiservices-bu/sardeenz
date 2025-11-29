import React from 'react'
import { Alert, AlertProps, AlertGroup, AlertActionCloseButton } from '@patternfly/react-core'
import { ToastNotification } from '../contexts/NotificationContext'

interface AlertToastGroupProps {
  notifications: ToastNotification[]
  onRemove: (id: string) => void
}

export const AlertToastGroup: React.FC<AlertToastGroupProps> = ({ notifications, onRemove }) => {
  const getAlertVariant = (variant?: string): AlertProps['variant'] => {
    switch (variant) {
      case 'success':
        return 'success'
      case 'danger':
        return 'danger'
      case 'warning':
        return 'warning'
      case 'info':
        return 'info'
      default:
        return 'custom'
    }
  }

  return (
    <AlertGroup isToast isLiveRegion>
      {notifications.map((notification) => (
        <Alert
          key={notification.id}
          variant={getAlertVariant(notification.variant)}
          title={notification.title}
          isExpandable={!!notification.description && notification.description.length > 100}
          timeout={notification.timeout || 5000}
          onTimeout={() => onRemove(notification.id)}
          actionClose={
            <AlertActionCloseButton
              title={`Close ${notification.title}`}
              variantLabel={`${getAlertVariant(notification.variant)} alert`}
              onClose={() => onRemove(notification.id)}
            />
          }
        >
          {notification.description}
        </Alert>
      ))}
    </AlertGroup>
  )
}
