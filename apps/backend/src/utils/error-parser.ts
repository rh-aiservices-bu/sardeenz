/**
 * Utility for extracting meaningful error messages from vLLM process output
 */

import type { LogEntry } from '../services/process-log-buffer.js'

/**
 * Common vLLM error patterns and their user-friendly descriptions
 */
const ERROR_PATTERNS: Array<{
  pattern: RegExp
  extract: (match: RegExpMatchArray, line: string) => string
}> = [
  // CUDA Out of Memory
  {
    pattern: /CUDA out of memory/i,
    extract: (_match, line) => {
      // Try to extract memory details
      const details = line.match(/Tried to allocate ([\d.]+ \w+)/i)
      const gpu = line.match(/GPU (\d+)/i)
      let msg = 'CUDA out of memory'
      if (details) msg += `. Tried to allocate ${details[1]}`
      if (gpu) msg += ` on GPU ${gpu[1]}`
      msg += '. Consider reducing --gpu-memory-utilization or --max-model-len'
      return msg
    },
  },
  // Model not found
  {
    pattern: /(?:FileNotFoundError|OSError).*(?:does not appear to have|No such file|not found)/i,
    extract: (_match, line) => {
      const modelMatch = line.match(/['"]([\w\-./]+)['"]/g)
      if (modelMatch) {
        return `Model not found: ${modelMatch[0].replace(/['"]/g, '')}. Check the model path or ensure it's downloaded.`
      }
      return 'Model file not found. Check the model path.'
    },
  },
  // Torch/CUDA version mismatch
  {
    pattern: /CUDA.*version.*mismatch|torch.*not compiled with CUDA/i,
    extract: () => 'CUDA/PyTorch version mismatch. Check your CUDA installation.',
  },
  // Invalid model architecture
  {
    pattern: /(?:KeyError|ValueError).*(?:architecture|config|model_type)/i,
    extract: (_match, line) => {
      const archMatch = line.match(/['"]([\w-]+)['"]/g)
      if (archMatch) {
        return `Unsupported model architecture: ${archMatch[0].replace(/['"]/g, '')}. This model may not be compatible with vLLM.`
      }
      return 'Unsupported model architecture. This model may not be compatible with vLLM.'
    },
  },
  // Token length exceeded
  {
    pattern: /max.*model.*len|context.*length.*exceed/i,
    extract: () => 'Model context length exceeded. Reduce --max-model-len parameter.',
  },
  // Port already in use
  {
    pattern: /Address already in use|port.*already.*use|bind.*failed/i,
    extract: (_match, line) => {
      const portMatch = line.match(/port[:\s]*(\d+)/i)
      if (portMatch) {
        return `Port ${portMatch[1]} is already in use. Another model or process may be using it.`
      }
      return 'Port already in use. Another model or process may be using it.'
    },
  },
  // GPU not available
  {
    pattern: /no.*GPU.*available|CUDA.*not available|cuda.*device.*not found/i,
    extract: () => 'No GPU available. Check CUDA installation and GPU drivers.',
  },
  // Generic Python exception (fallback)
  {
    pattern: /^(\w+Error|\w+Exception):\s*(.+)$/,
    extract: (match) => `${match[1]}: ${match[2]}`,
  },
]

/**
 * Extract a meaningful error message from vLLM process logs
 * Returns null if no recognizable error pattern is found
 */
export function extractVllmError(logs: LogEntry[]): string | null {
  // Focus on stderr lines, process in reverse (most recent first)
  const stderrLines = logs
    .filter((entry) => entry.stream === 'stderr')
    .map((entry) => entry.content)
    .reverse()

  // Try to match error patterns
  for (const line of stderrLines) {
    for (const { pattern, extract } of ERROR_PATTERNS) {
      const match = line.match(pattern)
      if (match) {
        return extract(match, line)
      }
    }
  }

  // Look for Python traceback with the actual exception at the end
  const allLines = logs.map((entry) => entry.content)
  const tracebackEndIdx = allLines.findIndex((line) =>
    line.includes('Traceback (most recent call last)')
  )

  if (tracebackEndIdx !== -1) {
    // Find the last line that looks like an exception
    for (let i = allLines.length - 1; i > tracebackEndIdx; i--) {
      const line = allLines[i]
      if (/^\w+Error:|^\w+Exception:/.test(line.trim())) {
        return line.trim()
      }
    }
  }

  return null
}

/**
 * Build a comprehensive error message including extracted error and context
 */
export function buildErrorMessage(
  logs: LogEntry[],
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  maxContextLines: number = 10
): string {
  const extractedError = extractVllmError(logs)

  if (extractedError) {
    return extractedError
  }

  // Fallback: include last few stderr lines for context
  const stderrLines = logs
    .filter((entry) => entry.stream === 'stderr')
    .slice(-maxContextLines)
    .map((entry) => entry.content)

  if (stderrLines.length > 0) {
    const context = stderrLines.join('\n')
    return `Process exited with code ${exitCode ?? 'unknown'} (signal: ${signal ?? 'none'})\n\nLast stderr output:\n${context}`
  }

  return `Process exited unexpectedly with code ${exitCode ?? 'unknown'} (signal: ${signal ?? 'none'})`
}
