import pino from 'pino'

export interface LoggerOptions {
  level?: string
  name?: string
}

export function createLogger(options: LoggerOptions = {}) {
  const level = options.level || process.env.LOG_LEVEL || 'info'
  const name = options.name || 'sardeenz'

  return pino({
    level,
    name,
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        hostname: req.hostname,
        remoteAddress: req.ip,
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
      err: pino.stdSerializers.err,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => {
        return { level: label }
      },
    },
  })
}

/**
 * Logger interface compatible with both pino and FastifyBaseLogger
 * Uses a minimal interface to ensure compatibility
 * Supports both (obj, msg) and (msg) call signatures like pino
 */
export interface Logger {
  info: ((obj: object, msg?: string) => void) & ((msg: string) => void)
  error: ((obj: object, msg?: string) => void) & ((msg: string) => void)
  warn: ((obj: object, msg?: string) => void) & ((msg: string) => void)
  debug: ((obj: object, msg?: string) => void) & ((msg: string) => void)
  trace: ((obj: object, msg?: string) => void) & ((msg: string) => void)
  child: (bindings: Record<string, unknown>) => Logger
}
