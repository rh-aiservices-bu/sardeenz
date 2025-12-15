import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ModelStatusBadge } from './ModelStatusBadge'
import { ModelStatus } from '@sardeenz/types'

describe('ModelStatusBadge', () => {
  it('renders running status with correct label', () => {
    render(<ModelStatusBadge status={ModelStatus.Running} />)
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  it('renders starting status with correct label', () => {
    render(<ModelStatusBadge status={ModelStatus.Starting} />)
    expect(screen.getByText('Starting')).toBeInTheDocument()
  })

  it('renders stopping status with correct label', () => {
    render(<ModelStatusBadge status={ModelStatus.Stopping} />)
    expect(screen.getByText('Stopping')).toBeInTheDocument()
  })

  it('renders failed status with correct label', () => {
    render(<ModelStatusBadge status={ModelStatus.Failed} />)
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('renders sleeping status with correct label', () => {
    render(<ModelStatusBadge status={ModelStatus.Sleeping} />)
    expect(screen.getByText('Sleeping')).toBeInTheDocument()
  })

  it('shows spinner for loading states (starting)', () => {
    const { container } = render(<ModelStatusBadge status={ModelStatus.Starting} />)
    expect(container.querySelector('.pf-v6-c-spinner')).toBeInTheDocument()
  })

  it('shows spinner for loading states (stopping)', () => {
    const { container } = render(<ModelStatusBadge status={ModelStatus.Stopping} />)
    expect(container.querySelector('.pf-v6-c-spinner')).toBeInTheDocument()
  })

  it('does not show spinner for non-loading states', () => {
    const { container } = render(<ModelStatusBadge status={ModelStatus.Running} />)
    expect(container.querySelector('.pf-v6-c-spinner')).not.toBeInTheDocument()
  })
})
