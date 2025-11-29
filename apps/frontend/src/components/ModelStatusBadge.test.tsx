import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ModelStatusBadge } from './ModelStatusBadge'

describe('ModelStatusBadge', () => {
  it('renders running status with correct label', () => {
    render(<ModelStatusBadge status="running" />)
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  it('renders starting status with correct label', () => {
    render(<ModelStatusBadge status="starting" />)
    expect(screen.getByText('Starting')).toBeInTheDocument()
  })

  it('renders stopping status with correct label', () => {
    render(<ModelStatusBadge status="stopping" />)
    expect(screen.getByText('Stopping')).toBeInTheDocument()
  })

  it('renders failed status with correct label', () => {
    render(<ModelStatusBadge status="failed" />)
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('renders sleeping status with correct label', () => {
    render(<ModelStatusBadge status="sleeping" />)
    expect(screen.getByText('Sleeping')).toBeInTheDocument()
  })

  it('shows spinner for loading states (starting)', () => {
    const { container } = render(<ModelStatusBadge status="starting" />)
    expect(container.querySelector('.pf-v6-c-spinner')).toBeInTheDocument()
  })

  it('shows spinner for loading states (stopping)', () => {
    const { container } = render(<ModelStatusBadge status="stopping" />)
    expect(container.querySelector('.pf-v6-c-spinner')).toBeInTheDocument()
  })

  it('does not show spinner for non-loading states', () => {
    const { container } = render(<ModelStatusBadge status="running" />)
    expect(container.querySelector('.pf-v6-c-spinner')).not.toBeInTheDocument()
  })
})
