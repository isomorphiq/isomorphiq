// Simple logger utility
export class Logger {
  private level: 'debug' | 'info' | 'warn' | 'error' = 'info'

  constructor(level: 'debug' | 'info' | 'warn' | 'error' = 'info') {
    this.level = level
  }

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error']
    return levels.indexOf(level) >= levels.indexOf(this.level)
  }

  private formatMessage(level: string, message: string, meta?: any): string {
    const timestamp = new Date().toISOString()
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : ''
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`
  }

  debug(message: string, meta?: any) {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, meta))
    }
  }

  info(message: string, meta?: any) {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, meta))
    }
  }

  warn(message: string, meta?: any) {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta))
    }
  }

  error(message: string, meta?: any) {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, meta))
    }
  }
}