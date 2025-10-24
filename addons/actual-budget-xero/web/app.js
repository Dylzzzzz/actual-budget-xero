// Actual-Xero Sync Web Interface JavaScript

class ActualXeroSyncUI {
    constructor() {
        this.statusElements = {
            systemStatus: document.getElementById('system-status'),
            lastSync: document.getElementById('last-sync'),
            configStatus: document.getElementById('config-status'),
            syncStatus: document.getElementById('sync-status'),
            lastResult: document.getElementById('last-result')
        };
        
        this.statsElements = {
            totalProcessed: document.getElementById('total-processed'),
            successfulImports: document.getElementById('successful-imports'),
            failedTransactions: document.getElementById('failed-transactions'),
            pendingMappings: document.getElementById('pending-mappings')
        };
        
        this.configElements = {
            actualUrl: document.getElementById('actual-url'),
            categoryGroup: document.getElementById('category-group'),
            syncSchedule: document.getElementById('sync-schedule'),
            syncDaysBack: document.getElementById('sync-days-back'),
            batchSize: document.getElementById('batch-size'),
            rateLimit: document.getElementById('rate-limit')
        };
        
        this.buttons = {
            triggerSync: document.getElementById('trigger-sync'),
            triggerReprocess: document.getElementById('trigger-reprocess'),
            refreshStatus: document.getElementById('refresh-status'),
            clearLogs: document.getElementById('clear-logs')
        };
        
        this.progressElements = {
            container: document.getElementById('sync-progress'),
            fill: document.getElementById('progress-fill'),
            text: document.getElementById('progress-text')
        };
        
        this.activityLog = document.getElementById('activity-log');
        this.logFilter = document.getElementById('log-filter');
        
        // Application state
        this.isSyncing = false;
        this.isReprocessing = false;
        this.currentFilter = 'all';
        this.logEntries = [];
        this.lastStatusUpdate = null;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadStatus();
        this.loadConfiguration();
        
        // Auto-refresh status every 15 seconds
        setInterval(() => this.loadStatus(), 15000);
        
        // Check for real-time updates every 5 seconds when syncing
        setInterval(() => {
            if (this.isSyncing || this.isReprocessing) {
                this.checkSyncProgress();
            }
        }, 5000);
    }

    setupEventListeners() {
        this.buttons.triggerSync.addEventListener('click', () => this.triggerSync());
        this.buttons.triggerReprocess.addEventListener('click', () => this.triggerReprocess());
        this.buttons.refreshStatus.addEventListener('click', () => this.loadStatus());
        this.buttons.clearLogs.addEventListener('click', () => this.clearLogs());
        
        this.logFilter.addEventListener('change', (e) => {
            this.currentFilter = e.target.value;
            this.filterLogs();
        });
    }

    async loadStatus() {
        try {
            this.addUpdatingAnimation('status-info');
            
            const [statusResponse, statsResponse] = await Promise.all([
                fetch('/api/config/status'),
                fetch('/api/sync/stats').catch(() => ({ ok: false }))
            ]);
            
            const status = await statusResponse.json();
            let stats = null;
            
            if (statsResponse.ok) {
                stats = await statsResponse.json();
            }
            
            this.updateStatusDisplay(status, stats);
            this.lastStatusUpdate = new Date();
            
            if (!this.isSyncing && !this.isReprocessing) {
                this.addLogEntry('Status refreshed', 'info');
            }
            
        } catch (error) {
            console.error('Failed to load status:', error);
            this.updateStatusDisplay(null, null, error);
            this.addLogEntry('Failed to load status: ' + error.message, 'error');
        } finally {
            this.removeUpdatingAnimation('status-info');
        }
    }

    async loadConfiguration() {
        try {
            const response = await fetch('/api/config/details');
            if (response.ok) {
                const config = await response.json();
                this.updateConfigurationDisplay(config);
            }
        } catch (error) {
            console.error('Failed to load configuration:', error);
            this.addLogEntry('Failed to load configuration details', 'warning');
        }
    }

    updateStatusDisplay(status, stats = null, error = null) {
        if (error) {
            this.statusElements.systemStatus.innerHTML = '<span class="status-indicator offline"></span>Error';
            this.statusElements.systemStatus.className = 'value error';
            this.statusElements.configStatus.textContent = 'Unknown';
            this.statusElements.configStatus.className = 'value error';
            this.statusElements.syncStatus.textContent = 'Unknown';
            this.statusElements.syncStatus.className = 'value error';
            return;
        }

        // System status
        this.statusElements.systemStatus.innerHTML = '<span class="status-indicator online"></span>Running';
        this.statusElements.systemStatus.className = 'value';

        // Configuration status
        const configOk = status.actual_budget_configured && 
                        status.xano_configured && 
                        status.xero_configured;
        
        this.statusElements.configStatus.innerHTML = configOk ? 
            '<span class="status-indicator online"></span>Valid' : 
            '<span class="status-indicator warning"></span>Incomplete';
        this.statusElements.configStatus.className = configOk ? 'value' : 'value warning';

        // Sync status
        if (this.isSyncing) {
            this.statusElements.syncStatus.innerHTML = '<span class="status-indicator warning"></span>Syncing';
            this.statusElements.syncStatus.className = 'value warning';
        } else if (this.isReprocessing) {
            this.statusElements.syncStatus.innerHTML = '<span class="status-indicator warning"></span>Reprocessing';
            this.statusElements.syncStatus.className = 'value warning';
        } else {
            this.statusElements.syncStatus.innerHTML = '<span class="status-indicator online"></span>Idle';
            this.statusElements.syncStatus.className = 'value';
        }

        // Update stats if available
        if (stats) {
            this.updateStatsDisplay(stats);
        }

        // Enable/disable buttons based on configuration and current operations
        const canOperate = configOk && !this.isSyncing && !this.isReprocessing;
        this.buttons.triggerSync.disabled = !canOperate;
        this.buttons.triggerReprocess.disabled = !canOperate;
    }

    updateStatsDisplay(stats) {
        this.statsElements.totalProcessed.textContent = stats.total_processed || 0;
        this.statsElements.successfulImports.textContent = stats.successful_imports || 0;
        this.statsElements.failedTransactions.textContent = stats.failed_transactions || 0;
        this.statsElements.pendingMappings.textContent = stats.pending_mappings || 0;
    }

    updateConfigurationDisplay(config) {
        this.configElements.actualUrl.textContent = config.actual_budget_url || '-';
        this.configElements.categoryGroup.textContent = config.business_category_group_name || 
                                                       config.business_category_group_id || '-';
        this.configElements.syncSchedule.textContent = config.sync_schedule || '-';
        this.configElements.syncDaysBack.textContent = config.sync_days_back || '-';
        this.configElements.batchSize.textContent = config.batch_size || '-';
        this.configElements.rateLimit.textContent = (config.xano_rate_limit || '-') + ' calls/min';
    }

    async triggerSync() {
        if (this.isSyncing || this.isReprocessing) return;
        
        this.isSyncing = true;
        this.showProgress('Initializing sync...');
        this.updateButtonState(this.buttons.triggerSync, true, 'Syncing...');
        
        try {
            const response = await fetch('/api/sync/trigger', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.addLogEntry('Manual sync started successfully', 'success');
                this.statusElements.lastSync.textContent = new Date().toLocaleString();
                
                // Start monitoring sync progress
                this.monitorSyncProgress(result.syncId);
                
            } else {
                throw new Error(result.message || 'Sync failed to start');
            }
            
        } catch (error) {
            console.error('Sync failed:', error);
            this.addLogEntry('Sync failed to start: ' + error.message, 'error');
            this.isSyncing = false;
            this.hideProgress();
            this.updateButtonState(this.buttons.triggerSync, false, 'Trigger Manual Sync');
        }
    }

    async triggerReprocess() {
        if (this.isSyncing || this.isReprocessing) return;
        
        this.isReprocessing = true;
        this.showProgress('Initializing reprocessing...');
        this.updateButtonState(this.buttons.triggerReprocess, true, 'Reprocessing...');
        
        try {
            const response = await fetch('/api/sync/reprocess', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.addLogEntry('Reprocessing started successfully', 'success');
                
                // Start monitoring reprocess progress
                this.monitorReprocessProgress(result.reprocessId);
                
            } else {
                throw new Error(result.message || 'Reprocessing failed to start');
            }
            
        } catch (error) {
            console.error('Reprocessing failed:', error);
            this.addLogEntry('Reprocessing failed to start: ' + error.message, 'error');
            this.isReprocessing = false;
            this.hideProgress();
            this.updateButtonState(this.buttons.triggerReprocess, false, 'Reprocess Failed');
        }
    }

    async monitorSyncProgress(syncId) {
        const checkProgress = async () => {
            try {
                const response = await fetch(`/api/sync/progress/${syncId}`);
                if (response.ok) {
                    const progress = await response.json();
                    this.updateProgress(progress);
                    
                    if (progress.status === 'completed' || progress.status === 'failed') {
                        this.handleSyncComplete(progress);
                        return;
                    }
                }
            } catch (error) {
                console.error('Failed to check sync progress:', error);
            }
            
            // Continue monitoring if still syncing
            if (this.isSyncing) {
                setTimeout(checkProgress, 2000);
            }
        };
        
        checkProgress();
    }

    async monitorReprocessProgress(reprocessId) {
        const checkProgress = async () => {
            try {
                const response = await fetch(`/api/sync/reprocess-progress/${reprocessId}`);
                if (response.ok) {
                    const progress = await response.json();
                    this.updateProgress(progress);
                    
                    if (progress.status === 'completed' || progress.status === 'failed') {
                        this.handleReprocessComplete(progress);
                        return;
                    }
                }
            } catch (error) {
                console.error('Failed to check reprocess progress:', error);
            }
            
            // Continue monitoring if still reprocessing
            if (this.isReprocessing) {
                setTimeout(checkProgress, 2000);
            }
        };
        
        checkProgress();
    }

    handleSyncComplete(progress) {
        this.isSyncing = false;
        this.hideProgress();
        this.updateButtonState(this.buttons.triggerSync, false, 'Trigger Manual Sync');
        
        if (progress.status === 'completed') {
            this.statusElements.lastResult.textContent = `Success (${progress.processed || 0} processed)`;
            this.statusElements.lastResult.className = 'value';
            this.addLogEntry(`Sync completed successfully - ${progress.processed || 0} transactions processed`, 'success');
        } else {
            this.statusElements.lastResult.textContent = 'Failed';
            this.statusElements.lastResult.className = 'value error';
            this.addLogEntry(`Sync failed: ${progress.error || 'Unknown error'}`, 'error');
        }
        
        // Refresh status to get updated stats
        this.loadStatus();
    }

    handleReprocessComplete(progress) {
        this.isReprocessing = false;
        this.hideProgress();
        this.updateButtonState(this.buttons.triggerReprocess, false, 'Reprocess Failed');
        
        if (progress.status === 'completed') {
            this.addLogEntry(`Reprocessing completed - ${progress.reprocessed || 0} transactions reprocessed`, 'success');
        } else {
            this.addLogEntry(`Reprocessing failed: ${progress.error || 'Unknown error'}`, 'error');
        }
        
        // Refresh status to get updated stats
        this.loadStatus();
    }

    addLogEntry(message, type = 'info') {
        const entry = document.createElement('p');
        entry.className = `log-entry ${type}`;
        entry.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
        
        // Add to top of log
        this.activityLog.insertBefore(entry, this.activityLog.firstChild);
        
        // Keep only last 50 entries
        while (this.activityLog.children.length > 50) {
            this.activityLog.removeChild(this.activityLog.lastChild);
        }
    }
}

// Initialize the UI when DOM is loaded
    showProgress(message) {
        this.progressElements.container.classList.remove('hidden');
        this.progressElements.text.textContent = message;
        this.progressElements.fill.style.width = '0%';
    }

    hideProgress() {
        this.progressElements.container.classList.add('hidden');
    }

    updateProgress(progress) {
        if (progress.message) {
            this.progressElements.text.textContent = progress.message;
        }
        
        if (progress.percentage !== undefined) {
            this.progressElements.fill.style.width = `${progress.percentage}%`;
        }
        
        if (progress.currentStep) {
            this.addLogEntry(progress.currentStep, 'info');
        }
    }

    updateButtonState(button, disabled, text) {
        button.disabled = disabled;
        const icon = button.querySelector('.btn-icon');
        const textNode = button.childNodes[button.childNodes.length - 1];
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
            textNode.textContent = text;
        }
    }

    addUpdatingAnimation(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.classList.add('updating');
        }
    }

    removeUpdatingAnimation(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.classList.remove('updating');
        }
    }

    clearLogs() {
        this.logEntries = [];
        this.activityLog.innerHTML = '<p class="log-entry info">Logs cleared</p>';
        this.addLogEntry('Log history cleared', 'info');
    }

    filterLogs() {
        const entries = this.activityLog.querySelectorAll('.log-entry');
        entries.forEach(entry => {
            const entryType = Array.from(entry.classList).find(cls => 
                ['error', 'warning', 'success', 'info'].includes(cls)
            ) || 'info';
            
            if (this.currentFilter === 'all' || this.currentFilter === entryType) {
                entry.style.display = 'block';
            } else {
                entry.style.display = 'none';
            }
        });
    }

    async checkSyncProgress() {
        // This method is called periodically to check for any ongoing operations
        // and update the UI accordingly
        try {
            const response = await fetch('/api/sync/current-status');
            if (response.ok) {
                const status = await response.json();
                
                if (status.syncing && !this.isSyncing) {
                    this.isSyncing = true;
                    this.showProgress('Sync in progress...');
                } else if (status.reprocessing && !this.isReprocessing) {
                    this.isReprocessing = true;
                    this.showProgress('Reprocessing in progress...');
                } else if (!status.syncing && !status.reprocessing && (this.isSyncing || this.isReprocessing)) {
                    // Operations completed
                    this.isSyncing = false;
                    this.isReprocessing = false;
                    this.hideProgress();
                    this.updateButtonState(this.buttons.triggerSync, false, 'Trigger Manual Sync');
                    this.updateButtonState(this.buttons.triggerReprocess, false, 'Reprocess Failed');
                }
            }
        } catch (error) {
            // Silently handle errors in background checks
            console.debug('Background status check failed:', error);
        }
    }
}

// Initialize the UI when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ActualXeroSyncUI();
});