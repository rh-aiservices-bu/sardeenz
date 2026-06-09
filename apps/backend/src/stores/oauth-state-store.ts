import { getPool } from '../db/index.js'

const STATE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface OAuthState {
  callbackUrl: string
  createdAt: number
}

class OAuthStateStore {
  async save(state: string, callbackUrl: string): Promise<void> {
    const pool = getPool()
    await pool.query('INSERT INTO oauth_states (state, callback_url) VALUES ($1, $2)', [
      state,
      callbackUrl,
    ])
  }

  async consume(state: string): Promise<OAuthState | null> {
    const pool = getPool()
    const result = await pool.query(
      `DELETE FROM oauth_states
       WHERE state = $1
         AND created_at > NOW() - INTERVAL '${STATE_TTL_MS / 1000} seconds'
       RETURNING callback_url, created_at`,
      [state]
    )

    if (result.rows.length === 0) return null

    return {
      callbackUrl: result.rows[0].callback_url,
      createdAt: new Date(result.rows[0].created_at).getTime(),
    }
  }

  async cleanup(): Promise<void> {
    const pool = getPool()
    await pool.query(
      `DELETE FROM oauth_states WHERE created_at < NOW() - INTERVAL '${STATE_TTL_MS / 1000} seconds'`
    )
  }
}

export const oauthStateStore = new OAuthStateStore()
