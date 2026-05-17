import { useState, useEffect, useCallback } from 'react'
import {
  Select,
  SelectOption,
  MenuToggle,
  Label,
  Flex,
  FlexItem,
  Spinner,
} from '@patternfly/react-core'
import { apiClient, type ClusterPod } from '../services/api'

interface PodSelectorProps {
  /** Currently selected pod ID */
  selectedPodId: string | undefined
  /** Callback when pod selection changes */
  onSelect: (podId: string) => void
  /** Whether the cluster is in multi-pod mode */
  isClusterMode: boolean
  /** Optional label for the selector */
  label?: string
}

/**
 * Dropdown to select a target pod for model operations.
 * Shows pod GPU capacity and health status.
 * Only rendered when in cluster mode.
 */
export function PodSelector({
  selectedPodId,
  onSelect,
  isClusterMode,
  label = 'Target pod',
}: PodSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [pods, setPods] = useState<ClusterPod[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const fetchPods = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await apiClient.getClusterPods()
      setPods(response.pods)
    } catch {
      // Silently handle - pods list will be empty
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isClusterMode) {
      fetchPods()
    }
  }, [isClusterMode, fetchPods])

  if (!isClusterMode) {
    return null
  }

  const selectedPod = pods.find((p) => p.podId === selectedPodId)

  const getStatusColor = (status: string): 'green' | 'orange' | 'red' => {
    switch (status) {
      case 'healthy':
        return 'green'
      case 'suspect':
        return 'orange'
      default:
        return 'red'
    }
  }

  const formatGpuSummary = (pod: ClusterPod): string => {
    const totalVram = pod.gpus.reduce((sum, g) => sum + g.totalVramMB, 0)
    const usedVram = pod.gpus.reduce((sum, g) => sum + g.usedVramMB, 0)
    const freeVram = totalVram - usedVram
    return `${pod.gpus.length} GPU${pod.gpus.length !== 1 ? 's' : ''}, ${(freeVram / 1024).toFixed(1)} GiB free`
  }

  const handleSelect = (
    _event: React.MouseEvent<Element, MouseEvent> | undefined,
    value: string | number | undefined
  ) => {
    if (value) {
      onSelect(String(value))
      setIsOpen(false)
    }
  }

  const toggleLabel = selectedPod
    ? `${selectedPod.podId} (${selectedPod.role})`
    : label

  return (
    <Select
      toggle={(toggleRef) => (
        <MenuToggle
          ref={toggleRef}
          onClick={() => setIsOpen(!isOpen)}
          isExpanded={isOpen}
          isDisabled={isLoading}
          style={{ minWidth: '250px' }}
        >
          {isLoading ? (
            <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
              <FlexItem>
                <Spinner size="sm" />
              </FlexItem>
              <FlexItem>Loading pods...</FlexItem>
            </Flex>
          ) : (
            toggleLabel
          )}
        </MenuToggle>
      )}
      onSelect={handleSelect}
      selected={selectedPodId}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
    >
      {pods.map((pod) => (
        <SelectOption
          key={pod.podId}
          value={pod.podId}
          isDisabled={pod.status === 'unavailable'}
          description={formatGpuSummary(pod)}
        >
          <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
            <FlexItem>{pod.podId}</FlexItem>
            <FlexItem>
              <Label color={getStatusColor(pod.status)} isCompact>
                {pod.status}
              </Label>
            </FlexItem>
            <FlexItem>
              <Label isCompact>{pod.role}</Label>
            </FlexItem>
          </Flex>
        </SelectOption>
      ))}
    </Select>
  )
}

export default PodSelector
