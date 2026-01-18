/**
 * Ring buffer for storing process stdout/stderr output
 * Supports bounded memory usage with configurable line limits
 * and automatic cleanup for failed process logs
 */

export interface LogEntry {
  timestamp: Date
  stream: 'stdout' | 'stderr'
  content: string
}

export interface ProcessLogBufferOptions {
  maxLines?: number
  failedRetentionMs?: number
}

const DEFAULT_MAX_LINES = 500
const DEFAULT_FAILED_RETENTION_MS = 30 * 60 * 1000 // 30 minutes

/** Type for log entry listener callback */
export type LogEntryListener = (entry: LogEntry) => void

export class ProcessLogBuffer {
  private buffers: Map<string, LogEntry[]> = new Map()
  private cleanupTimeouts: Map<string, NodeJS.Timeout> = new Map()
  private logListeners: Map<string, Set<LogEntryListener>> = new Map()
  private maxLines: number
  private failedRetentionMs: number

  constructor(options: ProcessLogBufferOptions = {}) {
    this.maxLines = options.maxLines ?? DEFAULT_MAX_LINES
    this.failedRetentionMs = options.failedRetentionMs ?? DEFAULT_FAILED_RETENTION_MS
  }

  /**
   * Register a listener for log entries (for SSE streaming)
   * Returns an unsubscribe function
   */
  onLog(instanceId: string, listener: LogEntryListener): () => void {
    if (!this.logListeners.has(instanceId)) {
      this.logListeners.set(instanceId, new Set())
    }
    this.logListeners.get(instanceId)!.add(listener)

    // Return unsubscribe function
    return () => {
      this.logListeners.get(instanceId)?.delete(listener)
      if (this.logListeners.get(instanceId)?.size === 0) {
        this.logListeners.delete(instanceId)
      }
    }
  }

  /**
   * Append a log line to the buffer for a given instance
   * Automatically trims to maxLines (ring buffer behavior)
   * Notifies any registered listeners of new entries
   */
  append(instanceId: string, stream: 'stdout' | 'stderr', content: string): void {
    if (!this.buffers.has(instanceId)) {
      this.buffers.set(instanceId, [])
    }

    const buffer = this.buffers.get(instanceId)!
    const listeners = this.logListeners.get(instanceId)

    // Split content by newlines and add each line separately
    const lines = content.split('\n').filter((line) => line.trim())
    for (const line of lines) {
      const entry: LogEntry = {
        timestamp: new Date(),
        stream,
        content: line,
      }
      buffer.push(entry)

      // Notify listeners of new entry
      if (listeners) {
        for (const listener of listeners) {
          try {
            listener(entry)
          } catch {
            // Listener may have thrown, continue with others
          }
        }
      }
    }

    // Trim to maxLines (keep most recent)
    if (buffer.length > this.maxLines) {
      buffer.splice(0, buffer.length - this.maxLines)
    }
  }

  /**
   * Get all buffered logs for an instance
   */
  getBuffer(instanceId: string): LogEntry[] {
    return this.buffers.get(instanceId) ?? []
  }

  /**
   * Get the last N lines from the buffer, formatted as a string
   */
  getLastLines(instanceId: string, n: number = 50): string {
    const buffer = this.getBuffer(instanceId)
    const lastN = buffer.slice(-n)
    return lastN.map((entry) => `[${entry.stream}] ${entry.content}`).join('\n')
  }

  /**
   * Get the last N stderr lines, formatted as a string
   */
  getLastStderrLines(instanceId: string, n: number = 20): string {
    const buffer = this.getBuffer(instanceId)
    const stderrLines = buffer.filter((entry) => entry.stream === 'stderr').slice(-n)
    return stderrLines.map((entry) => entry.content).join('\n')
  }

  /**
   * Clear the buffer for an instance immediately
   * Also removes any registered listeners
   */
  clear(instanceId: string): void {
    this.buffers.delete(instanceId)
    this.logListeners.delete(instanceId)
    this.cancelScheduledCleanup(instanceId)
  }

  /**
   * Schedule cleanup of buffer after a delay (for failed processes)
   */
  scheduleCleanup(instanceId: string, delayMs: number = this.failedRetentionMs): void {
    this.cancelScheduledCleanup(instanceId)

    const timeout = setTimeout(() => {
      this.buffers.delete(instanceId)
      this.cleanupTimeouts.delete(instanceId)
    }, delayMs)

    this.cleanupTimeouts.set(instanceId, timeout)
  }

  /**
   * Cancel any scheduled cleanup for an instance
   */
  private cancelScheduledCleanup(instanceId: string): void {
    const existing = this.cleanupTimeouts.get(instanceId)
    if (existing) {
      clearTimeout(existing)
      this.cleanupTimeouts.delete(instanceId)
    }
  }

  /**
   * Check if we have logs for an instance
   */
  has(instanceId: string): boolean {
    return this.buffers.has(instanceId)
  }

  /**
   * Get the number of lines in the buffer for an instance
   */
  size(instanceId: string): number {
    return this.getBuffer(instanceId).length
  }

  /**
   * Clean up all buffers, timeouts, and listeners (for shutdown)
   */
  cleanup(): void {
    for (const timeout of this.cleanupTimeouts.values()) {
      clearTimeout(timeout)
    }
    this.cleanupTimeouts.clear()
    this.buffers.clear()
    this.logListeners.clear()
  }
}

// Singleton instance for global use
export const processLogBuffer = new ProcessLogBuffer()
