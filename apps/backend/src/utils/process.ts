import { spawn, ChildProcess } from 'child_process'
import * as fs from 'node:fs'

export interface ProcessOptions {
  command: string
  args: string[]
  env?: Record<string, string>
  cwd?: string
  timeout?: number
}

export interface ProcessResult {
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
}

/**
 * Spawn a process and capture output
 */
export async function spawnProcess(options: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(options.command, options.args, {
      env: { ...process.env, ...options.env },
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    const timeoutId = options.timeout
      ? setTimeout(() => {
          proc.kill('SIGKILL')
          reject(new Error(`Process timed out after ${options.timeout}ms`))
        }, options.timeout)
      : undefined

    proc.on('exit', (exitCode, signal) => {
      if (timeoutId) clearTimeout(timeoutId)
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        signal,
      })
    })

    proc.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId)
      reject(err)
    })
  })
}

/**
 * Check if a process is running by PID
 */
export function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 tests for process existence without killing it
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Kill a process gracefully (SIGTERM) with fallback to SIGKILL
 */
export async function killProcessGracefully(
  proc: ChildProcess,
  timeout: number = 30000
): Promise<void> {
  return new Promise((resolve) => {
    if (!proc.pid) {
      resolve()
      return
    }

    // Try graceful shutdown first
    proc.kill('SIGTERM')

    const killTimeout = setTimeout(() => {
      if (proc.pid && isProcessRunning(proc.pid)) {
        proc.kill('SIGKILL')
      }
    }, timeout)

    proc.on('exit', () => {
      clearTimeout(killTimeout)
      resolve()
    })
  })
}

/**
 * Kill a process and all its descendants with SIGKILL (bypasses signal handlers)
 * Use this for vLLM/kvcached processes where Python signal handlers would
 * delete the shared IPC segment, breaking other running models.
 *
 * SIGKILL doesn't propagate to children, so we must explicitly kill all
 * descendant processes (like vLLM's EngineCore) before killing the parent.
 */
export async function killProcessImmediate(
  proc: ChildProcess,
  timeout: number = 5000
): Promise<void> {
  if (!proc.pid) {
    return
  }

  // Get all descendant PIDs before killing (they'll disappear after parent dies)
  const descendants = await getDescendantPids(proc.pid)

  // Kill descendants first (children before parent) to ensure GPU processes are cleaned up
  for (const pid of descendants) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Process may have already exited
    }
  }

  // Kill the parent process
  return new Promise((resolve) => {
    proc.kill('SIGKILL')

    const killTimeout = setTimeout(() => {
      resolve() // Timeout, process likely dead
    }, timeout)

    proc.on('exit', () => {
      clearTimeout(killTimeout)
      resolve()
    })
  })
}

/**
 * Get the next available port in a range
 */
export function getNextPort(basePort: number, usedPorts: Set<number>): number {
  let port = basePort
  while (usedPorts.has(port)) {
    port++
    if (port > 65535) {
      throw new Error('No available ports')
    }
  }
  return port
}

/**
 * Wait for a condition to be true with polling
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: {
    timeout?: number
    interval?: number
    timeoutMessage?: string
  } = {}
): Promise<void> {
  const {
    timeout = 30000,
    interval = 1000,
    timeoutMessage = 'Timeout waiting for condition',
  } = options

  const start = Date.now()

  while (true) {
    const result = await condition()
    if (result) {
      return
    }

    if (Date.now() - start > timeout) {
      throw new Error(timeoutMessage)
    }

    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}

/**
 * Get all descendant PIDs of a process (children, grandchildren, etc.)
 * Uses /proc filesystem on Linux to traverse the process tree
 */
export async function getDescendantPids(parentPid: number): Promise<number[]> {
  const descendants: number[] = []
  const queue: number[] = [parentPid]

  while (queue.length > 0) {
    const pid = queue.shift()!
    try {
      // Read /proc/<pid>/task/<pid>/children for direct children
      const childrenPath = `/proc/${pid}/task/${pid}/children`
      const childrenContent = await fs.promises.readFile(childrenPath, 'utf-8')
      const childPids = childrenContent
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(Number)
        .filter((n) => !isNaN(n))

      for (const childPid of childPids) {
        descendants.push(childPid)
        queue.push(childPid) // Check grandchildren too
      }
    } catch {
      // Process may have exited, or file doesn't exist
    }
  }

  return descendants
}

/**
 * Find all vLLM-related processes by port number.
 * Searches for processes containing 'vllm' with --port=<port> in their args.
 * This is more reliable than tree-walking for processes that may have
 * escaped the parent-child hierarchy (e.g., Python multiprocessing workers).
 */
export async function findVllmProcessesByPort(port: number): Promise<number[]> {
  return new Promise((resolve) => {
    const pids: number[] = []

    // Use ps to find all processes with their args
    const ps = spawn('ps', ['-eo', 'pid,args'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''

    ps.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    ps.on('error', () => {
      resolve([])
    })

    ps.on('exit', () => {
      const lines = stdout.split('\n').slice(1) // Skip header

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        // Only consider vLLM processes
        if (!trimmed.includes('vllm')) continue

        // Skip grep/ps itself
        if (trimmed.includes('grep') || trimmed.includes('ps -eo')) continue

        // Check if this process has the target port
        const portPattern = new RegExp(`--port[=\\s]?${port}(?:\\s|$)`)
        if (!portPattern.test(trimmed)) continue

        // Extract PID (first token)
        const tokens = trimmed.split(/\s+/)
        const pid = parseInt(tokens[0], 10)
        if (isNaN(pid)) continue

        // Skip self
        if (pid === process.pid) continue

        pids.push(pid)
      }

      resolve(pids)
    })
  })
}

/**
 * Find all processes with a specific environment variable.
 * Reads /proc/<pid>/environ for each process on the system.
 * This is useful for finding child processes that may have re-parented to init
 * but still carry the inherited environment variable.
 */
export async function findProcessesByEnvMarker(
  envName: string,
  envValue: string
): Promise<number[]> {
  const pids: number[] = []
  const marker = `${envName}=${envValue}`

  try {
    const procDirs = await fs.promises.readdir('/proc')

    for (const dir of procDirs) {
      const pid = parseInt(dir, 10)
      if (isNaN(pid)) continue

      // Skip self
      if (pid === process.pid) continue

      try {
        // /proc/<pid>/environ contains null-separated KEY=value pairs
        const environ = await fs.promises.readFile(`/proc/${pid}/environ`, 'utf-8')
        if (environ.includes(marker)) {
          pids.push(pid)
        }
      } catch {
        // Process may have exited or we don't have permission
      }
    }
  } catch {
    // /proc not accessible (non-Linux system)
  }

  return pids
}
