const logger = require('../utils/logger');

/**
 * Home Assistant integration service for Actual-Xero Sync
 * Provides service calls, entities, and automation triggers
 */
class HomeAssistantService {
  constructor() {
    this.entities = new Map();
    this.lastSyncTime = null;
    this.syncStatus = 'idle';
    this.lastError = null;
    this.syncCount = 0;
  }

  /**
   * Initialize Home Assistant integration
   */
  init() {
    logger.info('Initializing Home Assistant integration');
    
    // Initialize entities
    this.updateEntity('sync_status', 'idle', {
      friendly_name: 'Actual-Xero Sync Status',
      icon: 'mdi:sync'
    });
    
    this.updateEntity('last_sync', null, {
      friendly_name: 'Last Sync Time',
      icon: 'mdi:clock-outline',
      device_class: 'timestamp'
    });
    
    this.updateEntity('sync_count', 0, {
      friendly_name: 'Total Sync Count',
      icon: 'mdi:counter'
    });
    
    this.updateEntity('last_error', null, {
      friendly_name: 'Last Sync Error',
      icon: 'mdi:alert-circle-outline'
    });
    
    logger.info('Home Assistant entities initialized');
  }

  /**
   * Update an entity state
   */
  updateEntity(entityId, state, attributes = {}) {
    const entity = {
      entity_id: `sensor.actual_xero_sync_${entityId}`,
      state: state,
      attributes: {
        ...attributes,
        last_updated: new Date().toISOString()
      }
    };
    
    this.entities.set(entityId, entity);
    
    // In a real Home Assistant add-on, this would publish to the supervisor API
    logger.debug(`Entity updated: ${entity.entity_id} = ${state}`);
  }

  /**
   * Get all entities for Home Assistant
   */
  getEntities() {
    return Array.from(this.entities.values());
  }

  /**
   * Handle manual sync trigger from Home Assistant
   */
  async handleSyncTrigger(source = 'home_assistant') {
    logger.info(`Manual sync triggered from ${source}`);
    
    try {
      this.updateSyncStatus('running');
      this.publishEvent('sync_started', { source });
      
      // This would trigger the actual sync service
      // For now, we'll simulate the sync process
      await this.simulateSync();
      
      this.updateSyncStatus('completed');
      this.updateLastSync(new Date());
      this.incrementSyncCount();
      this.clearLastError();
      
      this.publishEvent('sync_completed', { 
        source,
        duration: '30s',
        transactions_processed: 15
      });
      
      logger.info('Manual sync completed successfully');
      return { success: true, message: 'Sync completed successfully' };
      
    } catch (error) {
      logger.error('Manual sync failed:', error);
      
      this.updateSyncStatus('error');
      this.updateLastError(error.message);
      
      this.publishEvent('sync_failed', { 
        source,
        error: error.message
      });
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Update sync status entity
   */
  updateSyncStatus(status) {
    this.syncStatus = status;
    
    const statusAttributes = {
      friendly_name: 'Actual-Xero Sync Status',
      icon: this.getStatusIcon(status)
    };
    
    this.updateEntity('sync_status', status, statusAttributes);
  }

  /**
   * Update last sync time entity
   */
  updateLastSync(timestamp) {
    this.lastSyncTime = timestamp;
    
    this.updateEntity('last_sync', timestamp.toISOString(), {
      friendly_name: 'Last Sync Time',
      icon: 'mdi:clock-check-outline',
      device_class: 'timestamp'
    });
  }

  /**
   * Increment sync count entity
   */
  incrementSyncCount() {
    this.syncCount++;
    
    this.updateEntity('sync_count', this.syncCount, {
      friendly_name: 'Total Sync Count',
      icon: 'mdi:counter'
    });
  }

  /**
   * Update last error entity
   */
  updateLastError(error) {
    this.lastError = error;
    
    this.updateEntity('last_error', error, {
      friendly_name: 'Last Sync Error',
      icon: 'mdi:alert-circle'
    });
  }

  /**
   * Clear last error entity
   */
  clearLastError() {
    this.lastError = null;
    
    this.updateEntity('last_error', null, {
      friendly_name: 'Last Sync Error',
      icon: 'mdi:check-circle-outline'
    });
  }

  /**
   * Get status icon based on current status
   */
  getStatusIcon(status) {
    const icons = {
      idle: 'mdi:sync',
      running: 'mdi:sync-circle',
      completed: 'mdi:check-circle',
      error: 'mdi:alert-circle'
    };
    
    return icons[status] || 'mdi:sync';
  }

  /**
   * Publish Home Assistant event
   */
  publishEvent(eventType, data = {}) {
    const event = {
      event_type: `actual_xero_sync_${eventType}`,
      event_data: {
        ...data,
        timestamp: new Date().toISOString()
      }
    };
    
    // In a real Home Assistant add-on, this would publish to the event bus
    logger.info(`Home Assistant event published: ${event.event_type}`, event.event_data);
  }

  /**
   * Get current sync status for API
   */
  getStatus() {
    return {
      status: this.syncStatus,
      last_sync: this.lastSyncTime,
      sync_count: this.syncCount,
      last_error: this.lastError,
      entities: this.getEntities()
    };
  }

  /**
   * Simulate sync process (placeholder for actual sync service integration)
   */
  async simulateSync() {
    // Simulate sync duration
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Randomly simulate success or failure for testing
    if (Math.random() < 0.1) {
      throw new Error('Simulated sync failure for testing');
    }
  }

  /**
   * Register service calls with Home Assistant
   */
  getServiceCalls() {
    return [
      {
        domain: 'actual_xero_sync',
        service: 'trigger_sync',
        description: 'Manually trigger a sync between Actual Budget and Xero',
        fields: {
          source: {
            description: 'Source of the sync trigger',
            example: 'automation'
          }
        }
      },
      {
        domain: 'actual_xero_sync',
        service: 'get_status',
        description: 'Get current sync status and statistics',
        fields: {}
      }
    ];
  }
}

module.exports = HomeAssistantService;