import { spawn } from 'child_process'
import type { Logger } from '@sardeenz/utils'
import { modelStore } from '../stores/model-store.js'
import { isProcessRunning } from '../utils/process.js'

export interface OrphanProcess {
  pid: number
  command: string
  args: string[]
  port?: number
  modelPath?: string
  startedAt?: Date
}

export interface OrphanScanResult {
  orphans: OrphanProcess[]
  trackedPids: number[]
  scannedAt: Date
}

/**
 * Orphan Process Detector (FR-027)
 * Detects vLLM processes running on the system that are not tracked by the controller
 */
export class OrphanDetector {
  private logger: Logger

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'OrphanDetector' })
  }

  /**
   * Scan for orphan vLLM processes
   * Returns processes that are running but not tracked in modelStore
   */
  async scan(): Promise<OrphanScanResult> {
    this.logger.debug('Scanning for orphan vLLM processes')

    // Get all vLLM processes on the system
    const systemProcesses = await this.findVllmProcesses()

    // Get PIDs tracked by the model store (both processId and engineCorePid)
    const trackedInstances = modelStore.getAll()
    const trackedPids = new Set([
      ...trackedInstances.map((i) => i.processId),
      ...trackedInstances.filter((i) => i.engineCorePid).map((i) => i.engineCorePid!),
    ])

    // Find orphans (running but not tracked)
    const orphans = systemProcesses.filter((proc) => !trackedPids.has(proc.pid))

    this.logger.info(
      {
        totalSystemProcesses: systemProcesses.length,
        trackedCount: trackedPids.size,
        orphanCount: orphans.length,
      },
      'Orphan scan complete'
    )

    return {
      orphans,
      trackedPids: Array.from(trackedPids),
      scannedAt: new Date(),
    }
  }

  /**
   * Kill an orphan process by PID
   * Only kills processes identified as vLLM to prevent accidental kills
   */
  async killOrphan(pid: number): Promise<{ success: boolean; message: string }> {
    this.logger.info({ pid }, 'Attempting to kill orphan process')

    // Verify process is actually vLLM
    const vllmProcesses = await this.findVllmProcesses()
    const isVllm = vllmProcesses.some((p) => p.pid === pid)

    if (!isVllm) {
      return {
        success: false,
        message: `PID ${pid} is not a vLLM process`,
      }
    }

    // Verify it's not tracked (safety check - includes both processId and engineCorePid)
    const trackedInstances = modelStore.getAll()
    const isTracked = trackedInstances.some((i) => i.processId === pid || i.engineCorePid === pid)

    if (isTracked) {
      return {
        success: false,
        message: `PID ${pid} is tracked by the controller - use unload endpoint instead`,
      }
    }

    try {
      // Send SIGTERM first for graceful shutdown
      process.kill(pid, 'SIGTERM')

      // Wait briefly and check if still running
      await new Promise((resolve) => setTimeout(resolve, 2000))

      if (isProcessRunning(pid)) {
        // Force kill if still running
        process.kill(pid, 'SIGKILL')
        this.logger.warn({ pid }, 'Process required SIGKILL')
      }

      this.logger.info({ pid }, 'Orphan process killed successfully')
      return {
        success: true,
        message: `Process ${pid} terminated`,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      this.logger.error({ pid, err }, 'Failed to kill orphan process')
      return {
        success: false,
        message: `Failed to kill process ${pid}: ${message}`,
      }
    }
  }

  /**
   * Kill all orphan processes
   */
  async killAllOrphans(): Promise<{
    killed: number[]
    failed: Array<{ pid: number; error: string }>
  }> {
    const scanResult = await this.scan()
    const killed: number[] = []
    const failed: Array<{ pid: number; error: string }> = []

    for (const orphan of scanResult.orphans) {
      const result = await this.killOrphan(orphan.pid)
      if (result.success) {
        killed.push(orphan.pid)
      } else {
        failed.push({ pid: orphan.pid, error: result.message })
      }
    }

    this.logger.info(
      { killedCount: killed.length, failedCount: failed.length },
      'Killed orphan processes'
    )

    return { killed, failed }
  }

  /**
   * Find all vLLM processes on the system using ps command
   * Looks for processes with 'vllm' in the command
   */
  private async findVllmProcesses(): Promise<OrphanProcess[]> {
    return new Promise((resolve) => {
      const processes: OrphanProcess[] = []

      // Use ps to find vLLM processes
      // ps -eo pid,lstart,args | grep vllm
      const ps = spawn('ps', ['-eo', 'pid,lstart,args'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''

      ps.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      ps.on('error', (err) => {
        this.logger.warn({ err }, 'Failed to run ps command')
        resolve([])
      })

      ps.on('exit', () => {
        const lines = stdout.split('\n').slice(1) // Skip header

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          // Only consider vLLM processes
          if (!trimmed.includes('vllm')) continue

          // Skip grep itself
          if (trimmed.includes('grep')) continue

          const parsed = this.parsePsLine(trimmed)
          if (parsed) {
            processes.push(parsed)
          }
        }

        resolve(processes)
      })
    })
  }

  /**
   * Parse a ps output line into an OrphanProcess
   * Format: PID LSTART COMMAND
   * Example: 12345 Tue Nov 21 10:30:00 2023 vllm serve meta-llama/Llama-3.2-1B --port=8000
   */
  private parsePsLine(line: string): OrphanProcess | null {
    try {
      // First token is PID
      const tokens = line.split(/\s+/)
      if (tokens.length < 6) return null

      const pid = parseInt(tokens[0], 10)
      if (isNaN(pid)) return null

      // Skip self
      if (pid === process.pid) return null

      // Parse date (5 tokens: DOW Month Day Time Year)
      // Example: "Tue Nov 21 10:30:00 2023"
      const dateStr = tokens.slice(1, 6).join(' ')
      const startedAt = new Date(dateStr)

      // Rest is the command
      const commandTokens = tokens.slice(6)
      const command = commandTokens[0] || 'vllm'
      const args = commandTokens.slice(1)

      // Extract port if present
      let port: number | undefined
      for (const arg of args) {
        const portMatch = arg.match(/--port[=\s]?(\d+)/)
        if (portMatch) {
          port = parseInt(portMatch[1], 10)
          break
        }
      }

      // Extract model path if this looks like 'vllm serve <model>'
      let modelPath: string | undefined
      if (command === 'vllm' && args[0] === 'serve' && args[1]) {
        modelPath = args[1]
      }

      return {
        pid,
        command,
        args,
        port,
        modelPath,
        startedAt: isNaN(startedAt.getTime()) ? undefined : startedAt,
      }
    } catch {
      return null
    }
  }

  /**
   * Perform startup scan and log results
   * Called during server initialization
   */
  async performStartupScan(): Promise<void> {
    this.logger.info('Performing startup orphan scan')

    try {
      const result = await this.scan()

      if (result.orphans.length > 0) {
        this.logger.warn(
          {
            orphanCount: result.orphans.length,
            orphans: result.orphans.map((o) => ({
              pid: o.pid,
              port: o.port,
              modelPath: o.modelPath,
            })),
          },
          'Orphan vLLM processes detected at startup. Use /api/orphans/kill-all to clean up.'
        )
      } else {
        this.logger.info('No orphan processes detected at startup')
      }
    } catch (err) {
      this.logger.error({ err }, 'Failed to perform startup orphan scan')
    }
  }
}
