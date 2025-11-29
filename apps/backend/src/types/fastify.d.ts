import 'fastify'

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * Controls request/response logging for this route.
     *
     * - `true` (default): Log successful requests at info level
     * - `false`: Log successful requests at debug level (quiet)
     *
     * Note: Errors (4xx/5xx) are ALWAYS logged regardless of this setting.
     */
    logRequests?: boolean
  }
}
