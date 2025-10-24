const winston = require('winston');
const path = require('path');
const fs = require('fs').promises;

/**
 * Logger utility for the Actual-Xero Sync application
 * Provides structured logging with contextual information, log rotation, and retention management
 */
class Logger {
  constructor() {
    this.logger = null;
    this.logDir = process.env.LOG_DIR || '/var/log';
    this.logFile = 'actual-xero-sync.log';
    this.context = {};
  }

  /**
   * Initialize logger with configuration
   * @param {string} logLevel - Log level (debug, info, warn, error)
   * @param {Object} options - Additional configuration options
   */
  async init(logLevel = 'info', options = {}) {
    const config = {
      maxFileSize: options.maxFileSize || 10 * 1024 * 1024, // 10MB
      maxFiles: options.maxFiles || 10,
      logDir: options.logDir || this.logDir,
      enableConsole: options.enableConsole !== false,
      enableFile: options.enableFile !== false,
      ...options
    };

    // Ensure log directory exists
    await this.ensureLogDirectory(config.logDir);

    // Create structured log format with contextual information
    const structuredFormat = winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSS'
      }),
      winston.format.errors({ stack: true }),
      winston.format.json(),
      winston.format.printf(({ timestamp, level, message, stack, context, ...meta }) => {
        const logEntry = {
          timestamp,
          level: level.toUpperCase(),
          message,
          ...(context && { context }),
          ...(Object.keys(meta).length > 0 && { meta }),
          ...(stack && { stack })
        };
        return JSON.stringify(logEntry);
      })
    );

    // Create human-readable format for console
    const consoleFormat = winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
      }),
      winston.format.errors({ stack: true }),
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, stack, context, ...meta }) => {
        let logLine = `${timestamp} [${level}]`;
        
        // Add context information if available
        if (context) {
          const contextStr = Object.entries(context)
            .map(([key, value]) => `${key}=${value}`)
            .join(' ');
          logLine += ` [${contextStr}]`;
        }
        
        logLine += `: ${message}`;
        
        // Add metadata if present
        if (Object.keys(meta).length > 0) {
          logLine += ` ${JSON.stringify(meta)}`;
        }
        
        // Add stack trace if present
        if (stack) {
          logLine += `\n${stack}`;
        }
        
        return logLine;
      })
    );

    const transports = [];

    // Console transport
    if (config.enableConsole) {
      transports.push(new winston.transports.Console({
        format: consoleFormat,
        handleExceptions: true,
        handleRejections: true
      }));
    }

    // File transport with rotation
    if (config.enableFile) {
      const logFilePath = path.join(config.logDir, this.logFile);
      
      transports.push(new winston.transports.File({
        filename: logFilePath,
        format: structuredFormat,
        handleExceptions: true,
        handleRejections: true,
        maxsize: config.maxFileSize,
        maxFiles: config.maxFiles,
        tailable: true
      }));

      // Add separate error log file
      transports.push(new winston.transports.File({
        filename: path.join(config.logDir, 'actual-xero-sync-error.log'),
        format: structuredFormat,
        level: 'error',
        handleExceptions: true,
        handleRejections: true,
        maxsize: config.maxFileSize,
        maxFiles: config.maxFiles,
        tailable: true
      }));
    }

    this.logger = winston.createLogger({
      level: logLevel,
      transports,
      exitOnError: false
    });

    // Log initialization
    this.info('Logger initialized', {
      logLevel,
      logDir: config.logDir,
      maxFileSize: config.maxFileSize,
      maxFiles: config.maxFiles
    });
  }

  /**
   * Ensure log directory exists
   * @param {string} logDir - Log directory path
   */
  async ensureLogDirectory(logDir) {
    try {
      await fs.access(logDir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fs.mkdir(logDir, { recursive: true });
      } else {
        throw error;
      }
    }
  }

  /**
   * Get logger instance
   * @returns {winston.Logger} - Winston logger instance
   */
  getLogger() {
    if (!this.logger) {
      // Initialize with default settings if not already initialized
      this.init().catch(console.error);
    }
    return this.logger;
  }

  /**
   * Set global context that will be included in all log messages
   * @param {Object} context - Context object
   */
  setContext(context) {
    this.context = { ...this.context, ...context };
  }

  /**
   * Clear global context
   */
  clearContext() {
    this.context = {};
  }

  /**
   * Create a child logger with additional context
   * @param {Object} childContext - Additional context for child logger
   * @returns {Object} - Child logger instance
   */
  child(childContext) {
    const childLogger = {
      context: { ...this.context, ...childContext },
      
      debug: (message, meta = {}) => this.debug(message, { ...meta, context: childLogger.context }),
      info: (message, meta = {}) => this.info(message, { ...meta, context: childLogger.context }),
      warn: (message, meta = {}) => this.warn(message, { ...meta, context: childLogger.context }),
      error: (message, meta = {}) => this.error(message, { ...meta, context: childLogger.context }),
      
      // Specialized logging methods
      apiCall: (method, url, meta = {}) => this.apiCall(method, url, { ...meta, context: childLogger.context }),
      apiResponse: (method, url, status, duration, meta = {}) => this.apiResponse(method, url, status, duration, { ...meta, context: childLogger.context }),
      transactionProcessing: (transactionId, stage, meta = {}) => this.transactionProcessing(transactionId, stage, { ...meta, context: childLogger.context }),
      syncProgress: (stage, progress, meta = {}) => this.syncProgress(stage, progress, { ...meta, context: childLogger.context }),
      performance: (operation, duration, meta = {}) => this.performance(operation, duration, { ...meta, context: childLogger.context }),
      security: (event, meta = {}) => this.security(event, { ...meta, context: childLogger.context }),
      rateLimit: (service, details, meta = {}) => this.rateLimit(service, details, { ...meta, context: childLogger.context }),
      configChange: (setting, oldValue, newValue, meta = {}) => this.configChange(setting, oldValue, newValue, { ...meta, context: childLogger.context }),
      validationError: (dataType, errors, meta = {}) => this.validationError(dataType, errors, { ...meta, context: childLogger.context }),
      businessEvent: (event, details, meta = {}) => this.businessEvent(event, details, { ...meta, context: childLogger.context }),
      healthCheck: (component, healthy, details, meta = {}) => this.healthCheck(component, healthy, details, { ...meta, context: childLogger.context }),
      
      // Create nested child logger
      child: (nestedContext) => this.child({ ...childLogger.context, ...nestedContext })
    };
    
    return childLogger;
  }

  // Core logging methods with context support
  debug(message, meta = {}) {
    const logMeta = this.enrichMeta(meta);
    this.getLogger().debug(message, logMeta);
  }

  info(message, meta = {}) {
    const logMeta = this.enrichMeta(meta);
    this.getLogger().info(message, logMeta);
  }

  warn(message, meta = {}) {
    const logMeta = this.enrichMeta(meta);
    this.getLogger().warn(message, logMeta);
  }

  error(message, meta = {}) {
    const logMeta = this.enrichMeta(meta);
    this.getLogger().error(message, logMeta);
  }

  /**
   * Specialized logging methods for common use cases
   */

  /**
   * Log API call initiation
   * @param {string} method - HTTP method
   * @param {string} url - API endpoint URL
   * @param {Object} meta - Additional metadata
   */
  apiCall(method, url, meta = {}) {
    this.debug(`API Call: ${method} ${url}`, {
      ...meta,
      api: {
        method,
        url,
        type: 'request'
      }
    });
  }

  /**
   * Log API response
   * @param {string} method - HTTP method
   * @param {string} url - API endpoint URL
   * @param {number} status - HTTP status code
   * @param {number} duration - Request duration in milliseconds
   * @param {Object} meta - Additional metadata
   */
  apiResponse(method, url, status, duration, meta = {}) {
    const level = status >= 400 ? 'error' : status >= 300 ? 'warn' : 'debug';
    this[level](`API Response: ${method} ${url} - ${status} (${duration}ms)`, {
      ...meta,
      api: {
        method,
        url,
        status,
        duration,
        type: 'response'
      }
    });
  }

  /**
   * Log transaction processing stages
   * @param {string} transactionId - Transaction identifier
   * @param {string} stage - Processing stage
   * @param {Object} meta - Additional metadata
   */
  transactionProcessing(transactionId, stage, meta = {}) {
    this.info(`Transaction ${stage}: ${transactionId}`, {
      ...meta,
      transaction: {
        id: transactionId,
        stage
      }
    });
  }

  /**
   * Log sync progress
   * @param {string} stage - Sync stage
   * @param {Object} progress - Progress information
   * @param {Object} meta - Additional metadata
   */
  syncProgress(stage, progress, meta = {}) {
    this.info(`Sync ${stage}`, {
      ...meta,
      sync: {
        stage,
        ...progress
      }
    });
  }

  /**
   * Log performance metrics
   * @param {string} operation - Operation name
   * @param {number} duration - Duration in milliseconds
   * @param {Object} meta - Additional metadata
   */
  performance(operation, duration, meta = {}) {
    this.info(`Performance: ${operation} completed in ${duration}ms`, {
      ...meta,
      performance: {
        operation,
        duration
      }
    });
  }

  /**
   * Log security events
   * @param {string} event - Security event type
   * @param {Object} meta - Additional metadata
   */
  security(event, meta = {}) {
    this.warn(`Security Event: ${event}`, {
      ...meta,
      security: {
        event,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Log rate limiting events
   * @param {string} service - Service being rate limited
   * @param {Object} details - Rate limit details
   * @param {Object} meta - Additional metadata
   */
  rateLimit(service, details, meta = {}) {
    this.warn(`Rate Limit: ${service}`, {
      ...meta,
      rateLimit: {
        service,
        ...details,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Log configuration changes
   * @param {string} setting - Configuration setting changed
   * @param {*} oldValue - Previous value
   * @param {*} newValue - New value
   * @param {Object} meta - Additional metadata
   */
  configChange(setting, oldValue, newValue, meta = {}) {
    this.info(`Configuration Changed: ${setting}`, {
      ...meta,
      config: {
        setting,
        oldValue: this.sanitizeValue(oldValue),
        newValue: this.sanitizeValue(newValue),
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Log data validation errors
   * @param {string} dataType - Type of data being validated
   * @param {Array} errors - Validation errors
   * @param {Object} meta - Additional metadata
   */
  validationError(dataType, errors, meta = {}) {
    this.error(`Validation Failed: ${dataType}`, {
      ...meta,
      validation: {
        dataType,
        errors: Array.isArray(errors) ? errors : [errors],
        errorCount: Array.isArray(errors) ? errors.length : 1
      }
    });
  }

  /**
   * Log business logic events
   * @param {string} event - Business event type
   * @param {Object} details - Event details
   * @param {Object} meta - Additional metadata
   */
  businessEvent(event, details, meta = {}) {
    this.info(`Business Event: ${event}`, {
      ...meta,
      business: {
        event,
        ...details,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Log system health checks
   * @param {string} component - Component being checked
   * @param {boolean} healthy - Health status
   * @param {Object} details - Health check details
   * @param {Object} meta - Additional metadata
   */
  healthCheck(component, healthy, details = {}, meta = {}) {
    const level = healthy ? 'info' : 'error';
    this[level](`Health Check: ${component} - ${healthy ? 'HEALTHY' : 'UNHEALTHY'}`, {
      ...meta,
      health: {
        component,
        healthy,
        ...details,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Sanitize sensitive values for logging
   * @param {*} value - Value to sanitize
   * @returns {*} - Sanitized value
   */
  sanitizeValue(value) {
    if (typeof value === 'string') {
      // Mask potential passwords, tokens, keys
      if (value.length > 8 && /^[A-Za-z0-9+/=]+$/.test(value)) {
        return `${value.substring(0, 4)}****${value.substring(value.length - 4)}`;
      }
      // Mask potential API keys
      if (value.toLowerCase().includes('key') || value.toLowerCase().includes('token') || value.toLowerCase().includes('secret')) {
        return '****';
      }
    }
    return value;
  }

  /**
   * Enrich metadata with global context and additional information
   * @param {Object} meta - Original metadata
   * @returns {Object} - Enriched metadata
   */
  enrichMeta(meta) {
    const enriched = {
      ...meta,
      pid: process.pid,
      memory: process.memoryUsage(),
      uptime: process.uptime()
    };

    // Add global context if available
    if (Object.keys(this.context).length > 0) {
      enriched.context = { ...this.context, ...meta.context };
    }

    return enriched;
  }

  /**
   * Get log statistics and health information
   * @returns {Object} - Log statistics
   */
  async getLogStats() {
    try {
      const logFilePath = path.join(this.logDir, this.logFile);
      const errorLogPath = path.join(this.logDir, 'actual-xero-sync-error.log');
      
      const stats = {
        logFile: {
          path: logFilePath,
          exists: false,
          size: 0,
          modified: null
        },
        errorLog: {
          path: errorLogPath,
          exists: false,
          size: 0,
          modified: null
        },
        logLevel: this.logger?.level || 'not initialized',
        context: this.context,
        runtime: {
          pid: process.pid,
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version
        }
      };

      try {
        const logStat = await fs.stat(logFilePath);
        stats.logFile.exists = true;
        stats.logFile.size = logStat.size;
        stats.logFile.modified = logStat.mtime;
      } catch (error) {
        // File doesn't exist or can't be accessed
      }

      try {
        const errorStat = await fs.stat(errorLogPath);
        stats.errorLog.exists = true;
        stats.errorLog.size = errorStat.size;
        stats.errorLog.modified = errorStat.mtime;
      } catch (error) {
        // File doesn't exist or can't be accessed
      }

      return stats;
    } catch (error) {
      this.error('Failed to get log statistics', { error: error.message });
      return null;
    }
  }

  /**
   * Clean up old log files based on retention policy
   * @param {number} retentionDays - Number of days to retain logs
   */
  async cleanupOldLogs(retentionDays = 30) {
    try {
      this.info(`Starting log cleanup, retention: ${retentionDays} days`);
      
      const files = await fs.readdir(this.logDir);
      const logFiles = files.filter(file => 
        file.startsWith('actual-xero-sync') && 
        (file.endsWith('.log') || /\.log\.\d+$/.test(file))
      );

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      let deletedCount = 0;
      let deletedSize = 0;

      for (const file of logFiles) {
        const filePath = path.join(this.logDir, file);
        try {
          const stat = await fs.stat(filePath);
          if (stat.mtime < cutoffDate) {
            deletedSize += stat.size;
            await fs.unlink(filePath);
            deletedCount++;
            this.debug(`Deleted old log file: ${file}`, {
              file: {
                name: file,
                size: stat.size,
                modified: stat.mtime
              }
            });
          }
        } catch (error) {
          this.warn(`Failed to process log file ${file}: ${error.message}`);
        }
      }

      this.info(`Log cleanup completed`, {
        cleanup: {
          filesDeleted: deletedCount,
          bytesFreed: deletedSize,
          retentionDays
        }
      });

      return {
        filesDeleted: deletedCount,
        bytesFreed: deletedSize
      };
    } catch (error) {
      this.error('Log cleanup failed', { error: error.message });
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new Logger();