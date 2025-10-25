const BaseApiClient = require('../utils/base-api-client');

/**
 * ActualBudgetClient - API client for Actual Budget integration
 * 
 * Handles authentication, transaction fetching, and note updates for Actual Budget
 */
class ActualBudgetClient extends BaseApiClient {
  constructor(options = {}) {
    super({
      baseUrl: options.baseUrl,
      timeout: options.timeout || 30000,
      logger: options.logger || console,
      defaultHeaders: {
        'Content-Type': 'application/json'
      }
    });
    
    this.password = options.password;
    this.token = null;
    this.budgetId = null;
    this.isAuthenticated = false;
  }

  /**
   * Authenticate with Actual Budget server
   * @returns {Promise<boolean>} - Authentication success
   */
  async authenticate() {
    try {
      this.logger.info('Authenticating with Actual Budget server', {
        url: this.baseUrl,
        passwordLength: this.password ? this.password.length : 0
      });
      
      const response = await this.post('/account/login', {
        password: this.password
      });

      this.logger.debug('Authentication response:', {
        statusCode: response.statusCode,
        hasData: !!response.data,
        dataType: typeof response.data,
        dataKeys: response.data ? Object.keys(response.data) : []
      });

      // Handle both possible response formats from Actual Budget
      let token = null;
      if (response.data && response.data.data && response.data.data.token) {
        // Nested format: { status: "ok", data: { token: "..." } }
        token = response.data.data.token;
      } else if (response.data && response.data.token) {
        // Direct format: { token: "..." }
        token = response.data.token;
      }

      if (token) {
        this.token = token;
        this.defaultHeaders['X-ACTUAL-TOKEN'] = this.token;
        this.isAuthenticated = true;
        this.logger.info('Successfully authenticated with Actual Budget', {
          tokenLength: token.length
        });
        return true;
      } else {
        this.logger.error('Authentication failed - no token in response:', {
          responseData: response.data,
          statusCode: response.statusCode
        });
        throw new Error('No token received from authentication');
      }
    } catch (error) {
      this.logger.error('Failed to authenticate with Actual Budget:', {
        message: error.message,
        statusCode: error.statusCode,
        url: this.baseUrl,
        passwordProvided: !!this.password
      });
      this.isAuthenticated = false;
      throw error;
    }
  }

  /**
   * Test connectivity to Actual Budget server
   * @returns {Promise<boolean>} - Connectivity test result
   */
  async testConnectivity() {
    try {
      this.logger.info('Testing connectivity to Actual Budget server', { url: this.baseUrl });
      
      // Try a simple GET request to see if the server is reachable
      const response = await this.get('/');
      
      this.logger.info('Connectivity test successful', {
        statusCode: response.statusCode,
        url: this.baseUrl
      });
      
      return true;
    } catch (error) {
      this.logger.error('Connectivity test failed', {
        message: error.message,
        code: error.code,
        url: this.baseUrl
      });
      
      return false;
    }
  }

  /**
   * Ensure authentication before making API calls
   * @private
   */
  async ensureAuthenticated() {
    if (!this.isAuthenticated) {
      // Test connectivity first
      const isConnected = await this.testConnectivity();
      if (!isConnected) {
        throw new Error(`Cannot connect to Actual Budget server at ${this.baseUrl}. Please check the URL and ensure the server is running.`);
      }
      
      await this.authenticate();
    }
  }

  /**
   * Get list of available budgets
   * @returns {Promise<Array>} - Array of budget objects
   */
  async getBudgets() {
    await this.ensureAuthenticated();
    
    try {
      // Try different API endpoints to get budgets
      let response;
      let budgets = [];
      
      // Method 1: Try the sync list endpoint
      try {
        response = await this.get('/sync/list-user-files');
        
        this.logger.debug('Sync list response:', {
          statusCode: response.statusCode,
          dataType: typeof response.data,
          isArray: Array.isArray(response.data),
          data: response.data
        });
        
        // Handle different possible response formats
        if (Array.isArray(response.data)) {
          budgets = response.data;
        } else if (response.data && typeof response.data === 'object') {
          // If it's an object, try to extract budgets from common properties
          if (response.data.files) {
            budgets = response.data.files;
          } else if (response.data.budgets) {
            budgets = response.data.budgets;
          } else if (response.data.data) {
            budgets = Array.isArray(response.data.data) ? response.data.data : [];
          } else {
            // Convert object to array if it has budget-like properties
            budgets = [response.data];
          }
        }
      } catch (error) {
        this.logger.debug(`Sync list endpoint failed: ${error.message}`);
      }
      
      // Method 2: Try alternative endpoint if first failed
      if (budgets.length === 0) {
        try {
          response = await this.get('/api/budgets');
          if (Array.isArray(response.data)) {
            budgets = response.data;
          }
        } catch (error) {
          this.logger.debug(`API budgets endpoint failed: ${error.message}`);
        }
      }
      
      // Ensure we return an array
      if (!Array.isArray(budgets)) {
        this.logger.warn('Budgets response is not an array, converting to empty array');
        budgets = [];
      }
      
      this.logger.info(`Found ${budgets.length} budgets`);
      if (budgets.length > 0) {
        this.logger.debug('First budget structure:', Object.keys(budgets[0]));
      }
      
      return budgets;
    } catch (error) {
      this.logger.error('Failed to get budgets:', error.message);
      throw error;
    }
  }

  /**
   * Load a specific budget
   * @param {string} budgetId - Budget ID to load
   * @returns {Promise<boolean>} - Success status
   */
  async loadBudget(budgetId) {
    await this.ensureAuthenticated();
    
    try {
      this.logger.info(`Loading budget: ${budgetId}`);
      
      // Try different possible API endpoints for loading budgets
      let response;
      let success = false;
      
      // Method 1: Try the sync endpoint (most common)
      try {
        response = await this.post('/sync/sync', {
          fileId: budgetId,
          groupId: null,
          keyId: null,
          since: null
        });
        success = response.statusCode === 200;
      } catch (error) {
        this.logger.debug(`Sync endpoint failed: ${error.message}`);
      }
      
      // Method 2: Try direct file loading
      if (!success) {
        try {
          response = await this.post('/sync/download-user-file', {
            fileId: budgetId
          });
          success = response.statusCode === 200;
        } catch (error) {
          this.logger.debug(`Download endpoint failed: ${error.message}`);
        }
      }
      
      // Method 3: Just set the budget ID (some Actual Budget setups don't require explicit loading)
      if (!success) {
        this.logger.info(`Direct budget loading not available, setting budget ID: ${budgetId}`);
        this.budgetId = budgetId;
        
        // Test if we can access budget data
        try {
          await this.get('/api/categories');
          success = true;
          this.logger.info(`Budget ${budgetId} is accessible without explicit loading`);
        } catch (error) {
          throw new Error(`Cannot access budget data: ${error.message}`);
        }
      }

      if (success) {
        this.budgetId = budgetId;
        this.logger.info(`Successfully loaded budget: ${budgetId}`);
        return true;
      } else {
        throw new Error(`Failed to load budget: ${response?.statusMessage || 'Unknown error'}`);
      }
    } catch (error) {
      this.logger.error('Failed to load budget:', error.message);
      throw error;
    }
  }

  /**
   * Get categories for the loaded budget
   * @param {string} groupId - Optional category group ID to filter by
   * @returns {Promise<Array>} - Array of category objects
   */
  async getCategories(groupId = null) {
    await this.ensureAuthenticated();
    
    if (!this.budgetId) {
      throw new Error('No budget loaded. Call loadBudget() first.');
    }

    try {
      // Try different possible API endpoints for categories
      let response;
      let success = false;
      
      // Try sync-based approach since other APIs don't work
      response = await this.post('/sync/sync', {
        fileId: this.budgetId,
        groupId: null,
        keyId: null,
        since: null,
        messages: [
          {
            dataset: 'categories',
            row: null,
            column: null,
            value: null,
            timestamp: Date.now()
          }
        ]
      });
      
      if (response.statusCode !== 200 || typeof response.data === 'string') {
        throw new Error('Sync-based categories request failed or returned HTML');
      }
      
      this.logger.info('Categories API response:', {
        statusCode: response.statusCode,
        dataType: typeof response.data,
        isArray: Array.isArray(response.data),
        dataKeys: response.data ? Object.keys(response.data) : [],
        fullData: response.data // Log the full response to see structure
      });
      
      let categories = [];
      
      // Handle different possible response formats
      if (Array.isArray(response.data)) {
        categories = response.data;
      } else if (response.data && typeof response.data === 'object') {
        // Try to extract categories from nested structure
        if (response.data.categories) {
          categories = Array.isArray(response.data.categories) ? response.data.categories : [];
        } else if (response.data.data) {
          categories = Array.isArray(response.data.data) ? response.data.data : [];
        } else {
          // Convert object values to array if they look like categories
          const values = Object.values(response.data);
          if (values.length > 0 && values[0] && typeof values[0] === 'object') {
            categories = values;
          }
        }
      }
      
      // Ensure we have an array
      if (!Array.isArray(categories)) {
        this.logger.warn('Categories response is not an array, converting to empty array');
        categories = [];
      }

      // Filter by group ID if specified
      if (groupId && categories.length > 0) {
        const originalLength = categories.length;
        const originalCategories = [...categories]; // Keep original for logging
        
        // Log all categories to see their structure
        this.logger.info('All categories before filtering:', originalCategories.map(cat => ({
          id: cat.id,
          name: cat.name,
          cat_group: cat.cat_group,
          categoryGroup: cat.categoryGroup,
          group_id: cat.group_id,
          groupId: cat.groupId,
          allKeys: Object.keys(cat)
        })));
        
        categories = categories.filter(category => 
          category.group_id === groupId
        );
        
        this.logger.info(`Filtered categories from ${originalLength} to ${categories.length} for group ${groupId}`);
        
        if (categories.length === 0) {
          this.logger.warn(`No categories found for group ${groupId}. Available group IDs in categories:`, 
            [...new Set(originalCategories.map(cat => cat.cat_group || cat.categoryGroup || cat.group_id || cat.groupId).filter(Boolean))]
          );
        }
      }

      this.logger.info(`Retrieved ${categories.length} categories${groupId ? ` for group ${groupId}` : ''}`);
      
      if (categories.length > 0) {
        this.logger.info('First category structure:', Object.keys(categories[0]));
      } else {
        this.logger.info('No categories found in response - this might be why no transactions are detected');
      }
      
      return categories;
    } catch (error) {
      this.logger.error('Failed to get categories:', error.message);
      throw error;
    }
  }

  /**
   * Get category groups for the loaded budget
   * @returns {Promise<Array>} - Array of category group objects
   */
  async getCategoryGroups() {
    await this.ensureAuthenticated();
    
    if (!this.budgetId) {
      throw new Error('No budget loaded. Call loadBudget() first.');
    }

    try {
      const response = await this.post('/api/getCategoryGroups', {});
      
      if (response.statusCode !== 200 || typeof response.data === 'string') {
        throw new Error('getCategoryGroups method failed or returned HTML');
      }
      
      const groups = response.data || [];
      
      this.logger.info(`Retrieved ${groups.length} category groups`);
      return groups;
    } catch (error) {
      this.logger.error('Failed to get category groups:', error.message);
      throw error;
    }
  }

  /**
   * Find category group by name
   * @param {string} groupName - Name of the category group to find
   * @returns {Promise<Object|null>} - Category group object or null if not found
   */
  async findCategoryGroupByName(groupName) {
    const groups = await this.getCategoryGroups();
    const group = groups.find(g => g.name === groupName);
    
    if (group) {
      this.logger.info(`Found category group "${groupName}" with ID: ${group.id}`);
    } else {
      this.logger.warn(`Category group "${groupName}" not found`);
    }
    
    return group || null;
  }

  /**
   * Get payees for the loaded budget
   * @returns {Promise<Array>} - Array of payee objects
   */
  async getPayees() {
    await this.ensureAuthenticated();
    
    if (!this.budgetId) {
      throw new Error('No budget loaded. Call loadBudget() first.');
    }

    try {
      const response = await this.get('/api/payees');
      const payees = response.data || [];
      
      this.logger.info(`Retrieved ${payees.length} payees`);
      return payees;
    } catch (error) {
      this.logger.error('Failed to get payees:', error.message);
      throw error;
    }
  }

  /**
   * Get reconciled transactions by category group
   * @param {string} categoryGroupId - Category group ID to filter by
   * @param {Date} since - Optional date to get transactions since
   * @returns {Promise<Array>} - Array of reconciled transaction objects
   */
  async getReconciledTransactions(categoryGroupId, since = null) {
    await this.ensureAuthenticated();
    
    if (!this.budgetId) {
      throw new Error('No budget loaded. Call loadBudget() first.');
    }

    try {
      // First get all categories in the group to filter transactions
      const categories = await this.getCategories(categoryGroupId);
      const categoryIds = categories.map(cat => cat.id);
      
      if (categoryIds.length === 0) {
        this.logger.warn(`No categories found for group ${categoryGroupId}`);
        return [];
      }

      // Build query parameters
      const queryParams = {
        'filter[reconciled]': true
      };

      // Add date filter if specified
      if (since) {
        const sinceDate = since instanceof Date ? since.toISOString().split('T')[0] : since;
        queryParams['filter[date]'] = `>=${sinceDate}`;
      }

      const response = await this.get('/api/transactions', { queryParams });
      let transactions = response.data || [];

      // Filter transactions by category group
      transactions = transactions.filter(transaction => 
        categoryIds.includes(transaction.category)
      );

      this.logger.info(`Retrieved ${transactions.length} reconciled transactions for category group ${categoryGroupId}`);
      return transactions;
    } catch (error) {
      this.logger.error('Failed to get reconciled transactions:', error.message);
      throw error;
    }
  }

  /**
   * Update transaction notes with sync status tags
   * @param {string} transactionId - Transaction ID to update
   * @param {string} newTags - Tags to add to the transaction notes
   * @returns {Promise<boolean>} - Success status
   */
  async updateTransactionNotes(transactionId, newTags) {
    await this.ensureAuthenticated();
    
    if (!this.budgetId) {
      throw new Error('No budget loaded. Call loadBudget() first.');
    }

    try {
      // First get the current transaction to preserve existing notes
      const currentTransaction = await this.getTransaction(transactionId);
      if (!currentTransaction) {
        throw new Error(`Transaction ${transactionId} not found`);
      }

      // Append new tags to existing notes
      const existingNotes = currentTransaction.notes || '';
      const updatedNotes = this.appendTags(existingNotes, newTags);

      // Update the transaction
      const response = await this.patch(`/api/transactions/${transactionId}`, {
        notes: updatedNotes
      });

      if (response.statusCode === 200) {
        this.logger.info(`Successfully updated notes for transaction ${transactionId}`);
        return true;
      } else {
        throw new Error(`Failed to update transaction notes: ${response.statusMessage}`);
      }
    } catch (error) {
      this.logger.error(`Failed to update transaction notes for ${transactionId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get a single transaction by ID
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<Object|null>} - Transaction object or null if not found
   */
  async getTransaction(transactionId) {
    await this.ensureAuthenticated();
    
    if (!this.budgetId) {
      throw new Error('No budget loaded. Call loadBudget() first.');
    }

    try {
      const response = await this.get(`/api/transactions/${transactionId}`);
      return response.data || null;
    } catch (error) {
      if (error.statusCode === 404) {
        return null;
      }
      this.logger.error(`Failed to get transaction ${transactionId}:`, error.message);
      throw error;
    }
  }

  /**
   * Append tags to existing notes without removing content
   * @param {string} existingNotes - Current transaction notes
   * @param {string} newTags - Tags to append
   * @returns {string} - Updated notes with tags
   */
  appendTags(existingNotes, newTags) {
    if (!newTags || newTags.trim() === '') {
      return existingNotes;
    }

    // Clean up the new tags
    const cleanTags = newTags.trim();
    
    // If no existing notes, just return the tags
    if (!existingNotes || existingNotes.trim() === '') {
      return cleanTags;
    }

    // Check if tags already exist to avoid duplicates
    const existingTagsLower = existingNotes.toLowerCase();
    const newTagsArray = cleanTags.split(' ').filter(tag => tag.startsWith('#'));
    
    const tagsToAdd = newTagsArray.filter(tag => 
      !existingTagsLower.includes(tag.toLowerCase())
    );

    if (tagsToAdd.length === 0) {
      return existingNotes; // No new tags to add
    }

    // Append new tags with a space separator
    return `${existingNotes.trim()} ${tagsToAdd.join(' ')}`.trim();
  }

  /**
   * Add Xano sync tag to transaction
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<boolean>} - Success status
   */
  async addXanoTag(transactionId) {
    return this.updateTransactionNotes(transactionId, '#xano');
  }

  /**
   * Add Xero sync tag to transaction
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<boolean>} - Success status
   */
  async addXeroTag(transactionId) {
    return this.updateTransactionNotes(transactionId, '#xero');
  }

  /**
   * Add paid tag with date to transaction
   * @param {string} transactionId - Transaction ID
   * @param {Date} paidDate - Date when transaction was marked as paid
   * @returns {Promise<boolean>} - Success status
   */
  async addPaidTag(transactionId, paidDate = new Date()) {
    const dateString = paidDate instanceof Date 
      ? paidDate.toISOString().split('T')[0] 
      : paidDate;
    
    const tags = `#paid #${dateString}`;
    return this.updateTransactionNotes(transactionId, tags);
  }

  /**
   * Find category group by name
   * @param {string} groupName - Name of the category group to find
   * @returns {Promise<Object|null>} - Category group object or null if not found
   */
  async findCategoryGroupByName(groupName) {
    await this.ensureAuthenticated();
    
    // Auto-load the first available budget if none is loaded
    if (!this.budgetId) {
      await this.autoLoadBudget();
    }

    try {
      const groups = await this.getCategoryGroups();
      const group = groups.find(g => g.name === groupName);
      
      if (group) {
        this.logger.info(`Found category group "${groupName}" with ID: ${group.id}`);
        return group;
      } else {
        this.logger.warn(`Category group "${groupName}" not found. Available groups: ${groups.map(g => g.name).join(', ')}`);
        return null;
      }
    } catch (error) {
      this.logger.error(`Failed to find category group "${groupName}":`, error.message);
      throw error;
    }
  }

  /**
   * Get reconciled transactions for a category group
   * @param {string} categoryGroupId - Category group ID
   * @param {Date} since - Date to fetch transactions since
   * @returns {Promise<Array>} - Array of reconciled transactions
   */
  async getReconciledTransactions(categoryGroupId, since) {
    await this.ensureAuthenticated();
    
    // Auto-load the first available budget if none is loaded
    if (!this.budgetId) {
      await this.autoLoadBudget();
    }

    try {
      this.logger.info(`Fetching reconciled transactions for category group ${categoryGroupId} since ${since.toISOString()}`);

      // Since API endpoints don't work, let's try a sync-based approach to get all data
      this.logger.info('Attempting to get all budget data via sync mechanism');
      
      try {
        // Try to get all budget data using sync
        const syncResponse = await this.post('/sync/sync', {
          fileId: this.budgetId,
          groupId: null,
          keyId: null,
          since: 0, // Get all data
          messages: []
        });
        
        this.logger.info('Sync response received:', {
          statusCode: syncResponse.statusCode,
          dataType: typeof syncResponse.data,
          hasData: !!syncResponse.data
        });
        
        if (syncResponse.data && typeof syncResponse.data === 'object') {
          // Look for transactions in the sync response
          let allTransactions = [];
          
          if (syncResponse.data.transactions) {
            allTransactions = syncResponse.data.transactions;
          } else if (syncResponse.data.data && syncResponse.data.data.transactions) {
            allTransactions = syncResponse.data.data.transactions;
          } else if (Array.isArray(syncResponse.data)) {
            allTransactions = syncResponse.data;
          }
          
          this.logger.info(`Found ${allTransactions.length} total transactions in sync data`);
          
          // Filter for reconciled transactions since the date
          const reconciledTransactions = allTransactions.filter(transaction => {
            const transactionDate = new Date(transaction.date);
            return transactionDate >= since && 
                   (transaction.cleared === true || transaction.reconciled === true);
          });
          
          this.logger.info(`Found ${reconciledTransactions.length} reconciled transactions since ${since.toISOString()}`);
          
          // For now, return all reconciled transactions (we'll add category filtering later)
          if (reconciledTransactions.length > 0) {
            this.logger.info('Sample transaction structure:', Object.keys(reconciledTransactions[0]));
            return reconciledTransactions;
          }
        }
      } catch (syncError) {
        this.logger.error('Sync-based data retrieval failed:', syncError.message);
      }
      
      this.logger.warn('No method worked to retrieve transactions - API may not be available');
      return [];
    } catch (error) {
      this.logger.error(`Failed to get reconciled transactions for group ${categoryGroupId}:`, error.message);
      throw error;
    }
  }

  /**
   * Auto-load the first available budget
   * @returns {Promise<boolean>} - Success status
   */
  async autoLoadBudget() {
    try {
      this.logger.info('Auto-loading first available budget');
      
      const budgets = await this.getBudgets();
      
      if (budgets.length === 0) {
        throw new Error('No budgets available to load');
      }

      // Debug: Log budget structure
      this.logger.debug('Available budgets:', budgets.map(b => ({
        keys: Object.keys(b),
        id: b.id || b.fileId || b.name,
        name: b.name || b.fileName || 'Unknown'
      })));

      // Load the first budget - try different possible ID fields
      const firstBudget = budgets[0];
      const budgetId = firstBudget.id || firstBudget.fileId || firstBudget.name;
      
      if (!budgetId) {
        throw new Error(`Cannot determine budget ID from budget object: ${JSON.stringify(firstBudget)}`);
      }

      await this.loadBudget(budgetId);
      
      this.logger.info(`Auto-loaded budget: ${firstBudget.name || firstBudget.fileName || budgetId}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to auto-load budget:', error.message);
      throw error;
    }
  }

  /**
   * Test connection to Actual Budget server
   * @returns {Promise<boolean>} - Connection success
   */
  async testConnection() {
    try {
      await this.authenticate();
      const budgets = await this.getBudgets();
      this.logger.info(`Connection test successful. Found ${budgets.length} budgets.`);
      return true;
    } catch (error) {
      this.logger.error('Connection test failed:', error.message);
      return false;
    }
  }

  /**
   * Get client status and statistics
   * @returns {Object} - Status information
   */
  getStatus() {
    return {
      isAuthenticated: this.isAuthenticated,
      budgetId: this.budgetId,
      baseUrl: this.baseUrl,
      stats: this.getStats()
    };
  }
}

module.exports = ActualBudgetClient;