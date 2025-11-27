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
} from '@patternfly/react-core'
import type { ModelMemoryMetricsDTO } from '@sardeenz/types'

interface MemoryDetailsModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback when modal should close */
  onClose: () => void
  /** Model path for display in title */
  modelPath: string
  /** Memory metrics from the API (null if not available) */
  memoryMetrics: ModelMemoryMetricsDTO | null
  /** GPU memory utilization percentage (0-1) */
  gpuMemoryUtilization: number
}

/**
 * Modal displaying detailed memory metrics for a loaded model.
 * Shows weights, CUDA graphs, KV cache, and per-request memory usage.
 */
export function MemoryDetailsModal({
  isOpen,
  onClose,
  modelPath,
  memoryMetrics,
  gpuMemoryUtilization,
}: MemoryDetailsModalProps) {
  const formatGiB = (value: number) => `${value.toFixed(2)} GiB`
  const formatMiB = (value: number) => `${value.toFixed(2)} MiB`
  const formatPercent = (value: number) => `${(value * 100).toFixed(0)}%`

  return (
    <Modal variant={ModalVariant.medium} isOpen={isOpen} onClose={onClose}>
      <ModalHeader title={`Memory Details - ${modelPath}`} />
      <ModalBody>
        {memoryMetrics ? (
          <DescriptionList isHorizontal>
            <DescriptionListGroup>
              <DescriptionListTerm>Total GPU Utilization</DescriptionListTerm>
              <DescriptionListDescription>
                {formatPercent(gpuMemoryUtilization)}
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
              <DescriptionListTerm>KV Cache Available</DescriptionListTerm>
              <DescriptionListDescription>
                {formatGiB(memoryMetrics.kv_cache_available_gib)}
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
        ) : (
          <Alert variant="info" isInline title="Memory details not available">
            The model may still be loading or memory metrics could not be parsed from the logs.
          </Alert>
        )}
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
