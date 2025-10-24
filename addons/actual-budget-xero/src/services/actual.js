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
      this.logger.info('Authenticating with Actual Budget server');
      
      const response = await this.post('/account/login', {
        password: this.password
      });

      if (response.data && response.data.token) {
        this.token = response.data.token;
        this.defaultHeaders['X-ACTUAL-TOKEN'] = this.token;
        this.isAuthenticated = true;
        this.logger.info('Successfully authenticated with Actual Budget');
        return true;
      } else {
        throw new Error('No token received from authentication');
      }
    } catch (error) {
      this.logger.error('Failed to authenticate with Actual Budget:', error.message);
      this.isAuthenticated = false;
      throw error;
    }
  }

  /**
   * Ensure authentication before making API calls
   * @private
   */
  async ensureAuthenticated() {
    if (!this.isAuthenticated) {
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
      const response = await this.get('/sync/list-user-files');
      return response.data || [];
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
      
      const response = await this.post('/sync/load-user-file', {
        fileId: budgetId
      });

      if (response.statusCode === 200) {
        this.budgetId = budgetId;
        this.logger.info(`Successfully loaded budget: ${budgetId}`);
        return true;
      } else {
        throw new Error(`Failed to load budget: ${response.statusMessage}`);
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
      const response = await this.get('/api/categories');
      let categories = response.data || [];

      // Filter by group ID if specified
      if (groupId) {
        categories = categories.filter(category => category.cat_group === groupId);
      }

      this.logger.info(`Retrieved ${categories.length} categories${groupId ? ` for group ${groupId}` : ''}`);
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
      const response = await this.get('/api/category-groups');
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