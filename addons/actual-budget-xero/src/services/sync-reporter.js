/**
 * SyncReporter - Service for reporting sync operations and statistics
 * 
 * Provides functionality for tracking and reporting sync operations,
 * including success/failure rates, performance metrics, and error reporting.
 */
class SyncReporter {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.stats = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      lastSyncTime: null,
      averageSyncDuration: 0
    };
  }

  /**
   * Report a successful sync operation
   * @param {Object} syncResult - Results from the sync operation
   */
  reportSuccess(syncResult) {
    this.stats.totalSyncs++;
    this.stats.successfulSyncs++;
    this.stats.lastSyncTime = new Date();
    
    this.logger.info('Sync operation completed successfully', {
      transactionsProcessed: syncResult.transactionsProcessed || 0,
      duration: syncResult.duration || 0
    });
  }

  /**
   * Report a failed sync operation
   * @param {Error} error - Error that caused the sync to fail
   */
  reportFailure(error) {
    this.stats.totalSyncs++;
    this.stats.failedSyncs++;
    this.stats.lastSyncTime = new Date();
    
    this.logger.error('Sync operation failed', {
      error: error.message,
      stack: error.stack
    });
  }

  /**
   * Get current sync statistics
   * @returns {Object} - Current sync statistics
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalSyncs > 0 
        ? (this.stats.successfulSyncs / this.stats.totalSyncs * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * Reset all statistics
   */
  resetStats() {
    this.stats = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      lastSyncTime: null,
      averageSyncDuration: 0
    };
  }
}

module.exports = SyncReporter;