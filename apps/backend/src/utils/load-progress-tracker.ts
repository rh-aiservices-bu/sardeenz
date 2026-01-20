/**
 * vLLM Loading Progress Tracker
 *
 * Parses vLLM logs in real-time to track model loading milestones and provides
 * meaningful progress updates during model move operations.
 */

/**
 * Loading milestone definition
 */
export interface LoadingMilestone {
  name: string
  pattern: RegExp
  baseProgress: number
}

/**
 * vLLM loading milestones in order of occurrence
 * Progress values are calibrated based on typical load times
 *
 * Note: EngineCore PID appears early in logs (same time as "Starting to load model"),
 * not at the end, so it's not useful as a milestone.
 */
export const LOADING_MILESTONES: LoadingMilestone[] = [
  { name: 'platform_detected', pattern: /detected platform/i, baseProgress: 10 },
  { name: 'model_load_started', pattern: /Starting to load model/i, baseProgress: 20 },
  { name: 'weights_loaded', pattern: /Loading weights took/i, baseProgress: 40 },
  { name: 'model_loading_complete', pattern: /Model loading took/i, baseProgress: 55 },
  { name: 'kv_cache_allocated', pattern: /Available KV cache memory/i, baseProgress: 70 },
  { name: 'cuda_graphs_captured', pattern: /Graph capturing finished/i, baseProgress: 85 },
]

/**
 * Internal state for tracking progress
 */
interface ProgressState {
  currentMilestone: number
  currentProgress: number
  lastMilestoneTime: number
}

/**
 * Tracks vLLM model loading progress by parsing log output
 */
export class LoadProgressTracker {
  private state: ProgressState
  private expectedDurationMs: number

  constructor(expectedDurationMs?: number) {
    this.state = {
      currentMilestone: -1,
      currentProgress: 0,
      lastMilestoneTime: Date.now(),
    }
    // Default to 3 minutes if no estimate provided
    this.expectedDurationMs = expectedDurationMs ?? 180000
  }

  /**
   * Process a log line and update progress state
   * Returns new progress value if a milestone was reached, undefined otherwise
   */
  processLogLine(content: string): number | undefined {
    for (let i = this.state.currentMilestone + 1; i < LOADING_MILESTONES.length; i++) {
      const milestone = LOADING_MILESTONES[i]
      if (milestone.pattern.test(content)) {
        this.state.currentMilestone = i
        this.state.currentProgress = milestone.baseProgress
        this.state.lastMilestoneTime = Date.now()
        return this.state.currentProgress
      }
    }
    return undefined
  }

  /**
   * Get interpolated progress based on time since last milestone
   * Provides smooth progress updates between milestone detections
   */
  getInterpolatedProgress(): number {
    const now = Date.now()
    const elapsed = now - this.state.lastMilestoneTime

    if (this.state.currentMilestone < 0) {
      // No milestones yet - ramp up from 0 to 5% over first 10 seconds
      return Math.min(5, Math.floor((elapsed / 10000) * 5))
    }

    const currentMilestone = LOADING_MILESTONES[this.state.currentMilestone]
    const nextMilestone = LOADING_MILESTONES[this.state.currentMilestone + 1]

    if (!nextMilestone) {
      // At final milestone, slowly approach 95%
      const targetProgress = 95
      const maxWait = 60000 // 1 minute to go from 90 to 95
      const additionalProgress = Math.min(5, (elapsed / maxWait) * 5)
      return Math.min(targetProgress, Math.floor(this.state.currentProgress + additionalProgress))
    }

    // Interpolate between current and next milestone
    const progressRange = nextMilestone.baseProgress - currentMilestone.baseProgress
    const expectedWait = this.expectedDurationMs / LOADING_MILESTONES.length
    const interpolatedProgress = Math.min(
      progressRange - 1, // Don't exceed next milestone
      (elapsed / expectedWait) * progressRange
    )

    return Math.floor(this.state.currentProgress + interpolatedProgress)
  }

  /**
   * Process existing log entries to catch milestones that fired before subscription.
   * Returns the highest progress value reached, or undefined if no milestones matched.
   */
  processExistingLogs(entries: Array<{ content: string }>): number | undefined {
    let highestProgress: number | undefined

    for (const entry of entries) {
      const progress = this.processLogLine(entry.content)
      if (progress !== undefined) {
        highestProgress = progress
      }
    }

    return highestProgress
  }

  /**
   * Get human-readable progress message based on current progress
   */
  static getProgressMessage(progress: number): string {
    if (progress < 15) return 'Initializing model load...'
    if (progress < 30) return 'Preparing to load model weights...'
    if (progress < 50) return 'Loading model weights...'
    if (progress < 65) return 'Model weights loaded, allocating memory...'
    if (progress < 80) return 'Allocating KV cache memory...'
    if (progress < 95) return 'Capturing CUDA graphs...'
    if (progress < 100) return 'Finalizing model startup...'
    return 'Target model is ready'
  }
}
