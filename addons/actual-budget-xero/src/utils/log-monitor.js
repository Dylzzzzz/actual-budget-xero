const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

/**
 * Log monitoring and management utility
 * Provides log rotation, monitoring, and health checks for the logging system
 */
class LogMonitor extends EventEmitter {
  constructor(logger, options = {}) {
    super();
    
    this.logger = logger;
    this.options = {
      checkInterval: options.checkInterval || 60000, // 1 minute
      maxLogSize: options.maxLogSize || 50 * 1024 * 1024, // 50MB
      maxErrorLogSize: options.maxErrorLogSize || 10 * 1024 * 1024, // 10MB
      retentionDays: options.retentionDays || 30,
      alertThresholds: {
        errorRate: options.errorRate || 10, // errors per minute
        logGrowthRate: options.logGrowthRate || 5 * 1024 * 1024, // 5MB per hour
        diskUsage: options.diskUsage || 0.9 // 90% disk usage
      },
      ...options
    };
    
    this.monitoring = false;
    this.stats = {
      lastCheck: null,
      logSizes: {},
      errorCounts: {},
      alerts: []
    };
    
    this.checkInterval = null;
  }

  /**
   * Start log monitoring
   */
  async startMonitoring() {
    if (this.monitoring) {
      return;
    }

    this.monitoring = true;
    this.logger.info('Starting log monitoring', {
      checkInterval: this.options.checkInterval,
      maxLogSize: this.options.maxLogSize,
      retentionDays: this.options.retentionDays
    });

    // Initial check
    await this.performHealthCheck();

    // Set up periodic checks
    this.checkInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.error('Log monitoring check failed', { error: error.message });
      }
    }, this.options.checkInterval);

    this.emit('monitoring-started');
  }

  /**
   * Stop log monitoring
   */
  stopMonitoring() {
    if (!this.monitoring) {
      return;
    }

    this.monitoring = false;
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.logger.info('Stopped log monitoring');
    this.emit('monitoring-stopped');
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck() {
    const checkTime = new Date();
    this.stats.lastCheck = checkTime;

    try {
      // Check log file sizes
      await this.checkLogSizes();
      
      // Check disk usage
      await this.checkDiskUsage();
      
      // Check error rates
      await this.checkErrorRates();
      
      // Perform cleanup if needed
      await this.performMaintenanceIfNeeded();
      
      this.emit('health-check-completed', {
        timestamp: checkTime,
        stats: this.stats
      });

    } catch (error) {
      this.logger.error('Health check failed', { error: error.message });
      this.emit('health-check-failed', { error: error.message });
    }
  }

  /**
   * Check log file sizes and growth rates
   */
  async checkLogSizes() {
    const logStats = await this.logger.getLogStats();
    
    if (!logStats) {
      return;
    }

    const currentSizes = {
      main: logStats.logFile.size || 0,
      error: logStats.errorLog.size || 0
    };

    // Check if logs are too large
    if (currentSizes.main > this.options.maxLogSize) {
      this.createAlert('log-size-exceeded', {
        file: 'main',
        size: currentSizes.main,
        maxSize: this.options.maxLogSize
      });
    }

    if (currentSizes.error > this.options.maxErrorLogSize) {
      this.createAlert('error-log-size-exceeded', {
        file: 'error',
        size: currentSizes.error,
        maxSize: this.options.maxErrorLogSize
      });
    }

    // Check growth rate
    if (this.stats.logSizes.timestamp) {
      const timeDiff = Date.now() - this.stats.logSizes.timestamp;
      const hoursDiff = timeDiff / (1000 * 60 * 60);
      
      if (hoursDiff >= 1) {
        const mainGrowth = currentSizes.main - (this.stats.logSizes.main || 0);
        const growthRate = mainGrowth / hoursDiff;
        
        if (growthRate > this.options.alertThresholds.logGrowthRate) {
          this.createAlert('high-log-growth-rate', {
            growthRate,
            threshold: this.options.alertThresholds.logGrowthRate,
            period: hoursDiff
          });
        }
      }
    }

    this.stats.logSizes = {
      ...currentSizes,
      timestamp: Date.now()
    };
  }

  /**
   * Check disk usage in log directory
   */
  async checkDiskUsage() {
    try {
      const logDir = this.logger.logDir;
      const stats = await fs.stat(logDir);
      
      // Note: This is a simplified check. In a real implementation,
      // you might want to use a more sophisticated disk usage check
      this.logger.debug('Disk usage check completed', {
        logDir,
        accessible: true
      });
      
    } catch (error) {
      this.createAlert('log-directory-inaccessible', {
        directory: this.logger.logDir,
        error: error.message
      });
    }
  }

  /**
   * Check error rates and patterns
   */
  async checkErrorRates() {
    // This would typically involve parsing recent log entries
    // For now, we'll implement a basic check
    
    const now = Date.now();
    const oneMinuteAgo = now - (60 * 1000);
    
    // In a real implementation, you would parse the log file
    // and count errors in the last minute
    
    this.logger.debug('Error rate check completed');
  }

  /**
   * Perform maintenance tasks if needed
   */
  async performMaintenanceIfNeeded() {
    const logStats = await this.logger.getLogStats();
    
    if (!logStats) {
      return;
    }

    // Auto-cleanup if logs are too large
    if (logStats.logFile.size > this.options.maxLogSize * 0.8) {
      this.logger.info('Log file approaching size limit, performing cleanup');
      await this.logger.cleanupOldLogs(this.options.retentionDays);
    }

    // Periodic cleanup (daily)
    const lastCleanup = this.stats.lastCleanup || 0;
    const daysSinceCleanup = (Date.now() - lastCleanup) / (1000 * 60 * 60 * 24);
    
    if (daysSinceCleanup >= 1) {
      this.logger.info('Performing scheduled log cleanup');
      await this.logger.cleanupOldLogs(this.options.retentionDays);
      this.stats.lastCleanup = Date.now();
    }
  }

  /**
   * Create and manage alerts
   */
  createAlert(type, details) {
    const alert = {
      id: `${type}-${Date.now()}`,
      type,
      details,
      timestamp: new Date().toISOString(),
      acknowledged: false
    };

    this.stats.alerts.push(alert);
    
    // Keep only recent alerts (last 24 hours)
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    this.stats.alerts = this.stats.alerts.filter(
      alert => new Date(alert.timestamp).getTime() > oneDayAgo
    );

    this.logger.warn(`Log Monitor Alert: ${type}`, {
      alert,
      monitoring: {
        alertType: type,
        alertId: alert.id
      }
    });

    this.emit('alert-created', alert);
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId) {
    const alert = this.stats.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = new Date().toISOString();
      
      this.logger.info(`Alert acknowledged: ${alertId}`);
      this.emit('alert-acknowledged', alert);
    }
  }

  /**
   * Get current monitoring status
   */
  getStatus() {
    return {
      monitoring: this.monitoring,
      lastCheck: this.stats.lastCheck,
      alerts: this.stats.alerts.filter(a => !a.acknowledged),
      acknowledgedAlerts: this.stats.alerts.filter(a => a.acknowledged),
      logSizes: this.stats.logSizes,
      options: this.options
    };
  }

  /**
   * Get monitoring statistics
   */
  getStatistics() {
    const activeAlerts = this.stats.alerts.filter(a => !a.acknowledged);
    const alertsByType = {};
    
    activeAlerts.forEach(alert => {
      alertsByType[alert.type] = (alertsByType[alert.type] || 0) + 1;
    });

    return {
      monitoring: {
        active: this.monitoring,
        lastCheck: this.stats.lastCheck,
        checkInterval: this.options.checkInterval
      },
      alerts: {
        total: this.stats.alerts.length,
        active: activeAlerts.length,
        acknowledged: this.stats.alerts.filter(a => a.acknowledged).length,
        byType: alertsByType
      },
      logs: {
        sizes: this.stats.logSizes,
        thresholds: {
          maxLogSize: this.options.maxLogSize,
          maxErrorLogSize: this.options.maxErrorLogSize
        }
      },
      maintenance: {
        retentionDays: this.options.retentionDays,
        lastCleanup: this.stats.lastCleanup
      }
    };
  }

  /**
   * Force log rotation
   */
  async forceRotation() {
    this.logger.info('Forcing log rotation');
    
    try {
      const result = await this.logger.cleanupOldLogs(this.options.retentionDays);
      
      this.logger.info('Forced log rotation completed', {
        filesDeleted: result.filesDeleted,
        bytesFreed: result.bytesFreed
      });
      
      this.emit('rotation-completed', result);
      return result;
      
    } catch (error) {
      this.logger.error('Forced log rotation failed', { error: error.message });
      this.emit('rotation-failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Export monitoring data for external systems
   */
  exportMonitoringData() {
    return {
      timestamp: new Date().toISOString(),
      status: this.getStatus(),
      statistics: this.getStatistics(),
      configuration: this.options
    };
  }
}

module.exports = LogMonitor;