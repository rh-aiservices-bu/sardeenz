/**
 * Runtime settings store for application configuration
 * Settings are initialized from environment variables and can be updated at runtime
 * Note: Runtime updates are volatile and lost on server restart
 */

export type HfTokenSource = 'env' | 'runtime' | null

interface RuntimeSettings {
  hfToken: string | null
  hfTokenSource: HfTokenSource
}

class RuntimeSettingsStore {
  private settings: RuntimeSettings

  constructor() {
    const envToken = process.env.HF_TOKEN || null
    this.settings = {
      hfToken: envToken,
      hfTokenSource: envToken ? 'env' : null,
    }
  }

  /**
   * Get the HuggingFace token (full value)
   */
  getHfToken(): string | null {
    return this.settings.hfToken
  }

  /**
   * Get the source of the current HuggingFace token
   */
  getHfTokenSource(): HfTokenSource {
    return this.settings.hfTokenSource
  }

  /**
   * Set a new HuggingFace token (marks source as 'runtime')
   */
  setHfToken(token: string): void {
    this.settings.hfToken = token
    this.settings.hfTokenSource = 'runtime'
  }

  /**
   * Clear the HuggingFace token
   */
  clearHfToken(): void {
    this.settings.hfToken = null
    this.settings.hfTokenSource = null
  }

  /**
   * Get the masked HuggingFace token for display
   * Returns null if no token, or '****xxxx' format showing last 4 chars
   */
  getMaskedHfToken(): string | null {
    const token = this.settings.hfToken
    if (!token) return null

    if (token.length <= 4) {
      return '****'
    }

    return '****' + token.slice(-4)
  }

  /**
   * Get all settings (with masked token for API responses)
   */
  getSettingsResponse(): { hf_token: string | null; hf_token_source: HfTokenSource } {
    return {
      hf_token: this.getMaskedHfToken(),
      hf_token_source: this.settings.hfTokenSource,
    }
  }
}

// Singleton instance
export const runtimeSettings = new RuntimeSettingsStore()
