export interface ModelMemoryEstimate {
  modelPath: string
  detectedSizeB: number | null
  estimatedMemoryGB: number
  source: 'name-detection' | 'default'
}

const SIZE_REGEX = /(\d+(?:\.\d+)?)\s*[bB]\b/

export function estimateModelMemory(
  modelPath: string,
  defaultMemoryGB: number
): ModelMemoryEstimate {
  const match = modelPath.match(SIZE_REGEX)

  if (!match) {
    return {
      modelPath,
      detectedSizeB: null,
      estimatedMemoryGB: defaultMemoryGB,
      source: 'default',
    }
  }

  const params = parseFloat(match[1])

  // ≤30B: fp16 (2 bytes per param) → params * 2 GB
  // >30B: 4-bit quantized + overhead → params * 0.5 + 2 GB
  const estimatedMemoryGB = params <= 30 ? params * 2 : params * 0.5 + 2

  return {
    modelPath,
    detectedSizeB: params,
    estimatedMemoryGB,
    source: 'name-detection',
  }
}
