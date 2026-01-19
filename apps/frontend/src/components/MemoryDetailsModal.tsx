import { useState, useEffect } from 'react'
import {
  Modal,
  ModalVariant,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Alert,
  Spinner,
} from '@patternfly/react-core'
import type { ModelMemoryMetricsDTO } from '@sardeenz/types'
import { apiClient } from '../services/api'

interface MemoryDetailsModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback when modal should close */
  onClose: () => void
  /** Instance ID for fetching live GPU memory */
  instanceId: string
  /** Model path for display in title */
  modelPath: string
  /** Memory metrics from the API (null if not available) */
  memoryMetrics: ModelMemoryMetricsDTO | null
}

/**
 * Modal displaying detailed memory metrics for a loaded model.
 * Fetches live GPU memory from /api/memory/usage for accurate values.
 * Shows weights, CUDA graphs, overhead, KV cache, and per-request memory usage.
 */
export function MemoryDetailsModal({
  isOpen,
  onClose,
  instanceId,
  modelPath,
  memoryMetrics,
}: MemoryDetailsModalProps) {
  const [liveGpuMemoryGb, setLiveGpuMemoryGb] = useState<number | null>(null)
  const [gpuTotalGb, setGpuTotalGb] = useState<number>(24) // Default to 24GB
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch live GPU memory from /api/memory/usage when modal opens
  useEffect(() => {
    if (!isOpen) {
      // Reset state when modal closes
      setLiveGpuMemoryGb(null)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    apiClient
      .getMemoryUsage()
      .then((data) => {
        // Get total GPU memory from response
        setGpuTotalGb(data.gpu.total_gb)

        const model = data.models.find((m) => m.instance_id === instanceId)
        if (model) {
          setLiveGpuMemoryGb(model.gpu_memory_gb)
        } else {
          setError('Model not found in memory usage data')
        }
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to fetch memory usage:', err)
        setError('Failed to fetch live GPU memory')
        setLoading(false)
      })
  }, [isOpen, instanceId])

  const formatGiB = (value: number) => `${value.toFixed(2)} GiB`
  const formatMiB = (value: number) => `${value.toFixed(2)} MiB`
  const formatPercent = (value: number) => `${(value * 100).toFixed(0)}%`

  // Use live GPU memory if available, otherwise fall back to parsed metrics
  const totalGpuMemoryGib =
    liveGpuMemoryGb ??
    memoryMetrics?.total_gpu_memory_gib ??
    (memoryMetrics ? memoryMetrics.weights_memory_gib + memoryMetrics.cuda_graph_memory_gib : 0)

  // Calculate overhead dynamically from live data
  const overheadMemoryGib =
    liveGpuMemoryGb && memoryMetrics
      ? Math.max(
          0,
          liveGpuMemoryGb - memoryMetrics.weights_memory_gib - memoryMetrics.cuda_graph_memory_gib
        )
      : (memoryMetrics?.overhead_memory_gib ?? 0)

  // Calculate GPU utilization from live data
  const gpuMemoryUtilization = gpuTotalGb > 0 ? totalGpuMemoryGib / gpuTotalGb : 0

  return (
    <Modal variant={ModalVariant.medium} isOpen={isOpen} onClose={onClose}>
      <ModalHeader title={`Memory Details - ${modelPath}`} />
      <ModalBody>
        {loading && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: 'var(--pf-t--global--spacer--lg)',
            }}
          >
            <Spinner size="lg" aria-label="Loading memory details" />
          </div>
        )}
        {error && !loading && (
          <Alert variant="warning" isInline title="Could not fetch live GPU memory">
            {error}. Showing parsed log values instead.
          </Alert>
        )}
        {!loading && memoryMetrics ? (
          <DescriptionList isHorizontal>
            <DescriptionListGroup>
              <DescriptionListTerm>Total GPU Memory</DescriptionListTerm>
              <DescriptionListDescription>
                {formatGiB(totalGpuMemoryGib)}
                <span
                  style={{
                    marginLeft: 'var(--pf-t--global--spacer--sm)',
                    color: 'var(--pf-t--global--color--nonstatus--gray--default)',
                  }}
                >
                  ({formatPercent(gpuMemoryUtilization)} of GPU)
                </span>
              </DescriptionListDescription>
            </DescriptionListGroup>

            <DescriptionListGroup>
              <DescriptionListTerm>Model Weights</DescriptionListTerm>
              <DescriptionListDescription>
                {formatGiB(memoryMetrics.weights_memory_gib)}
              </DescriptionListDescription>
            </DescriptionListGroup>

            <DescriptionListGroup>
              <DescriptionListTerm>CUDA Graphs</DescriptionListTerm>
              <DescriptionListDescription>
                {formatGiB(memoryMetrics.cuda_graph_memory_gib)}
              </DescriptionListDescription>
            </DescriptionListGroup>

            <DescriptionListGroup>
              <DescriptionListTerm>Overhead</DescriptionListTerm>
              <DescriptionListDescription>
                {formatGiB(overheadMemoryGib)}
                <span
                  style={{
                    marginLeft: 'var(--pf-t--global--spacer--sm)',
                    color: 'var(--pf-t--global--color--nonstatus--gray--default)',
                  }}
                >
                  (Runtime, buffers, etc.)
                </span>
              </DescriptionListDescription>
            </DescriptionListGroup>

            <DescriptionListGroup>
              <DescriptionListTerm>KV Cache per Request</DescriptionListTerm>
              <DescriptionListDescription>
                {formatMiB(memoryMetrics.kv_cache_per_request_mib)}
                <span
                  style={{
                    marginLeft: 'var(--pf-t--global--spacer--sm)',
                    color: 'var(--pf-t--global--color--nonstatus--gray--default)',
                  }}
                >
                  (at {memoryMetrics.max_model_len.toLocaleString()} tokens)
                </span>
              </DescriptionListDescription>
            </DescriptionListGroup>

            <DescriptionListGroup>
              <DescriptionListTerm>Max Context Length</DescriptionListTerm>
              <DescriptionListDescription>
                {memoryMetrics.max_model_len.toLocaleString()} tokens
              </DescriptionListDescription>
            </DescriptionListGroup>
          </DescriptionList>
        ) : !loading ? (
          <Alert variant="info" isInline title="Memory details not available">
            The model may still be loading or memory metrics could not be parsed from the logs.
          </Alert>
        ) : null}
      </ModalBody>

      <ModalFooter>
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  )
}

export default MemoryDetailsModal
