const BaseApiClient = require('../utils/base-api-client');
const XanoRateLimiter = require('../utils/rate-limiter');

/**
 * XanoClient - API client for Xano backend with integrated rate limiting
 * 
 * Handles transaction storage, mapping retrieval, and batch operations
 * with comprehensive error handling and rate limiting for Xano's API constraints
 */
class XanoClient extends BaseApiClient {
  constructor(options = {}) {
    const { apiUrl, apiKey, rateLimiter, ...baseOptions } = options;
    
    // Initialize base client with Xano-specific defaults
    super({
      baseUrl: apiUrl,
      defaultHeaders: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000,
      ...baseOptions
    });

    this.apiKey = apiKey;
    this.rateLimiter = rateLimiter || new XanoRateLimiter({
      requestsPerMinute: options.requestsPerMinute || 18,
      maxRetries: 3,
      baseBackoffMs: 1000
    });

    // Xano-specific statistics
    this.xanoStats = {
      transactionsStored: 0,
      duplicatesSkipped: 0,
      mappingsRetrieved: 0,
      batchOperations: 0
    };
  }

  /**
   * Store transaction in Xano with duplicate prevention
   * @param {Object} transaction - Transaction data from Actual Budget
   * @returns {Promise<Object>} - Stored transaction with Xano ID
   */
  async storeTransaction(transaction) {
    const transactionData = this.formatTransactionForStorage(transaction);
    
    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.post('/transactions', transactionData);
      });

      // Check if this was a duplicate (existing transaction returned)
      if (result.data.id && result.data.actual_transaction_id === transaction.id) {
        // Check if this is a new insert or existing record
        const isNewRecord = result.statusCode === 201;
        
        if (isNewRecord) {
          this.xanoStats.transactionsStored++;
          this.logger.info(`Transaction stored in Xano: ${transaction.id} -> Xano ID ${result.data.id}`);
        } else {
          this.xanoStats.duplicatesSkipped++;
          this.logger.debug(`Duplicate transaction skipped: ${transaction.id} (existing Xano ID: ${result.data.id})`);
        }
      }

      return result.data;
    } catch (error) {
      this.logger.error(`Failed to store transaction ${transaction.id}: ${error.message}`);
      throw this.createXanoError('TRANSACTION_STORE_FAILED', error, { transaction });
    }
  }

  /**
   * Get category mapping for Actual Budget category ID
   * @param {string} actualCategoryId - Actual Budget category ID
   * @returns {Promise<Object|null>} - Category mapping or null if not found
   */
  async getCategoryMapping(actualCategoryId) {
    if (!actualCategoryId) {
      return null;
    }

    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.get(`/category-mappings/${encodeURIComponent(actualCategoryId)}`);
      });

      this.xanoStats.mappingsRetrieved++;
      
      // Return null if mapping not found (404) or inactive
      if (result.statusCode === 404 || !result.data || !result.data.is_active) {
        return null;
      }

      return result.data;
    } catch (error) {
      // 404 is expected for missing mappings
      if (error.statusCode === 404) {
        return null;
      }
      
      this.logger.error(`Failed to get category mapping for ${actualCategoryId}: ${error.message}`);
      throw this.createXanoError('CATEGORY_MAPPING_FAILED', error, { actualCategoryId });
    }
  }

  /**
   * Get payee mapping for Actual Budget payee ID
   * @param {string} actualPayeeId - Actual Budget payee ID
   * @returns {Promise<Object|null>} - Payee mapping or null if not found
   */
  async getPayeeMapping(actualPayeeId) {
    if (!actualPayeeId) {
      return null;
    }

    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.get(`/payee-mappings/${encodeURIComponent(actualPayeeId)}`);
      });

      this.xanoStats.mappingsRetrieved++;
      
      // Return null if mapping not found (404) or inactive
      if (result.statusCode === 404 || !result.data || !result.data.is_active) {
        return null;
      }

      return result.data;
    } catch (error) {
      // 404 is expected for missing mappings
      if (error.statusCode === 404) {
        return null;
      }
      
      this.logger.error(`Failed to get payee mapping for ${actualPayeeId}: ${error.message}`);
      throw this.createXanoError('PAYEE_MAPPING_FAILED', error, { actualPayeeId });
    }
  }

  /**
   * Update transaction with resolved mappings
   * @param {number} xanoId - Xano transaction ID
   * @param {Object} mappings - Resolved mappings
   * @param {string} mappings.xero_account_id - Xero account ID
   * @param {string} mappings.xero_contact_id - Xero contact ID
   * @returns {Promise<Object>} - Updated transaction
   */
  async updateTransactionMapping(xanoId, mappings) {
    const updateData = {
      xero_account_id: mappings.xero_account_id || null,
      xero_contact_id: mappings.xero_contact_id || null,
      status: (mappings.xero_account_id && mappings.xero_contact_id) ? 'mapped' : 'pending'
    };

    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.put(`/transactions/${xanoId}/mapping`, updateData);
      });

      this.logger.debug(`Updated transaction mapping for Xano ID ${xanoId}: status=${updateData.status}`);
      return result.data;
    } catch (error) {
      this.logger.error(`Failed to update transaction mapping for Xano ID ${xanoId}: ${error.message}`);
      throw this.createXanoError('TRANSACTION_MAPPING_UPDATE_FAILED', error, { xanoId, mappings });
    }
  }

  /**
   * Update transaction with Xero import results
   * @param {number} xanoId - Xano transaction ID
   * @param {Object} xeroData - Xero import data
   * @param {string} xeroData.xero_transaction_id - Xero transaction ID
   * @param {Date} xeroData.xero_imported_date - Import timestamp
   * @returns {Promise<Object>} - Updated transaction
   */
  async updateTransactionXeroImport(xanoId, xeroData) {
    const updateData = {
      xero_transaction_id: xeroData.xero_transaction_id,
      xero_imported_date: xeroData.xero_imported_date || new Date().toISOString(),
      status: 'imported'
    };

    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.put(`/transactions/${xanoId}/xero-import`, updateData);
      });

      this.logger.info(`Updated transaction with Xero import data for Xano ID ${xanoId}: Xero ID ${xeroData.xero_transaction_id}`);
      return result.data;
    } catch (error) {
      this.logger.error(`Failed to update transaction Xero import for Xano ID ${xanoId}: ${error.message}`);
      throw this.createXanoError('TRANSACTION_XERO_UPDATE_FAILED', error, { xanoId, xeroData });
    }
  }

  /**
   * Mark transaction as failed with error message
   * @param {number} xanoId - Xano transaction ID
   * @param {string} errorMessage - Error description
   * @returns {Promise<Object>} - Updated transaction
   */
  async markTransactionFailed(xanoId, errorMessage) {
    const updateData = {
      status: 'failed',
      error_message: errorMessage
    };

    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.put(`/transactions/${xanoId}/status`, updateData);
      });

      this.logger.warn(`Marked transaction as failed for Xano ID ${xanoId}: ${errorMessage}`);
      return result.data;
    } catch (error) {
      this.logger.error(`Failed to mark transaction as failed for Xano ID ${xanoId}: ${error.message}`);
      throw this.createXanoError('TRANSACTION_STATUS_UPDATE_FAILED', error, { xanoId, errorMessage });
    }
  }

  /**
   * Create or update category mapping
   * @param {Object} categoryData - Category mapping data
   * @returns {Promise<Object>} - Created/updated mapping
   */
  async upsertCategoryMapping(categoryData) {
    const mappingData = {
      actual_category_id: categoryData.actual_category_id,
      actual_category_name: categoryData.actual_category_name,
      xero_account_id: categoryData.xero_account_id || null,
      xero_account_name: categoryData.xero_account_name || null,
      xero_account_code: categoryData.xero_account_code || null,
      is_active: categoryData.is_active !== undefined ? categoryData.is_active : true
    };

    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.post('/category-mappings', mappingData);
      });

      this.logger.debug(`Upserted category mapping: ${categoryData.actual_category_name} -> ${categoryData.xero_account_name || 'unmapped'}`);
      return result.data;
    } catch (error) {
      this.logger.error(`Failed to upsert category mapping for ${categoryData.actual_category_id}: ${error.message}`);
      throw this.createXanoError('CATEGORY_MAPPING_UPSERT_FAILED', error, { categoryData });
    }
  }

  /**
   * Create or update payee mapping
   * @param {Object} payeeData - Payee mapping data
   * @returns {Promise<Object>} - Created/updated mapping
   */
  async upsertPayeeMapping(payeeData) {
    const mappingData = {
      actual_payee_id: payeeData.actual_payee_id,
      actual_payee_name: payeeData.actual_payee_name,
      xero_contact_id: payeeData.xero_contact_id || null,
      xero_contact_name: payeeData.xero_contact_name || null,
      is_active: payeeData.is_active !== undefined ? payeeData.is_active : true
    };

    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.post('/payee-mappings', mappingData);
      });

      this.logger.debug(`Upserted payee mapping: ${payeeData.actual_payee_name} -> ${payeeData.xero_contact_name || 'unmapped'}`);
      return result.data;
    } catch (error) {
      this.logger.error(`Failed to upsert payee mapping for ${payeeData.actual_payee_id}: ${error.message}`);
      throw this.createXanoError('PAYEE_MAPPING_UPSERT_FAILED', error, { payeeData });
    }
  }

  /**
   * Bulk create or update category mappings
   * @param {Object[]} categoryMappings - Array of category mapping data
   * @returns {Promise<Object>} - Bulk upsert results
   */
  async bulkUpsertCategoryMappings(categoryMappings) {
    if (!Array.isArray(categoryMappings) || categoryMappings.length === 0) {
      return { created: [], updated: [], errors: [] };
    }

    const mappingData = categoryMappings.map(category => ({
      actual_category_id: category.actual_category_id,
      actual_category_name: category.actual_category_name,
      xero_account_id: category.xero_account_id || null,
      xero_account_name: category.xero_account_name || null,
      xero_account_code: category.xero_account_code || null,
      is_active: category.is_active !== undefined ? category.is_active : true
    }));

    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.post('/category-mappings/bulk', { mappings: mappingData });
      });

      this.xanoStats.batchOperations++;

      const created = result.data.created || [];
      const updated = result.data.updated || [];
      const errors = result.data.errors || [];

      this.logger.info(`Bulk upserted category mappings: ${created.length} created, ${updated.length} updated, ${errors.length} errors`);

      return { created, updated, errors };
    } catch (error) {
      this.logger.error(`Failed to bulk upsert category mappings: ${error.message}`);
      throw this.createXanoError('BULK_CATEGORY_UPSERT_FAILED', error, { mappingCount: categoryMappings.length });
    }
  }

  /**
   * Bulk create or update payee mappings
   * @param {Object[]} payeeMappings - Array of payee mapping data
   * @returns {Promise<Object>} - Bulk upsert results
   */
  async bulkUpsertPayeeMappings(payeeMappings) {
    if (!Array.isArray(payeeMappings) || payeeMappings.length === 0) {
      return { created: [], updated: [], errors: [] };
    }

    const mappingData = payeeMappings.map(payee => ({
      actual_payee_id: payee.actual_payee_id,
      actual_payee_name: payee.actual_payee_name,
      xero_contact_id: payee.xero_contact_id || null,
      xero_contact_name: payee.xero_contact_name || null,
      is_active: payee.is_active !== undefined ? payee.is_active : true
    }));

    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.post('/payee-mappings/bulk', { mappings: mappingData });
      });

      this.xanoStats.batchOperations++;

      const created = result.data.created || [];
      const updated = result.data.updated || [];
      const errors = result.data.errors || [];

      this.logger.info(`Bulk upserted payee mappings: ${created.length} created, ${updated.length} updated, ${errors.length} errors`);

      return { created, updated, errors };
    } catch (error) {
      this.logger.error(`Failed to bulk upsert payee mappings: ${error.message}`);
      throw this.createXanoError('BULK_PAYEE_UPSERT_FAILED', error, { mappingCount: payeeMappings.length });
    }
  }

  /**
   * Batch retrieve mappings for multiple categories and payees
   * @param {string[]} categoryIds - Array of Actual Budget category IDs
   * @param {string[]} payeeIds - Array of Actual Budget payee IDs
   * @returns {Promise<Object>} - Object with categoryMappings and payeeMappings arrays
   */
  async batchGetMappings(categoryIds = [], payeeIds = []) {
    const uniqueCategoryIds = [...new Set(categoryIds.filter(id => id))];
    const uniquePayeeIds = [...new Set(payeeIds.filter(id => id))];

    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        const queryParams = {};
        
        if (uniqueCategoryIds.length > 0) {
          queryParams.category_ids = uniqueCategoryIds.join(',');
        }
        
        if (uniquePayeeIds.length > 0) {
          queryParams.payee_ids = uniquePayeeIds.join(',');
        }

        return await this.get('/mappings/batch', { queryParams });
      });

      this.xanoStats.batchOperations++;
      this.xanoStats.mappingsRetrieved += (result.data.categoryMappings?.length || 0) + (result.data.payeeMappings?.length || 0);

      this.logger.debug(`Batch retrieved ${result.data.categoryMappings?.length || 0} category mappings and ${result.data.payeeMappings?.length || 0} payee mappings`);

      return {
        categoryMappings: result.data.categoryMappings || [],
        payeeMappings: result.data.payeeMappings || []
      };
    } catch (error) {
      this.logger.error(`Failed to batch retrieve mappings: ${error.message}`);
      throw this.createXanoError('BATCH_MAPPINGS_FAILED', error, { categoryIds: uniqueCategoryIds, payeeIds: uniquePayeeIds });
    }
  }

  /**
   * Bulk store multiple transactions
   * @param {Object[]} transactions - Array of transactions from Actual Budget
   * @returns {Promise<Object>} - Results with stored transactions and duplicates
   */
  async bulkStoreTransactions(transactions) {
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return { stored: [], duplicates: [], errors: [] };
    }

    const transactionData = transactions.map(t => this.formatTransactionForStorage(t));

    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.post('/transactions/bulk', { transactions: transactionData });
      });

      this.xanoStats.batchOperations++;
      
      const stored = result.data.stored || [];
      const duplicates = result.data.duplicates || [];
      const errors = result.data.errors || [];

      this.xanoStats.transactionsStored += stored.length;
      this.xanoStats.duplicatesSkipped += duplicates.length;

      this.logger.info(`Bulk stored ${stored.length} transactions, skipped ${duplicates.length} duplicates, ${errors.length} errors`);

      return { stored, duplicates, errors };
    } catch (error) {
      this.logger.error(`Failed to bulk store transactions: ${error.message}`);
      throw this.createXanoError('BULK_STORE_FAILED', error, { transactionCount: transactions.length });
    }
  }

  /**
   * Bulk update transaction mappings
   * @param {Object[]} updates - Array of mapping updates
   * @param {number} updates[].xano_id - Xano transaction ID
   * @param {string} updates[].xero_account_id - Xero account ID
   * @param {string} updates[].xero_contact_id - Xero contact ID
   * @returns {Promise<Object>} - Update results
   */
  async bulkUpdateTransactionMappings(updates) {
    if (!Array.isArray(updates) || updates.length === 0) {
      return { updated: [], errors: [] };
    }

    const updateData = updates.map(update => ({
      xano_id: update.xano_id,
      xero_account_id: update.xero_account_id || null,
      xero_contact_id: update.xero_contact_id || null,
      status: (update.xero_account_id && update.xero_contact_id) ? 'mapped' : 'pending'
    }));

    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.put('/transactions/bulk-mapping', { updates: updateData });
      });

      this.xanoStats.batchOperations++;

      const updated = result.data.updated || [];
      const errors = result.data.errors || [];

      this.xanoStats.transactionsStored += updated.length; // Track successful updates

      this.logger.info(`Bulk updated ${updated.length} transaction mappings, ${errors.length} errors`);

      return { updated, errors };
    } catch (error) {
      this.logger.error(`Failed to bulk update transaction mappings: ${error.message}`);
      throw this.createXanoError('BULK_MAPPING_UPDATE_FAILED', error, { updateCount: updates.length });
    }
  }

  /**
   * Bulk update transactions with Xero import results
   * @param {Object[]} xeroUpdates - Array of Xero import updates
   * @param {number} xeroUpdates[].xano_id - Xano transaction ID
   * @param {string} xeroUpdates[].xero_transaction_id - Xero transaction ID
   * @param {Date} xeroUpdates[].xero_imported_date - Import timestamp
   * @returns {Promise<Object>} - Update results
   */
  async bulkUpdateTransactionXeroImports(xeroUpdates) {
    if (!Array.isArray(xeroUpdates) || xeroUpdates.length === 0) {
      return { updated: [], errors: [] };
    }

    const updateData = xeroUpdates.map(update => ({
      xano_id: update.xano_id,
      xero_transaction_id: update.xero_transaction_id,
      xero_imported_date: update.xero_imported_date || new Date().toISOString(),
      status: 'imported'
    }));

    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.put('/transactions/bulk-xero-import', { updates: updateData });
      });

      this.xanoStats.batchOperations++;

      const updated = result.data.updated || [];
      const errors = result.data.errors || [];

      this.logger.info(`Bulk updated ${updated.length} transactions with Xero import data, ${errors.length} errors`);

      return { updated, errors };
    } catch (error) {
      this.logger.error(`Failed to bulk update Xero imports: ${error.message}`);
      throw this.createXanoError('BULK_XERO_UPDATE_FAILED', error, { updateCount: xeroUpdates.length });
    }
  }

  /**
   * Bulk mark transactions as failed
   * @param {Object[]} failures - Array of transaction failures
   * @param {number} failures[].xano_id - Xano transaction ID
   * @param {string} failures[].error_message - Error description
   * @returns {Promise<Object>} - Update results
   */
  async bulkMarkTransactionsFailed(failures) {
    if (!Array.isArray(failures) || failures.length === 0) {
      return { updated: [], errors: [] };
    }

    const updateData = failures.map(failure => ({
      xano_id: failure.xano_id,
      status: 'failed',
      error_message: failure.error_message
    }));

    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.put('/transactions/bulk-status', { updates: updateData });
      });

      this.xanoStats.batchOperations++;

      const updated = result.data.updated || [];
      const errors = result.data.errors || [];

      this.logger.warn(`Bulk marked ${updated.length} transactions as failed, ${errors.length} errors`);

      return { updated, errors };
    } catch (error) {
      this.logger.error(`Failed to bulk mark transactions as failed: ${error.message}`);
      throw this.createXanoError('BULK_FAILURE_UPDATE_FAILED', error, { updateCount: failures.length });
    }
  }

  /**
   * Get transactions ready for reprocessing (pending or failed with missing mappings)
   * @param {Object} options - Query options
   * @param {number} options.limit - Maximum number of transactions to return
   * @param {string[]} options.statuses - Transaction statuses to include
   * @returns {Promise<Object[]>} - Array of transactions ready for reprocessing
   */
  async getTransactionsForReprocessing(options = {}) {
    const queryParams = {
      limit: options.limit || 100,
      statuses: (options.statuses || ['pending', 'failed']).join(',')
    };

    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.get('/transactions/reprocess', { queryParams });
      });

      this.logger.debug(`Found ${result.data.length} transactions ready for reprocessing`);
      return result.data;
    } catch (error) {
      this.logger.error(`Failed to get transactions for reprocessing: ${error.message}`);
      throw this.createXanoError('REPROCESS_QUERY_FAILED', error, { options });
    }
  }

  /**
   * Reprocess failed transactions with updated mappings
   * @param {Object} options - Reprocessing options
   * @param {number} options.limit - Maximum number of transactions to reprocess
   * @param {boolean} options.autoResolve - Attempt to auto-resolve missing mappings
   * @returns {Promise<Object>} - Reprocessing results
   */
  async reprocessTransactions(options = {}) {
    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.post('/transactions/reprocess', {
          limit: options.limit || 50,
          auto_resolve: options.autoResolve || false
        });
      });

      this.xanoStats.batchOperations++;

      const summary = result.data;
      this.logger.info(`Reprocessing complete: ${summary.processed} processed, ${summary.resolved} resolved, ${summary.stillPending} still pending`);

      return summary;
    } catch (error) {
      this.logger.error(`Failed to reprocess transactions: ${error.message}`);
      throw this.createXanoError('REPROCESS_FAILED', error, { options });
    }
  }

  /**
   * Get transactions with missing mappings for manual review
   * @param {Object} options - Query options
   * @param {boolean} options.includeCategoryMissing - Include transactions with missing category mappings
   * @param {boolean} options.includePayeeMissing - Include transactions with missing payee mappings
   * @param {number} options.limit - Maximum number of transactions to return
   * @returns {Promise<Object>} - Transactions grouped by missing mapping type
   */
  async getTransactionsWithMissingMappings(options = {}) {
    const queryParams = {
      include_category_missing: options.includeCategoryMissing !== false,
      include_payee_missing: options.includePayeeMissing !== false,
      limit: options.limit || 100
    };

    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.get('/transactions/missing-mappings', { queryParams });
      });

      const data = result.data;
      this.logger.debug(`Found ${data.categoryMissing?.length || 0} transactions with missing category mappings, ${data.payeeMissing?.length || 0} with missing payee mappings`);

      return {
        categoryMissing: data.categoryMissing || [],
        payeeMissing: data.payeeMissing || [],
        bothMissing: data.bothMissing || []
      };
    } catch (error) {
      this.logger.error(`Failed to get transactions with missing mappings: ${error.message}`);
      throw this.createXanoError('MISSING_MAPPINGS_QUERY_FAILED', error, { options });
    }
  }

  /**
   * Get sync statistics and summary
   * @param {Object} options - Query options
   * @param {string} options.since - ISO date string to get stats since
   * @param {string} options.until - ISO date string to get stats until
   * @returns {Promise<Object>} - Sync statistics
   */
  async getSyncStatistics(options = {}) {
    const queryParams = {};
    
    if (options.since) {
      queryParams.since = options.since;
    }
    
    if (options.until) {
      queryParams.until = options.until;
    }

    try {
      const result = await this.rateLimiter.makeRequest(async () => {
        return await this.get('/transactions/statistics', { queryParams });
      });

      return result.data;
    } catch (error) {
      this.logger.error(`Failed to get sync statistics: ${error.message}`);
      throw this.createXanoError('STATISTICS_FAILED', error, { options });
    }
  }

  /**
   * Format transaction data for Xano storage
   * @param {Object} transaction - Raw transaction from Actual Budget
   * @returns {Object} - Formatted transaction data
   */
  formatTransactionForStorage(transaction) {
    return {
      actual_transaction_id: transaction.id,
      transaction_date: transaction.date,
      amount: transaction.amount / 100, // Convert from cents to dollars
      description: transaction.notes || transaction.imported_description || '',
      actual_category_id: transaction.category,
      actual_payee_id: transaction.payee,
      error_message: null // Optional field for error tracking
    };
  }

  /**
   * Create Xano-specific error with context
   * @param {string} code - Error code
   * @param {Error} originalError - Original error
   * @param {Object} context - Additional context
   * @returns {Error} - Xano error
   */
  createXanoError(code, originalError, context = {}) {
    const error = new Error(`Xano API Error [${code}]: ${originalError.message}`);
    error.name = 'XanoError';
    error.code = code;
    error.originalError = originalError;
    error.context = context;
    
    // Copy relevant properties from original error
    if (originalError.statusCode) error.statusCode = originalError.statusCode;
    if (originalError.response) error.response = originalError.response;
    
    return error;
  }

  /**
   * Get comprehensive client status including rate limiter stats
   * @returns {Object} - Client status and statistics
   */
  getStatus() {
    return {
      client: this.getStats(),
      rateLimiter: this.rateLimiter.getStatus(),
      xano: { ...this.xanoStats }
    };
  }

  /**
   * Reset all statistics
   */
  resetStats() {
    super.resetStats();
    this.rateLimiter.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitHits: 0,
      averageWaitTime: 0
    };
    this.xanoStats = {
      transactionsStored: 0,
      duplicatesSkipped: 0,
      mappingsRetrieved: 0,
      batchOperations: 0
    };
  }
}

module.exports = XanoClient;