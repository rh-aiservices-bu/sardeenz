import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type {
  SSEEvent,
  SSEEventType,
  LogEvent,
  StatusEvent,
  ProgressEvent,
  ModelStatus,
} from '@sardeenz/types'
import type { LogEntry } from './process-log-buffer.js'

/**
 * Represents an active SSE connection
 */
export interface SSEConnection {
  /** Unique connection ID */
  id: string
  /** Function to send an event to this connection */
  send: (event: SSEEvent) => void
  /** Event types this connection is subscribed to */
  filters: SSEEventType[]
}

/**
 * Centralized event bus for SSE event distribution.
 * Manages connections per model instance and broadcasts events to subscribers.
 */
export class EventBus extends EventEmitter {
  private static instance: EventBus

  /** Active SSE connections per instance ID */
  private connections: Map<string, Set<SSEConnection>> = new Map()

  /**
   * Get singleton instance of EventBus
   */
  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus()
    }
    return EventBus.instance
  }

  /**
   * Subscribe to events for a model instance
   */
  subscribe(instanceId: string, connection: SSEConnection): void {
    if (!this.connections.has(instanceId)) {
      this.connections.set(instanceId, new Set())
    }
    this.connections.get(instanceId)!.add(connection)
  }

  /**
   * Unsubscribe from events for a model instance
   */
  unsubscribe(instanceId: string, connection: SSEConnection): void {
    this.connections.get(instanceId)?.delete(connection)
    // Clean up empty sets
    if (this.connections.get(instanceId)?.size === 0) {
      this.connections.delete(instanceId)
    }
  }

  /**
   * Get the number of active connections for an instance
   */
  getConnectionCount(instanceId: string): number {
    return this.connections.get(instanceId)?.size ?? 0
  }

  /**
   * Emit an event to all subscribers of an instance
   */
  emitEvent(event: SSEEvent): void {
    const connections = this.connections.get(event.instanceId)
    if (connections) {
      for (const conn of connections) {
        // Apply filter if connection has specific event type filters
        if (conn.filters.length === 0 || conn.filters.includes(event.eventType)) {
          try {
            conn.send(event)
          } catch {
            // Connection may be closed, will be cleaned up by unsubscribe
          }
        }
      }
    }
  }

  /**
   * Create a LogEvent from a LogEntry
   */
  createLogEvent(instanceId: string, entry: LogEntry, lineNumber?: number): LogEvent {
    return {
      id: randomUUID(),
      timestamp: entry.timestamp.toISOString(),
      instanceId,
      eventType: 'log',
      data: {
        stream: entry.stream,
        content: entry.content,
        lineNumber,
      },
    }
  }

  /**
   * Create a StatusEvent for model state transitions
   */
  createStatusEvent(
    instanceId: string,
    previousStatus: ModelStatus | null,
    currentStatus: ModelStatus,
    message?: string,
    errorMessage?: string
  ): StatusEvent {
    return {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      instanceId,
      eventType: 'status',
      data: {
        previousStatus,
        currentStatus,
        message,
        errorMessage,
      },
    }
  }

  /**
   * Create a ProgressEvent for model loading progress
   */
  createProgressEvent(
    instanceId: string,
    phase: ProgressEvent['data']['phase'],
    progress: number | undefined,
    message: string
  ): ProgressEvent {
    return {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      instanceId,
      eventType: 'progress',
      data: {
        phase,
        progress,
        message,
      },
    }
  }

  /**
   * Clean up all connections (for shutdown)
   */
  cleanup(): void {
    this.connections.clear()
  }
}

/** Singleton instance for global use */
export const eventBus = EventBus.getInstance()
