#!/usr/bin/env node

const express = require('express');
const path = require('path');
const ConfigValidator = require('./models/config');
const logger = require('./utils/logger');
const HomeAssistantService = require('./services/home-assistant');
const LogMonitor = require('./utils/log-monitor');

// Import services for initialization
const ActualBudgetClient = require('./services/actual');
const XanoClient = require('./services/xano');
const XeroClient = require('./services/xero');
const SyncService = require('./services/sync');
const MappingManager = require('./services/mapping-manager');
const ReprocessingService = require('./services/reprocessing');
const SyncReporter = require('./services/sync-reporter');

/**
 * Main application class for Actual-Xero Sync
 */
class ActualXeroSyncApp {
  constructor() {
    this.app = express();
    this.config = null;
    this.server = null;
    
    // Service instances
    this.services = {
      actualClient: null,
      xanoClient: null,
      xeroClient: null,
      syncService: null,
      mappingManager: null,
      reprocessingService: null,
      syncReporter: null,
      haService: new HomeAssistantService()
    };
    
    // Log monitoring
    this.logMonitor = null;
    
    // Application state
    this.isShuttingDown = false;
    this.activeOperations = new Set();
  }

  /**
   * Initialize the application
   */
  async init() {
    try {
      // Load and validate configuration
      console.log('Loading configuration...');
      try {
        this.config = ConfigValidator.getValidatedConfig();
        console.log('Configuration loaded successfully:', !!this.config);
      } catch (configError) {
        console.error('Configuration loading failed:', configError.message);
        console.error('Config error stack:', configError.stack);
        throw configError;
      }
      
      if (!this.config) {
        throw new Error('Configuration validation failed - config is null');
      }
      
      // Initialize logger with configured level
      await logger.init(this.config.log_level, {
        logDir: process.env.LOG_DIR || '/var/log',
        maxFileSize: 10 * 1024 * 1024, // 10MB
        maxFiles: 10,
        enableConsole: true,
        enableFile: true
      });
      
      // Initialize log monitoring
      this.logMonitor = new LogMonitor(logger, {
        checkInterval: 60000, // 1 minute
        maxLogSize: 50 * 1024 * 1024, // 50MB
        retentionDays: 30,
        alertThresholds: {
          errorRate: 10,
          logGrowthRate: 5 * 1024 * 1024
        }
      });
      
      // Set up log monitor event handlers
      this.setupLogMonitorEvents();
      
      logger.info('Actual-Xero Sync starting up...');
      logger.info('Configuration loaded and validated successfully');
      
      // Setup Express middleware
      this.setupMiddleware();
      
      // Setup routes
      this.setupRoutes();
      
      // Initialize services
      await this.initializeServices();
      
      // Setup error handling
      this.setupErrorHandling();
      
      logger.info('Application initialized successfully');
      
    } catch (error) {
      console.error('Failed to initialize application:', error.message);
      process.exit(1);
    }
  }

  /**
   * Initialize all application services
   */
  async initializeServices() {
    try {
      logger.info('Initializing application services...');
      
      // Initialize API clients
      this.services.actualClient = new ActualBudgetClient({
        baseUrl: this.config.actual_budget_url,
        password: this.config.actual_budget_password,
        logger: logger
      });
      
      this.services.xanoClient = new XanoClient({
        apiUrl: this.config.xano_api_url,
        apiKey: this.config.xano_api_key,
        rateLimitPerMinute: this.config.xano_rate_limit,
        logger: logger
      });
      
      this.services.xeroClient = new XeroClient({
        clientId: this.config.xero_client_id,
        clientSecret: this.config.xero_client_secret,
        tenantId: this.config.xero_tenant_id,
        logger: logger
      });
      
      // Initialize business logic services
      this.services.mappingManager = new MappingManager({
        actualClient: this.services.actualClient,
        xanoClient: this.services.xanoClient,
        xeroClient: this.services.xeroClient,
        logger: logger
      });
      
      this.services.reprocessingService = new ReprocessingService({
        xanoClient: this.services.xanoClient,
        xeroClient: this.services.xeroClient,
        actualClient: this.services.actualClient,
        logger: logger,
        config: this.config
      });
      
      this.services.syncReporter = new SyncReporter({
        logger: logger
      });
      
      // Initialize main sync service
      this.services.syncService = new SyncService({
        actualClient: this.services.actualClient,
        xanoClient: this.services.xanoClient,
        xeroClient: this.services.xeroClient,
        mappingManager: this.services.mappingManager,
        syncReporter: this.services.syncReporter,
        logger: logger,
        config: this.config
      });
      
      // Initialize Home Assistant service
      this.services.haService.init();
      
      logger.info('All services initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize services:', error);
      throw error;
    }
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // Serve static files from web directory
    this.app.use(express.static(path.join(__dirname, '../web')));
    
    // Request logging middleware
    this.app.use((req, res, next) => {
      logger.debug(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });
  }

  /**
   * Setup application routes
   */
  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    });

    // Configuration status endpoint
    this.app.get('/api/config/status', (req, res) => {
      res.json({
        configured: true,
        log_level: this.config.log_level,
        sync_schedule: this.config.sync_schedule,
        sync_days_back: this.config.sync_days_back,
        batch_size: this.config.batch_size,
        xano_rate_limit: this.config.xano_rate_limit,
        // Don't expose sensitive configuration
        actual_budget_configured: !!this.config.actual_budget_url,
        xano_configured: !!this.config.xano_api_url,
        xero_configured: !!this.config.xero_client_id
      });
    });

    // Configuration details endpoint
    this.app.get('/api/config/details', (req, res) => {
      res.json({
        actual_budget_url: this.config.actual_budget_url,
        business_category_group_name: this.config.business_category_group_name,
        business_category_group_id: this.config.business_category_group_id,
        sync_schedule: this.config.sync_schedule,
        sync_days_back: this.config.sync_days_back,
        batch_size: this.config.batch_size,
        xano_rate_limit: this.config.xano_rate_limit
      });
    });

    // Sync statistics endpoint
    this.app.get('/api/sync/stats', (req, res) => {
      res.json({
        total_processed: 0,
        successful_imports: 0,
        failed_transactions: 0,
        pending_mappings: 0
      });
    });

    // Manual sync trigger endpoint
    this.app.post('/api/sync/trigger', async (req, res) => {
      try {
        logger.info('Manual sync triggered via API');
        
        // Trigger sync through Home Assistant service for consistency
        const result = await this.services.haService.handleSyncTrigger('web_api');
        
        if (result.success) {
          res.json({
            message: result.message,
            syncId: Date.now().toString(), // Simple sync ID for tracking
            timestamp: new Date().toISOString()
          });
        } else {
          res.status(500).json({
            error: result.error,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        logger.error('Failed to trigger sync', { error: error.message });
        res.status(500).json({
          error: 'Failed to trigger sync',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Sync progress endpoint
    this.app.get('/api/sync/progress/:syncId', (req, res) => {
      // For now, return a simple completed status since we don't have real-time progress tracking
      res.json({
        syncId: req.params.syncId,
        status: 'completed',
        progress: 100,
        message: 'Sync completed',
        processed: 0
      });
    });

    // Current sync status endpoint
    this.app.get('/api/sync/current-status', (req, res) => {
      res.json({
        syncing: false,
        reprocessing: false,
        lastSync: null
      });
    });

    // Log monitoring endpoints
    this.app.get('/api/logs/status', (req, res) => {
      try {
        const status = this.getLogMonitoringStatus();
        res.json(status);
      } catch (error) {
        logger.error('Failed to get log monitoring status', { error: error.message });
        res.status(500).json({ error: 'Failed to get log monitoring status' });
      }
    });

    this.app.get('/api/logs/statistics', (req, res) => {
      try {
        if (!this.logMonitor) {
          return res.status(404).json({ error: 'Log monitoring not available' });
        }
        
        const statistics = this.logMonitor.getStatistics();
        res.json(statistics);
      } catch (error) {
        logger.error('Failed to get log statistics', { error: error.message });
        res.status(500).json({ error: 'Failed to get log statistics' });
      }
    });

    this.app.post('/api/logs/rotate', async (req, res) => {
      try {
        if (!this.logMonitor) {
          return res.status(404).json({ error: 'Log monitoring not available' });
        }
        
        logger.info('Manual log rotation requested via API');
        const result = await this.logMonitor.forceRotation();
        
        res.json({
          message: 'Log rotation completed successfully',
          result,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error('Failed to rotate logs', { error: error.message });
        res.status(500).json({ error: 'Failed to rotate logs' });
      }
    });

    this.app.post('/api/logs/alerts/:alertId/acknowledge', (req, res) => {
      try {
        if (!this.logMonitor) {
          return res.status(404).json({ error: 'Log monitoring not available' });
        }
        
        const { alertId } = req.params;
        this.logMonitor.acknowledgeAlert(alertId);
        
        res.json({
          message: 'Alert acknowledged successfully',
          alertId,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error('Failed to acknowledge alert', { error: error.message });
        res.status(500).json({ error: 'Failed to acknowledge alert' });
      }
    });

    // Home Assistant integration endpoints
    this.app.get('/api/homeassistant/status', (req, res) => {
      try {
        const status = this.services.haService.getStatus();
        res.json(status);
      } catch (error) {
        logger.error('Failed to get Home Assistant status', { error: error.message });
        res.status(500).json({ error: 'Failed to get Home Assistant status' });
      }
    });

    this.app.get('/api/homeassistant/entities', (req, res) => {
      try {
        const entities = this.services.haService.getEntities();
        res.json({ entities });
      } catch (error) {
        logger.error('Failed to get Home Assistant entities', { error: error.message });
        res.status(500).json({ error: 'Failed to get Home Assistant entities' });
      }
    });

    this.app.get('/api/homeassistant/services', (req, res) => {
      try {
        const services = this.services.haService.getServiceCalls();
        res.json({ services });
      } catch (error) {
        logger.error('Failed to get Home Assistant services', { error: error.message });
        res.status(500).json({ error: 'Failed to get Home Assistant services' });
      }
    });

    this.app.post('/api/homeassistant/sync/trigger', async (req, res) => {
      try {
        const { source = 'api' } = req.body;
        const result = await this.services.haService.handleSyncTrigger(source);
        
        if (result.success) {
          res.json(result);
        } else {
          res.status(500).json(result);
        }
      } catch (error) {
        logger.error('Failed to trigger sync via Home Assistant', { error: error.message });
        res.status(500).json({ error: 'Failed to trigger sync' });
      }
    });

    // Default route - serve web interface
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../web/index.html'));
    });
  }

  /**
   * Setup error handling middleware
   */
  setupErrorHandling() {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`
      });
    });

    // Global error handler
    this.app.use((err, req, res, next) => {
      logger.error('Unhandled error:', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
      });

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred'
      });
    });
  }

  /**
   * Start the application server
   */
  async start() {
    const port = process.env.PORT || 8080;
    
    this.server = this.app.listen(port, async () => {
      logger.info(`Actual-Xero Sync server started on port ${port}`);
      logger.info('Web interface available at http://localhost:' + port);
      
      // Start log monitoring after server is running
      await this.startLogMonitoring();
    });

    // Graceful shutdown handling
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
  }

  /**
   * Graceful shutdown
   */
  async shutdown(signal) {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    
    this.isShuttingDown = true;
    
    // Stop log monitoring
    this.stopLogMonitoring();
    
    // Wait for active operations to complete
    if (this.activeOperations.size > 0) {
      logger.info(`Waiting for ${this.activeOperations.size} active operations to complete...`);
      
      const timeout = setTimeout(() => {
        logger.warn('Shutdown timeout reached, forcing exit');
        process.exit(1);
      }, 30000); // 30 second timeout
      
      while (this.activeOperations.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      clearTimeout(timeout);
    }
    
    if (this.server) {
      this.server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  }

  /**
   * Setup log monitor event handlers
   */
  setupLogMonitorEvents() {
    if (!this.logMonitor) return;

    this.logMonitor.on('alert-created', (alert) => {
      logger.warn(`Log Monitor Alert: ${alert.type}`, {
        alertId: alert.id,
        alertDetails: alert.details
      });
    });

    this.logMonitor.on('health-check-failed', (error) => {
      logger.error('Log monitoring health check failed', error);
    });

    this.logMonitor.on('rotation-completed', (result) => {
      logger.info('Log rotation completed', result);
    });

    this.logMonitor.on('monitoring-started', () => {
      logger.info('Log monitoring started');
    });

    this.logMonitor.on('monitoring-stopped', () => {
      logger.info('Log monitoring stopped');
    });
  }

  /**
   * Start log monitoring
   */
  async startLogMonitoring() {
    if (this.logMonitor && !this.logMonitor.monitoring) {
      try {
        await this.logMonitor.startMonitoring();
        logger.info('Log monitoring service started');
      } catch (error) {
        logger.error('Failed to start log monitoring', { error: error.message });
      }
    }
  }

  /**
   * Stop log monitoring
   */
  stopLogMonitoring() {
    if (this.logMonitor && this.logMonitor.monitoring) {
      this.logMonitor.stopMonitoring();
      logger.info('Log monitoring service stopped');
    }
  }

  /**
   * Get log monitoring status
   */
  getLogMonitoringStatus() {
    if (!this.logMonitor) {
      return { available: false };
    }

    return {
      available: true,
      ...this.logMonitor.getStatus()
    };
  }
}

module.exports = ActualXeroSyncApp;

// Start the application if this file is run directly
if (require.main === module) {
  const app = new ActualXeroSyncApp();
  
  app.init()
    .then(() => app.start())
    .catch((error) => {
      console.error('Failed to start application:', error);
      process.exit(1);
    });
}