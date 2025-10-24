const { Transaction, TransactionStatus } = require('../models/transaction');
const { CategoryMapping, PayeeMapping } = require('../models/mapping');
const ReprocessingService = require('./reprocessing');

/**
 * SyncService - Main orchestrator for the Actual Budget to Xero sync process
 * 
 * Handles the complete sync workflow:
 * 1. Fetch reconciled transactions from Actual Budget
 * 2. Store transactions in Xano with duplicate prevention
 * 3. Resolve category and payee mappings
 * 4. Import transactions to Xero
 * 5. Update status tracking throughout the pipeline
 */
class SyncService {
  constructor(options = {}) {
    this.actualClient = options.actualClient;
    this.xanoClient = options.xanoClient;
    this.xeroClient = options.xeroClient;
    this.logger = options.logger || console;
    this.config = options.config || {};

    // Initialize reprocessing service
    this.reprocessingService = new ReprocessingService({
      xanoClient: this.xanoClient,
      xeroClient: this.xeroClient,
      actualClient: this.actualClient,
      logger: this.logger,
      config: this.config
    });

    // Sync statistics
    this.stats = {
      transactionsFetched: 0,
      transactionsStored: 0,
      duplicatesSkipped: 0,
      transactionsMapped: 0,
      transactionsImported: 0,
      transactionsFailed: 0,
      mappingsResolved: 0,
      errors: []
    };

    // Validate required dependencies
    this.validateDependencies();
  }

  /**
   * Validate that all required service dependencies are provided
   * @throws {Error} If required dependencies are missing
   */
  validateDependencies() {
    if (!this.actualClient) {
      throw new Error('ActualBudgetClient is required');
    }
    if (!this.xanoClient) {
      throw new Error('XanoClient is required');
    }
    if (!this.xeroClient) {
      throw new Error('XeroClient is required');
    }
    if (!this.config.business_category_group_id && !this.config.business_category_group_name) {
      throw new Error('Either business_category_group_id or business_category_group_name must be configured');
    }
  }

  /**
   * Execute the complete sync process
   * @param {Object} options - Sync options
   * @param {Date} options.since - Date to sync transactions since (default: 7 days ago)
   * @param {number} options.batchSize - Number of transactions to process in each batch
   * @param {boolean} options.dryRun - If true, don't actually import to Xero
   * @returns {Promise<Object>} - Sync results and statistics
   */
  async executeSync(options = {}) {
    const startTime = Date.now();
    this.resetStats();

    try {
      this.logger.info('Starting Actual Budget to Xero sync process');

      // Set default options with safety controls
      const syncOptions = {
        since: options.since || new Date(Date.now() - (this.config.sync_days_back || 7) * 24 * 60 * 60 * 1000),
        batchSize: options.batchSize || this.config.batch_size || 10,
        dryRun: options.dryRun || this.config.dry_run_mode || false,
        testMode: this.config.test_mode || false,
        syncToXero: this.config.sync_to_xero !== false // Default to true unless explicitly disabled
      };

      this.logger.info(`Sync options: since=${syncOptions.since.toISOString()}, batchSize=${syncOptions.batchSize}, dryRun=${syncOptions.dryRun}, testMode=${syncOptions.testMode}, syncToXero=${syncOptions.syncToXero}`);

      // Step 1: Fetch reconciled transactions from Actual Budget
      const transactions = await this.fetchReconciledTransactions(syncOptions.since);
      
      if (transactions.length === 0) {
        this.logger.info('No new reconciled transactions found');
        return this.getSyncResults(startTime);
      }

      // Step 2: Store transactions in Xano (with duplicate prevention)
      const storedTransactions = await this.storeTransactionsInXano(transactions, syncOptions.batchSize);

      if (storedTransactions.length === 0) {
        this.logger.info('No new transactions to process (all were duplicates)');
        return this.getSyncResults(startTime);
      }

      // Step 3: Resolve mappings for categories and payees
      const mappedTransactions = await this.resolveMappings(storedTransactions);

      // Step 4: Import transactions to Xero (with safety controls)
      if (!syncOptions.dryRun && syncOptions.syncToXero) {
        await this.importTransactionsToXero(mappedTransactions, syncOptions.batchSize);
      } else if (!syncOptions.syncToXero) {
        this.logger.info(`Xero sync disabled: ${mappedTransactions.length} transactions stored in Xano only`);
      } else {
        this.logger.info(`Dry run mode: would have imported ${mappedTransactions.length} transactions to Xero`);
      }

      const results = this.getSyncResults(startTime);
      this.logger.info(`Sync completed successfully in ${results.duration}ms`);
      
      return results;

    } catch (error) {
      this.stats.errors.push({
        type: 'SYNC_EXECUTION_ERROR',
        message: error.message,
        timestamp: new Date().toISOString()
      });

      this.logger.error(`Sync process failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch reconciled transactions from Actual Budget for the business category group
   * @param {Date} since - Date to fetch transactions since
   * @returns {Promise<Array>} - Array of reconciled transactions
   */
  async fetchReconciledTransactions(since) {
    try {
      this.logger.info(`Fetching reconciled transactions since ${since.toISOString()}`);

      // Determine category group ID
      let categoryGroupId = this.config.business_category_group_id;
      
      if (!categoryGroupId && this.config.business_category_group_name) {
        this.logger.info(`Looking up category group by name: ${this.config.business_category_group_name}`);
        const categoryGroup = await this.actualClient.findCategoryGroupByName(this.config.business_category_group_name);
        
        if (!categoryGroup) {
          throw new Error(`Category group not found: ${this.config.business_category_group_name}`);
        }
        
        categoryGroupId = categoryGroup.id;
        this.logger.info(`Found category group ID: ${categoryGroupId}`);
      }

      // Fetch reconciled transactions
      const transactions = await this.actualClient.getReconciledTransactions(categoryGroupId, since);
      
      this.stats.transactionsFetched = transactions.length;
      this.logger.info(`Fetched ${transactions.length} reconciled transactions`);

      return transactions;

    } catch (error) {
      this.stats.errors.push({
        type: 'FETCH_TRANSACTIONS_ERROR',
        message: error.message,
        timestamp: new Date().toISOString()
      });

      this.logger.error(`Failed to fetch reconciled transactions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Store transactions in Xano with duplicate prevention
   * @param {Array} transactions - Transactions from Actual Budget
   * @param {number} batchSize - Batch size for processing
   * @returns {Promise<Array>} - Array of stored transactions with Xano IDs
   */
  async storeTransactionsInXano(transactions, batchSize) {
    try {
      this.logger.info(`Storing ${transactions.length} transactions in Xano`);

      const storedTransactions = [];
      const batches = this.createBatches(transactions, batchSize);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        this.logger.debug(`Processing batch ${i + 1}/${batches.length} (${batch.length} transactions)`);

        try {
          // Use bulk store operation for efficiency
          const result = await this.xanoClient.bulkStoreTransactions(batch);
          
          // Track statistics
          this.stats.transactionsStored += result.stored.length;
          this.stats.duplicatesSkipped += result.duplicates.length;

          // Add stored transactions to result array
          storedTransactions.push(...result.stored);

          // Log any errors from this batch
          if (result.errors.length > 0) {
            result.errors.forEach(error => {
              this.stats.errors.push({
                type: 'BATCH_STORE_ERROR',
                message: error.message,
                transaction_id: error.transaction_id,
                timestamp: new Date().toISOString()
              });
            });
          }

        } catch (error) {
          this.logger.error(`Failed to store batch ${i + 1}: ${error.message}`);
          
          // Try individual storage for this batch
          for (const transaction of batch) {
            try {
              const stored = await this.xanoClient.storeTransaction(transaction);
              storedTransactions.push(stored);
              this.stats.transactionsStored++;
            } catch (individualError) {
              this.stats.errors.push({
                type: 'INDIVIDUAL_STORE_ERROR',
                message: individualError.message,
                transaction_id: transaction.id,
                timestamp: new Date().toISOString()
              });
            }
          }
        }
      }

      this.logger.info(`Stored ${this.stats.transactionsStored} new transactions, skipped ${this.stats.duplicatesSkipped} duplicates`);
      
      // Tag stored transactions in Actual Budget
      await this.tagStoredTransactions(storedTransactions);

      return storedTransactions;

    } catch (error) {
      this.stats.errors.push({
        type: 'STORE_TRANSACTIONS_ERROR',
        message: error.message,
        timestamp: new Date().toISOString()
      });

      this.logger.error(`Failed to store transactions in Xano: ${error.message}`);
      throw error;
    }
  }

  /**
   * Tag stored transactions in Actual Budget with #xano tag
   * @param {Array} storedTransactions - Transactions that were stored in Xano
   */
  async tagStoredTransactions(storedTransactions) {
    try {
      this.logger.debug(`Tagging ${storedTransactions.length} transactions with #xano tag`);

      for (const transaction of storedTransactions) {
        try {
          await this.actualClient.addXanoTag(transaction.actual_transaction_id);
        } catch (error) {
          this.logger.warn(`Failed to tag transaction ${transaction.actual_transaction_id}: ${error.message}`);
          // Don't fail the entire sync for tagging errors
        }
      }

    } catch (error) {
      this.logger.warn(`Failed to tag stored transactions: ${error.message}`);
      // Don't fail the entire sync for tagging errors
    }
  }

  /**
   * Resolve category and payee mappings for transactions
   * @param {Array} transactions - Transactions from Xano
   * @returns {Promise<Array>} - Transactions with resolved mappings
   */
  async resolveMappings(transactions) {
    try {
      this.logger.info(`Resolving mappings for ${transactions.length} transactions`);

      // Extract unique category and payee IDs
      const categoryIds = [...new Set(transactions.map(t => t.actual_category_id).filter(id => id))];
      const payeeIds = [...new Set(transactions.map(t => t.actual_payee_id).filter(id => id))];

      this.logger.debug(`Found ${categoryIds.length} unique categories and ${payeeIds.length} unique payees`);

      // Batch retrieve existing mappings
      const mappings = await this.xanoClient.batchGetMappings(categoryIds, payeeIds);
      
      // Create lookup maps for efficient access
      const categoryMappingMap = new Map();
      mappings.categoryMappings.forEach(mapping => {
        categoryMappingMap.set(mapping.actual_category_id, mapping);
      });

      const payeeMappingMap = new Map();
      mappings.payeeMappings.forEach(mapping => {
        payeeMappingMap.set(mapping.actual_payee_id, mapping);
      });

      // Identify transactions with missing mappings for automatic resolution
      const transactionsNeedingResolution = [];
      const missingCategoryMappings = new Map();
      const missingPayeeMappings = new Map();

      for (const transaction of transactions) {
        const categoryMapping = categoryMappingMap.get(transaction.actual_category_id);
        const payeeMapping = payeeMappingMap.get(transaction.actual_payee_id);

        const hasValidCategoryMapping = categoryMapping && categoryMapping.xero_account_id;
        const hasValidPayeeMapping = payeeMapping && payeeMapping.xero_contact_id;

        if (!hasValidCategoryMapping || !hasValidPayeeMapping) {
          transactionsNeedingResolution.push(transaction);

          // Track missing category mappings
          if (!hasValidCategoryMapping && transaction.actual_category_id && transaction.actual_category_name) {
            missingCategoryMappings.set(transaction.actual_category_id, {
              actual_category_id: transaction.actual_category_id,
              actual_category_name: transaction.actual_category_name
            });
          }

          // Track missing payee mappings
          if (!hasValidPayeeMapping && transaction.actual_payee_id && transaction.actual_payee_name) {
            missingPayeeMappings.set(transaction.actual_payee_id, {
              actual_payee_id: transaction.actual_payee_id,
              actual_payee_name: transaction.actual_payee_name
            });
          }
        }
      }

      // Attempt automatic mapping resolution for missing mappings
      if (missingCategoryMappings.size > 0 || missingPayeeMappings.size > 0) {
        this.logger.info(`Attempting automatic resolution for ${missingCategoryMappings.size} categories and ${missingPayeeMappings.size} payees`);
        
        const resolutionResults = await this.attemptAutomaticMappingResolution(
          Array.from(missingCategoryMappings.values()),
          Array.from(missingPayeeMappings.values())
        );

        // Update mapping maps with newly resolved mappings
        resolutionResults.resolvedCategories.forEach(mapping => {
          categoryMappingMap.set(mapping.actual_category_id, mapping);
        });

        resolutionResults.resolvedPayees.forEach(mapping => {
          payeeMappingMap.set(mapping.actual_payee_id, mapping);
        });

        this.stats.mappingsResolved += resolutionResults.resolvedCategories.length + resolutionResults.resolvedPayees.length;
        
        this.logger.info(`Automatic resolution complete: ${resolutionResults.resolvedCategories.length} categories, ${resolutionResults.resolvedPayees.length} payees resolved`);
      }

      // Process transactions and resolve mappings
      const mappedTransactions = [];
      const mappingUpdates = [];

      for (const transaction of transactions) {
        const categoryMapping = categoryMappingMap.get(transaction.actual_category_id);
        const payeeMapping = payeeMappingMap.get(transaction.actual_payee_id);

        // Check if transaction has all required mappings
        const hasValidCategoryMapping = categoryMapping && categoryMapping.xero_account_id;
        const hasValidPayeeMapping = payeeMapping && payeeMapping.xero_contact_id;

        if (hasValidCategoryMapping && hasValidPayeeMapping) {
          // Transaction has all mappings, prepare for Xero import
          const mappingUpdate = {
            xano_id: transaction.id,
            xero_account_id: categoryMapping.xero_account_id,
            xero_contact_id: payeeMapping.xero_contact_id
          };

          mappingUpdates.push(mappingUpdate);
          
          // Add mapping info to transaction for Xero import
          transaction.xero_account_id = categoryMapping.xero_account_id;
          transaction.xero_contact_id = payeeMapping.xero_contact_id;
          transaction.xero_account_code = categoryMapping.xero_account_code;
          
          mappedTransactions.push(transaction);
          this.stats.transactionsMapped++;

        } else {
          // Transaction is still missing mappings after automatic resolution
          const missingMappings = [];
          if (!hasValidCategoryMapping) missingMappings.push('category');
          if (!hasValidPayeeMapping) missingMappings.push('payee');

          const errorMessage = `Missing ${missingMappings.join(' and ')} mapping(s) - automatic resolution failed`;
          
          try {
            await this.xanoClient.markTransactionFailed(transaction.id, errorMessage);
            this.stats.transactionsFailed++;
          } catch (error) {
            this.logger.warn(`Failed to mark transaction ${transaction.id} as failed: ${error.message}`);
          }

          this.stats.errors.push({
            type: 'MISSING_MAPPINGS',
            message: errorMessage,
            transaction_id: transaction.actual_transaction_id,
            xano_id: transaction.id,
            category_name: transaction.actual_category_name,
            payee_name: transaction.actual_payee_name,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Bulk update transaction mappings in Xano
      if (mappingUpdates.length > 0) {
        try {
          await this.xanoClient.bulkUpdateTransactionMappings(mappingUpdates);
          this.logger.info(`Updated mappings for ${mappingUpdates.length} transactions`);
        } catch (error) {
          this.logger.error(`Failed to bulk update transaction mappings: ${error.message}`);
          // Try individual updates as fallback
          for (const update of mappingUpdates) {
            try {
              await this.xanoClient.updateTransactionMapping(update.xano_id, {
                xero_account_id: update.xero_account_id,
                xero_contact_id: update.xero_contact_id
              });
            } catch (individualError) {
              this.logger.warn(`Failed to update mapping for transaction ${update.xano_id}: ${individualError.message}`);
            }
          }
        }
      }

      this.logger.info(`Resolved mappings for ${mappedTransactions.length} transactions, ${this.stats.transactionsFailed} failed due to missing mappings`);
      
      return mappedTransactions;

    } catch (error) {
      this.stats.errors.push({
        type: 'RESOLVE_MAPPINGS_ERROR',
        message: error.message,
        timestamp: new Date().toISOString()
      });

      this.logger.error(`Failed to resolve mappings: ${error.message}`);
      throw error;
    }
  }

  /**
   * Import transactions to Xero with comprehensive error handling
   * @param {Array} transactions - Transactions with resolved mappings
   * @param {number} batchSize - Batch size for processing
   * @returns {Promise<Object>} - Import results with detailed statistics
   */
  async importTransactionsToXero(transactions, batchSize) {
    try {
      this.logger.info(`Importing ${transactions.length} transactions to Xero`);

      // Pre-validate transactions before import
      const validation = await this.validateTransactionsForXeroImport(transactions);
      
      if (validation.blocked.length > 0) {
        this.logger.warn(`${validation.blocked.length} transactions are blocked due to missing mappings`);
        
        // Mark blocked transactions as failed
        await this.handleBlockedTransactions(validation.blocked);
      }

      if (validation.ready.length === 0) {
        this.logger.info('No transactions ready for Xero import');
        return {
          imported: 0,
          failed: validation.blocked.length,
          errors: validation.blocked.map(b => ({
            type: 'MISSING_MAPPINGS',
            transaction_id: b.transaction.actual_transaction_id,
            xano_id: b.transaction.id,
            message: `Missing ${b.missingCategory ? 'category' : ''} ${b.missingCategory && b.missingPayee ? 'and ' : ''}${b.missingPayee ? 'payee' : ''} mapping(s)`
          }))
        };
      }

      // Process ready transactions in batches
      const batches = this.createBatches(validation.ready, batchSize);
      const importResults = {
        imported: 0,
        failed: 0,
        errors: [],
        xeroUpdates: []
      };

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        this.logger.debug(`Processing Xero import batch ${i + 1}/${batches.length} (${batch.length} transactions)`);

        const batchResults = await this.processBatchXeroImport(batch);
        
        importResults.imported += batchResults.imported;
        importResults.failed += batchResults.failed;
        importResults.errors.push(...batchResults.errors);
        importResults.xeroUpdates.push(...batchResults.xeroUpdates);
      }

      // Bulk update Xano with Xero import results
      if (importResults.xeroUpdates.length > 0) {
        await this.updateXanoWithXeroResults(importResults.xeroUpdates);
      }

      // Update statistics
      this.stats.transactionsImported += importResults.imported;
      this.stats.transactionsFailed += importResults.failed + validation.blocked.length;
      this.stats.errors.push(...importResults.errors);

      this.logger.info(`Xero import complete: ${importResults.imported} imported, ${importResults.failed + validation.blocked.length} failed`);

      return {
        imported: importResults.imported,
        failed: importResults.failed + validation.blocked.length,
        errors: importResults.errors
      };

    } catch (error) {
      this.stats.errors.push({
        type: 'IMPORT_TRANSACTIONS_ERROR',
        message: error.message,
        timestamp: new Date().toISOString()
      });

      this.logger.error(`Failed to import transactions to Xero: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process a batch of transactions for Xero import
   * @param {Array} batch - Batch of transactions to import
   * @returns {Promise<Object>} - Batch import results
   */
  async processBatchXeroImport(batch) {
    const results = {
      imported: 0,
      failed: 0,
      errors: [],
      xeroUpdates: []
    };

    for (const transaction of batch) {
      try {
        // Generate Xero reference using Xano ID
        const xeroReference = this.generateXeroReference(transaction.id);
        
        // Format transaction for Xero with comprehensive validation
        const xeroTransactionData = await this.formatTransactionForXero(transaction, xeroReference);

        // Validate Xero transaction data before sending
        const validationResult = this.validateXeroTransactionData(xeroTransactionData);
        if (!validationResult.isValid) {
          throw new Error(`Transaction validation failed: ${validationResult.errors.join(', ')}`);
        }

        // Create transaction in Xero with retry logic
        const xeroResult = await this.createXeroTransactionWithRetry(xeroTransactionData, transaction);

        // Prepare update for Xano
        results.xeroUpdates.push({
          xano_id: transaction.id,
          xero_transaction_id: xeroResult.xero_transaction_id,
          xero_imported_date: new Date().toISOString(),
          xero_reference: xeroReference,
          xero_status: xeroResult.xero_status || 'AUTHORISED'
        });

        results.imported++;

        // Tag transaction in Actual Budget
        await this.tagTransactionAsImported(transaction.actual_transaction_id);

        this.logger.debug(`Successfully imported transaction ${transaction.id} to Xero: ${xeroResult.xero_transaction_id}`);

      } catch (error) {
        results.failed++;
        
        const errorDetails = {
          type: 'XERO_IMPORT_ERROR',
          message: error.message,
          transaction_id: transaction.actual_transaction_id,
          xano_id: transaction.id,
          timestamp: new Date().toISOString(),
          xero_reference: this.generateXeroReference(transaction.id)
        };

        results.errors.push(errorDetails);

        // Mark transaction as failed in Xano
        await this.markTransactionAsFailed(transaction.id, `Xero import failed: ${error.message}`);

        this.logger.error(`Failed to import transaction ${transaction.id} to Xero: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Generate Xero reference using Xano table ID
   * @param {number} xanoId - Xano transaction ID
   * @returns {string} - Xero reference in format "Xano-{ID}"
   */
  generateXeroReference(xanoId) {
    if (!xanoId || typeof xanoId !== 'number') {
      throw new Error('Valid Xano ID is required to generate Xero reference');
    }
    return `Xano-${xanoId}`;
  }

  /**
   * Format transaction for Xero API with comprehensive validation
   * @param {Object} transaction - Transaction from Xano
   * @param {string} xeroReference - Xero reference
   * @returns {Promise<Object>} - Xero-formatted transaction
   */
  async formatTransactionForXero(transaction, xeroReference) {
    try {
      // Validate required fields
      if (!transaction.xero_account_id) {
        throw new Error('Xero account ID is required');
      }
      if (!transaction.xero_contact_id) {
        throw new Error('Xero contact ID is required');
      }
      if (!transaction.amount || transaction.amount === 0) {
        throw new Error('Transaction amount must be non-zero');
      }

      // Format date for Xero (YYYY-MM-DD)
      const transactionDate = new Date(transaction.transaction_date);
      if (isNaN(transactionDate.getTime())) {
        throw new Error('Invalid transaction date');
      }
      const formattedDate = transactionDate.toISOString().split('T')[0];

      // Determine transaction type and amount
      const isSpend = transaction.amount < 0;
      const absoluteAmount = Math.abs(transaction.amount);

      // Validate amount is reasonable
      if (absoluteAmount > 1000000) {
        this.logger.warn(`Large transaction amount detected: ${absoluteAmount} for transaction ${transaction.id}`);
      }

      // Format description with fallback
      const description = transaction.description || 
                         `Transaction from Actual Budget (${transaction.actual_transaction_id})`;

      // Build Xero transaction object
      const xeroTransaction = {
        Type: isSpend ? 'SPEND' : 'RECEIVE',
        Contact: {
          ContactID: transaction.xero_contact_id
        },
        Date: formattedDate,
        Reference: xeroReference,
        Status: 'AUTHORISED', // Automatically authorize the transaction
        LineItems: [{
          Description: description.substring(0, 4000), // Xero has a 4000 character limit
          Quantity: 1,
          UnitAmount: absoluteAmount,
          AccountID: transaction.xero_account_id,
          TaxType: 'NONE' // Default tax type, can be configured
        }]
      };

      // Add account code if available
      if (transaction.xero_account_code) {
        xeroTransaction.LineItems[0].AccountCode = transaction.xero_account_code;
      }

      return xeroTransaction;

    } catch (error) {
      this.logger.error(`Failed to format transaction ${transaction.id} for Xero: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validate Xero transaction data before sending to API
   * @param {Object} xeroTransaction - Formatted Xero transaction
   * @returns {Object} - Validation result
   */
  validateXeroTransactionData(xeroTransaction) {
    const errors = [];

    // Required fields validation
    if (!xeroTransaction.Type || !['SPEND', 'RECEIVE'].includes(xeroTransaction.Type)) {
      errors.push('Transaction type must be SPEND or RECEIVE');
    }

    if (!xeroTransaction.Contact?.ContactID) {
      errors.push('Contact ID is required');
    }

    if (!xeroTransaction.Date || !/^\d{4}-\d{2}-\d{2}$/.test(xeroTransaction.Date)) {
      errors.push('Date must be in YYYY-MM-DD format');
    }

    if (!xeroTransaction.Reference || xeroTransaction.Reference.length > 255) {
      errors.push('Reference is required and must be 255 characters or less');
    }

    // Line items validation
    if (!xeroTransaction.LineItems || xeroTransaction.LineItems.length === 0) {
      errors.push('At least one line item is required');
    } else {
      const lineItem = xeroTransaction.LineItems[0];
      
      if (!lineItem.AccountID) {
        errors.push('Account ID is required for line item');
      }

      if (!lineItem.UnitAmount || lineItem.UnitAmount <= 0) {
        errors.push('Unit amount must be greater than zero');
      }

      if (lineItem.UnitAmount > 999999999.99) {
        errors.push('Unit amount exceeds maximum allowed value');
      }

      if (!lineItem.Description || lineItem.Description.trim().length === 0) {
        errors.push('Description is required for line item');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Create transaction in Xero with retry logic for transient failures
   * @param {Object} xeroTransactionData - Formatted Xero transaction
   * @param {Object} originalTransaction - Original transaction for context
   * @returns {Promise<Object>} - Xero creation result
   */
  async createXeroTransactionWithRetry(xeroTransactionData, originalTransaction) {
    const maxRetries = 3;
    const baseDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.debug(`Creating Xero transaction (attempt ${attempt}/${maxRetries}): ${xeroTransactionData.Reference}`);

        const result = await this.xeroClient.createTransaction({
          ...xeroTransactionData,
          xano_id: originalTransaction.id // Include for reference generation
        });

        this.logger.debug(`Successfully created Xero transaction: ${result.xero_transaction_id}`);
        return result;

      } catch (error) {
        const isLastAttempt = attempt === maxRetries;
        const isRetryableError = this.isRetryableXeroError(error);

        if (isLastAttempt || !isRetryableError) {
          // Log detailed error information
          this.logger.error(`Failed to create Xero transaction after ${attempt} attempts: ${error.message}`, {
            transaction_id: originalTransaction.actual_transaction_id,
            xano_id: originalTransaction.id,
            xero_reference: xeroTransactionData.Reference,
            error_code: error.code,
            error_status: error.statusCode
          });

          throw error;
        }

        // Wait before retry with exponential backoff
        const delay = baseDelay * Math.pow(2, attempt - 1);
        this.logger.warn(`Xero transaction creation failed (attempt ${attempt}), retrying in ${delay}ms: ${error.message}`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Reprocess failed transactions with updated mappings
   * @param {Object} options - Reprocessing options
   * @param {number} options.limit - Maximum number of transactions to reprocess (default: 50)
   * @param {boolean} options.autoResolve - Attempt to auto-resolve missing mappings (default: true)
   * @param {string[]} options.statuses - Transaction statuses to reprocess (default: ['pending', 'failed'])
   * @param {boolean} options.dryRun - If true, don't actually import to Xero (default: false)
   * @param {boolean} options.importToXero - Import successfully mapped transactions to Xero (default: true)
   * @returns {Promise<Object>} - Reprocessing results and summary
   */
  async reprocessFailedTransactions(options = {}) {
    try {
      this.logger.info('Delegating transaction reprocessing to ReprocessingService');
      
      // Use the dedicated reprocessing service for comprehensive reprocessing
      const result = await this.reprocessingService.reprocessFailedTransactions(options);
      
      // Update sync service statistics with reprocessing results
      this.stats.transactionsMapped += result.statistics.transactionsResolved;
      this.stats.transactionsImported += result.statistics.transactionsImported;
      this.stats.transactionsFailed += result.statistics.transactionsFailed;
      this.stats.mappingsResolved += result.statistics.mappingsResolved;
      this.stats.errors.push(...result.errors);
      
      return result;
      
    } catch (error) {
      this.logger.error(`Reprocessing failed: ${error.message}`);
      throw error;
    }
  }



  /**
   * Find and retry failed Xero imports with updated mappings
   * @param {Object} options - Retry options
   * @param {number} options.limit - Maximum number of transactions to retry (default: 25)
   * @param {number} options.maxAge - Maximum age in hours for failed transactions to retry (default: 24)
   * @param {boolean} options.dryRun - If true, don't actually import to Xero (default: false)
   * @returns {Promise<Object>} - Retry results and summary
   */
  async retryFailedImports(options = {}) {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting failed import retry process');

      const retryOptions = {
        limit: options.limit || 25,
        maxAge: options.maxAge || 24,
        dryRun: options.dryRun || false
      };

      // Calculate cutoff date for failed transactions
      const cutoffDate = new Date(Date.now() - (retryOptions.maxAge * 60 * 60 * 1000));

      // Get failed transactions that are ready for retry
      const failedTransactions = await this.xanoClient.getTransactionsForReprocessing({
        limit: retryOptions.limit,
        statuses: ['failed'],
        since: cutoffDate.toISOString()
      });

      if (failedTransactions.length === 0) {
        this.logger.info('No failed transactions found for retry');
        return {
          processed: 0,
          retried: 0,
          imported: 0,
          stillFailed: 0,
          errors: [],
          duration: Date.now() - startTime
        };
      }

      this.logger.info(`Found ${failedTransactions.length} failed transactions for retry`);

      // Filter transactions that have valid mappings now
      const transactionsWithMappings = failedTransactions.filter(t => 
        t.xero_account_id && t.xero_contact_id
      );

      if (transactionsWithMappings.length === 0) {
        this.logger.info('No failed transactions have valid mappings for retry');
        return {
          processed: failedTransactions.length,
          retried: 0,
          imported: 0,
          stillFailed: failedTransactions.length,
          errors: [{
            type: 'NO_VALID_MAPPINGS',
            message: 'All failed transactions still lack required mappings',
            timestamp: new Date().toISOString()
          }],
          duration: Date.now() - startTime
        };
      }

      // Reset transaction status to 'mapped' for retry
      const resetUpdates = transactionsWithMappings.map(t => ({
        xano_id: t.id,
        status: 'mapped',
        error_message: null
      }));

      await this.xanoClient.bulkMarkTransactionsFailed(resetUpdates.map(u => ({
        xano_id: u.xano_id,
        error_message: null // Clear error message
      })));

      // Update status to mapped
      for (const update of resetUpdates) {
        await this.xanoClient.updateTransactionMapping(update.xano_id, {
          xero_account_id: transactionsWithMappings.find(t => t.id === update.xano_id).xero_account_id,
          xero_contact_id: transactionsWithMappings.find(t => t.id === update.xano_id).xero_contact_id
        });
      }

      // Attempt Xero import for transactions with mappings
      let importResults = { imported: 0, failed: 0, errors: [] };
      
      if (!retryOptions.dryRun) {
        importResults = await this.importTransactionsToXero(transactionsWithMappings, 10);
      } else {
        this.logger.info(`Dry run mode: would have retried ${transactionsWithMappings.length} failed transactions`);
      }

      const summary = {
        processed: failedTransactions.length,
        retried: transactionsWithMappings.length,
        imported: importResults.imported,
        stillFailed: failedTransactions.length - transactionsWithMappings.length + importResults.failed,
        errors: importResults.errors,
        duration: Date.now() - startTime,
        details: {
          maxAge: retryOptions.maxAge,
          cutoffDate: cutoffDate.toISOString(),
          dryRun: retryOptions.dryRun
        }
      };

      this.logger.info(`Failed import retry complete: ${summary.retried} retried, ${summary.imported} imported, ${summary.stillFailed} still failed in ${summary.duration}ms`);

      return summary;

    } catch (error) {
      this.logger.error(`Failed import retry process failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate comprehensive reprocessing summary report
   * @param {Object} options - Report options
   * @param {string} options.since - ISO date string to get report since (default: 7 days ago)
   * @param {boolean} options.includeDetails - Include detailed transaction information (default: false)
   * @returns {Promise<Object>} - Comprehensive reprocessing report
   */
  async generateReprocessingReport(options = {}) {
    try {
      const reportOptions = {
        since: options.since || new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString(),
        includeDetails: options.includeDetails || false
      };

      this.logger.info(`Generating reprocessing report since ${reportOptions.since}`);

      // Get sync statistics
      const syncStats = await this.xanoClient.getSyncStatistics({
        since: reportOptions.since
      });

      // Get transactions with missing mappings
      const missingMappings = await this.xanoClient.getTransactionsWithMissingMappings({
        limit: 200
      });

      // Get failed transactions for analysis
      const failedTransactions = await this.xanoClient.getTransactionsForReprocessing({
        limit: 100,
        statuses: ['failed']
      });

      // Analyze error patterns
      const errorAnalysis = this.analyzeReprocessingErrors(failedTransactions);

      const report = {
        reportGenerated: new Date().toISOString(),
        reportPeriod: {
          since: reportOptions.since,
          until: new Date().toISOString()
        },
        summary: {
          totalTransactions: syncStats.totalTransactions || 0,
          successfullyImported: syncStats.importedTransactions || 0,
          pendingTransactions: syncStats.pendingTransactions || 0,
          failedTransactions: syncStats.failedTransactions || 0,
          successRate: syncStats.totalTransactions > 0 ? 
            ((syncStats.importedTransactions || 0) / syncStats.totalTransactions * 100).toFixed(2) + '%' : '0%'
        },
        missingMappings: {
          categoriesNeedingMapping: missingMappings.categoryMissing.length,
          payeesNeedingMapping: missingMappings.payeeMissing.length,
          transactionsBlockedByMissingCategories: missingMappings.categoryMissing.length,
          transactionsBlockedByMissingPayees: missingMappings.payeeMissing.length,
          transactionsMissingBothMappings: missingMappings.bothMissing.length
        },
        errorAnalysis,
        recommendations: this.generateReprocessingRecommendations(syncStats, missingMappings, errorAnalysis)
      };

      // Include detailed information if requested
      if (reportOptions.includeDetails) {
        report.details = {
          missingCategoryMappings: missingMappings.categoryMissing.map(t => ({
            categoryId: t.actual_category_id,
            categoryName: t.actual_category_name,
            transactionCount: 1 // This would need to be aggregated in a real implementation
          })),
          missingPayeeMappings: missingMappings.payeeMissing.map(t => ({
            payeeId: t.actual_payee_id,
            payeeName: t.actual_payee_name,
            transactionCount: 1 // This would need to be aggregated in a real implementation
          })),
          recentFailures: failedTransactions.slice(0, 10).map(t => ({
            transactionId: t.actual_transaction_id,
            xanoId: t.id,
            errorMessage: t.error_message,
            failedDate: t.updated_date || t.created_date
          }))
        };
      }

      this.logger.info(`Reprocessing report generated: ${report.summary.successRate} success rate, ${report.missingMappings.categoriesNeedingMapping} categories need mapping`);

      return report;

    } catch (error) {
      this.logger.error(`Failed to generate reprocessing report: ${error.message}`);
      throw error;
    }
  }

  /**
   * Analyze error patterns in failed transactions
   * @param {Array} failedTransactions - Array of failed transactions
   * @returns {Object} - Error analysis results
   */
  analyzeReprocessingErrors(failedTransactions) {
    const errorPatterns = new Map();
    const errorTypes = new Map();
    
    failedTransactions.forEach(transaction => {
      if (transaction.error_message) {
        // Count error types
        const errorType = this.categorizeError(transaction.error_message);
        errorTypes.set(errorType, (errorTypes.get(errorType) || 0) + 1);
        
        // Count specific error messages
        const errorKey = transaction.error_message.substring(0, 100); // First 100 chars
        errorPatterns.set(errorKey, (errorPatterns.get(errorKey) || 0) + 1);
      }
    });

    return {
      totalFailedTransactions: failedTransactions.length,
      errorTypes: Object.fromEntries(errorTypes),
      commonErrorPatterns: Object.fromEntries(
        Array.from(errorPatterns.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5) // Top 5 most common errors
      ),
      oldestFailure: failedTransactions.length > 0 ? 
        Math.min(...failedTransactions.map(t => new Date(t.created_date).getTime())) : null,
      newestFailure: failedTransactions.length > 0 ? 
        Math.max(...failedTransactions.map(t => new Date(t.created_date).getTime())) : null
    };
  }

  /**
   * Categorize error message into error type
   * @param {string} errorMessage - Error message to categorize
   * @returns {string} - Error category
   */
  categorizeError(errorMessage) {
    const message = errorMessage.toLowerCase();
    
    if (message.includes('missing') && (message.includes('category') || message.includes('payee'))) {
      return 'MISSING_MAPPINGS';
    } else if (message.includes('xero') && (message.includes('api') || message.includes('import'))) {
      return 'XERO_API_ERROR';
    } else if (message.includes('validation') || message.includes('invalid')) {
      return 'VALIDATION_ERROR';
    } else if (message.includes('network') || message.includes('timeout') || message.includes('connection')) {
      return 'NETWORK_ERROR';
    } else if (message.includes('rate limit') || message.includes('429')) {
      return 'RATE_LIMIT_ERROR';
    } else {
      return 'OTHER_ERROR';
    }
  }

  /**
   * Generate actionable recommendations based on reprocessing analysis
   * @param {Object} syncStats - Sync statistics
   * @param {Object} missingMappings - Missing mappings data
   * @param {Object} errorAnalysis - Error analysis results
   * @returns {Array} - Array of recommendation objects
   */
  generateReprocessingRecommendations(syncStats, missingMappings, errorAnalysis) {
    const recommendations = [];

    // Missing mappings recommendations
    if (missingMappings.categoriesNeedingMapping > 0) {
      recommendations.push({
        type: 'MISSING_CATEGORY_MAPPINGS',
        priority: 'HIGH',
        message: `${missingMappings.categoriesNeedingMapping} categories need Xero account mappings`,
        action: 'Review and update category mappings in Xano',
        impact: `${missingMappings.transactionsBlockedByMissingCategories} transactions are blocked`
      });
    }

    if (missingMappings.payeesNeedingMapping > 0) {
      recommendations.push({
        type: 'MISSING_PAYEE_MAPPINGS',
        priority: 'HIGH',
        message: `${missingMappings.payeesNeedingMapping} payees need Xero contact mappings`,
        action: 'Review and update payee mappings in Xano',
        impact: `${missingMappings.transactionsBlockedByMissingPayees} transactions are blocked`
      });
    }

    // Error pattern recommendations
    if (errorAnalysis.errorTypes.XERO_API_ERROR > 5) {
      recommendations.push({
        type: 'XERO_API_ISSUES',
        priority: 'MEDIUM',
        message: `${errorAnalysis.errorTypes.XERO_API_ERROR} transactions failed due to Xero API errors`,
        action: 'Check Xero API credentials and connection status',
        impact: 'Transactions may need to be retried after fixing API issues'
      });
    }

    if (errorAnalysis.errorTypes.RATE_LIMIT_ERROR > 0) {
      recommendations.push({
        type: 'RATE_LIMITING',
        priority: 'LOW',
        message: `${errorAnalysis.errorTypes.RATE_LIMIT_ERROR} transactions failed due to rate limiting`,
        action: 'Consider reducing batch sizes or increasing delays between API calls',
        impact: 'Sync performance may be impacted'
      });
    }

    // Success rate recommendations
    const successRate = syncStats.totalTransactions > 0 ? 
      (syncStats.importedTransactions / syncStats.totalTransactions) : 0;

    if (successRate < 0.8) {
      recommendations.push({
        type: 'LOW_SUCCESS_RATE',
        priority: 'HIGH',
        message: `Success rate is ${(successRate * 100).toFixed(1)}% (below 80% threshold)`,
        action: 'Review and resolve mapping issues, check API connectivity',
        impact: 'Many transactions are not being synchronized to Xero'
      });
    }

    // Reprocessing recommendations
    if (syncStats.pendingTransactions > 10) {
      recommendations.push({
        type: 'PENDING_TRANSACTIONS',
        priority: 'MEDIUM',
        message: `${syncStats.pendingTransactions} transactions are pending processing`,
        action: 'Run reprocessing to attempt resolution of pending transactions',
        impact: 'Pending transactions will not appear in Xero until processed'
      });
    }

    return recommendations;
  }

  /**
   * Determine if a Xero error is retryable
   * @param {Error} error - Error from Xero API
   * @returns {boolean} - True if error is retryable
   */
  isRetryableXeroError(error) {
    // Retry on network errors, timeouts, and certain HTTP status codes
    const retryableStatusCodes = [429, 500, 502, 503, 504]; // Rate limit, server errors
    const retryableErrorCodes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'];

    if (error.statusCode && retryableStatusCodes.includes(error.statusCode)) {
      return true;
    }

    if (error.code && retryableErrorCodes.includes(error.code)) {
      return true;
    }

    // Check for specific Xero error messages that indicate transient issues
    const retryableMessages = [
      'timeout',
      'connection reset',
      'temporary failure',
      'service unavailable'
    ];

    const errorMessage = error.message.toLowerCase();
    return retryableMessages.some(msg => errorMessage.includes(msg));
  }

  /**
   * Handle transactions blocked due to missing mappings
   * @param {Array} blockedTransactions - Transactions with missing mappings
   */
  async handleBlockedTransactions(blockedTransactions) {
    const failures = [];

    for (const blocked of blockedTransactions) {
      const missingMappings = [];
      if (blocked.missingCategory) missingMappings.push('category');
      if (blocked.missingPayee) missingMappings.push('payee');

      const errorMessage = `Missing ${missingMappings.join(' and ')} mapping(s)`;
      
      failures.push({
        xano_id: blocked.transaction.id,
        error_message: errorMessage
      });

      this.stats.errors.push({
        type: 'MISSING_MAPPINGS',
        message: errorMessage,
        transaction_id: blocked.transaction.actual_transaction_id,
        xano_id: blocked.transaction.id,
        timestamp: new Date().toISOString()
      });
    }

    // Bulk mark transactions as failed
    if (failures.length > 0) {
      try {
        await this.xanoClient.bulkMarkTransactionsFailed(failures);
        this.logger.info(`Marked ${failures.length} transactions as failed due to missing mappings`);
      } catch (error) {
        this.logger.error(`Failed to bulk mark transactions as failed: ${error.message}`);
        
        // Try individual updates as fallback
        for (const failure of failures) {
          try {
            await this.xanoClient.markTransactionFailed(failure.xano_id, failure.error_message);
          } catch (individualError) {
            this.logger.warn(`Failed to mark transaction ${failure.xano_id} as failed: ${individualError.message}`);
          }
        }
      }
    }
  }

  /**
   * Update Xano with Xero import results
   * @param {Array} xeroUpdates - Array of Xero import updates
   */
  async updateXanoWithXeroResults(xeroUpdates) {
    try {
      await this.xanoClient.bulkUpdateTransactionXeroImports(xeroUpdates);
      this.logger.info(`Updated ${xeroUpdates.length} transactions with Xero import data`);
    } catch (error) {
      this.logger.error(`Failed to bulk update Xero import data: ${error.message}`);
      
      // Try individual updates as fallback
      for (const update of xeroUpdates) {
        try {
          await this.xanoClient.updateTransactionXeroImport(update.xano_id, {
            xero_transaction_id: update.xero_transaction_id,
            xero_imported_date: update.xero_imported_date
          });
        } catch (individualError) {
          this.logger.warn(`Failed to update Xero import data for transaction ${update.xano_id}: ${individualError.message}`);
        }
      }
    }
  }

  /**
   * Tag transaction in Actual Budget as imported to Xero
   * @param {string} actualTransactionId - Actual Budget transaction ID
   */
  async tagTransactionAsImported(actualTransactionId) {
    try {
      await this.actualClient.addXeroTag(actualTransactionId);
    } catch (error) {
      this.logger.warn(`Failed to tag transaction ${actualTransactionId} with #xero: ${error.message}`);
      // Don't fail the import for tagging errors
    }
  }

  /**
   * Mark transaction as failed in Xano
   * @param {number} xanoId - Xano transaction ID
   * @param {string} errorMessage - Error message
   */
  async markTransactionAsFailed(xanoId, errorMessage) {
    try {
      await this.xanoClient.markTransactionFailed(xanoId, errorMessage);
    } catch (error) {
      this.logger.warn(`Failed to mark transaction ${xanoId} as failed: ${error.message}`);
      // Don't fail the import for status update errors
    }
  }

  /**
   * Create batches from an array of items
   * @param {Array} items - Items to batch
   * @param {number} batchSize - Size of each batch
   * @returns {Array<Array>} - Array of batches
   */
  createBatches(items, batchSize) {
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Reset sync statistics
   */
  resetStats() {
    this.stats = {
      transactionsFetched: 0,
      transactionsStored: 0,
      duplicatesSkipped: 0,
      transactionsMapped: 0,
      transactionsImported: 0,
      transactionsFailed: 0,
      mappingsResolved: 0,
      errors: []
    };
  }

  /**
   * Get sync results with statistics
   * @param {number} startTime - Sync start time in milliseconds
   * @returns {Object} - Sync results
   */
  getSyncResults(startTime) {
    const endTime = Date.now();
    const duration = endTime - startTime;

    return {
      success: this.stats.errors.filter(e => e.type !== 'MISSING_MAPPINGS').length === 0,
      duration,
      statistics: {
        transactionsFetched: this.stats.transactionsFetched,
        transactionsStored: this.stats.transactionsStored,
        duplicatesSkipped: this.stats.duplicatesSkipped,
        transactionsMapped: this.stats.transactionsMapped,
        transactionsImported: this.stats.transactionsImported,
        transactionsFailed: this.stats.transactionsFailed,
        totalErrors: this.stats.errors.length,
        mappingErrors: this.stats.errors.filter(e => e.type === 'MISSING_MAPPINGS').length
      },
      errors: this.stats.errors,
      summary: this.generateSyncSummary()
    };
  }

  /**
   * Generate human-readable sync summary
   * @returns {string} - Sync summary
   */
  generateSyncSummary() {
    const lines = [];
    
    lines.push(`Sync Summary:`);
    lines.push(`- Fetched ${this.stats.transactionsFetched} reconciled transactions`);
    lines.push(`- Stored ${this.stats.transactionsStored} new transactions (${this.stats.duplicatesSkipped} duplicates skipped)`);
    lines.push(`- Mapped ${this.stats.transactionsMapped} transactions with valid mappings`);
    lines.push(`- Imported ${this.stats.transactionsImported} transactions to Xero`);
    
    if (this.stats.transactionsFailed > 0) {
      lines.push(`- Failed ${this.stats.transactionsFailed} transactions (see errors for details)`);
    }
    
    if (this.stats.errors.length > 0) {
      const mappingErrors = this.stats.errors.filter(e => e.type === 'MISSING_MAPPINGS').length;
      const otherErrors = this.stats.errors.length - mappingErrors;
      
      if (mappingErrors > 0) {
        lines.push(`- ${mappingErrors} transactions skipped due to missing mappings`);
      }
      
      if (otherErrors > 0) {
        lines.push(`- ${otherErrors} other errors occurred during sync`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Attempt automatic mapping resolution by searching Xero for missing mappings
   * @param {Array} missingCategories - Categories needing resolution
   * @param {Array} missingPayees - Payees needing resolution
   * @returns {Promise<Object>} - Resolution results with resolved mappings
   */
  async attemptAutomaticMappingResolution(missingCategories, missingPayees) {
    try {
      this.logger.debug(`Attempting automatic resolution for ${missingCategories.length} categories and ${missingPayees.length} payees`);

      const results = {
        resolvedCategories: [],
        resolvedPayees: [],
        failedCategories: [],
        failedPayees: []
      };

      // Resolve category mappings by searching Xero
      for (const categoryData of missingCategories) {
        try {
          this.logger.debug(`Searching Xero for category: ${categoryData.actual_category_name}`);

          // Search for matching account in Xero with fuzzy matching
          const matchingAccounts = await this.xeroClient.searchAccounts(categoryData.actual_category_name, {
            type: 'EXPENSE',
            includeArchived: false,
            limit: 5
          });

          if (matchingAccounts.length > 0) {
            // Use the best match (first result from search)
            const bestMatch = matchingAccounts[0];
            
            // Create mapping in Xano
            const mappingData = {
              actual_category_id: categoryData.actual_category_id,
              actual_category_name: categoryData.actual_category_name,
              xero_account_id: bestMatch.xero_account_id,
              xero_account_name: bestMatch.name,
              xero_account_code: bestMatch.code,
              is_active: true
            };

            const createdMapping = await this.xanoClient.upsertCategoryMapping(mappingData);
            results.resolvedCategories.push(createdMapping);

            this.logger.info(`Auto-resolved category mapping: "${categoryData.actual_category_name}" -> "${bestMatch.name}" (${bestMatch.xero_account_id})`);

          } else {
            // No matches found, attempt to create new account if enabled
            if (this.config.auto_create_missing_entities !== false) {
              try {
                const newAccount = await this.xeroClient.createAccount({
                  name: categoryData.actual_category_name,
                  type: 'EXPENSE',
                  code: this.generateAccountCode(categoryData.actual_category_name)
                });

                // Create mapping with new account
                const mappingData = {
                  actual_category_id: categoryData.actual_category_id,
                  actual_category_name: categoryData.actual_category_name,
                  xero_account_id: newAccount.xero_account_id,
                  xero_account_name: newAccount.name,
                  xero_account_code: newAccount.code,
                  is_active: true
                };

                const createdMapping = await this.xanoClient.upsertCategoryMapping(mappingData);
                results.resolvedCategories.push(createdMapping);

                this.logger.info(`Auto-created and mapped category: "${categoryData.actual_category_name}" -> "${newAccount.name}" (${newAccount.xero_account_id})`);

              } catch (createError) {
                this.logger.warn(`Failed to create account for category "${categoryData.actual_category_name}": ${createError.message}`);
                results.failedCategories.push({
                  category: categoryData,
                  reason: `Account creation failed: ${createError.message}`
                });
              }
            } else {
              this.logger.debug(`No match found for category "${categoryData.actual_category_name}" and auto-create is disabled`);
              results.failedCategories.push({
                category: categoryData,
                reason: 'No match found and auto-create disabled'
              });
            }
          }

        } catch (error) {
          this.logger.error(`Error resolving category mapping for "${categoryData.actual_category_name}": ${error.message}`);
          results.failedCategories.push({
            category: categoryData,
            reason: error.message
          });
        }
      }

      // Resolve payee mappings by searching Xero
      for (const payeeData of missingPayees) {
        try {
          this.logger.debug(`Searching Xero for payee: ${payeeData.actual_payee_name}`);

          // Search for matching contact in Xero with fuzzy matching
          const matchingContacts = await this.xeroClient.searchContacts(payeeData.actual_payee_name, {
            includeArchived: false,
            limit: 5
          });

          if (matchingContacts.length > 0) {
            // Use the best match (first result from search)
            const bestMatch = matchingContacts[0];
            
            // Create mapping in Xano
            const mappingData = {
              actual_payee_id: payeeData.actual_payee_id,
              actual_payee_name: payeeData.actual_payee_name,
              xero_contact_id: bestMatch.xero_contact_id,
              xero_contact_name: bestMatch.name,
              is_active: true
            };

            const createdMapping = await this.xanoClient.upsertPayeeMapping(mappingData);
            results.resolvedPayees.push(createdMapping);

            this.logger.info(`Auto-resolved payee mapping: "${payeeData.actual_payee_name}" -> "${bestMatch.name}" (${bestMatch.xero_contact_id})`);

          } else {
            // No matches found, attempt to create new contact if enabled
            if (this.config.auto_create_missing_entities !== false) {
              try {
                const newContact = await this.xeroClient.createContact({
                  name: payeeData.actual_payee_name,
                  isSupplier: true,
                  isCustomer: false
                });

                // Create mapping with new contact
                const mappingData = {
                  actual_payee_id: payeeData.actual_payee_id,
                  actual_payee_name: payeeData.actual_payee_name,
                  xero_contact_id: newContact.xero_contact_id,
                  xero_contact_name: newContact.name,
                  is_active: true
                };

                const createdMapping = await this.xanoClient.upsertPayeeMapping(mappingData);
                results.resolvedPayees.push(createdMapping);

                this.logger.info(`Auto-created and mapped payee: "${payeeData.actual_payee_name}" -> "${newContact.name}" (${newContact.xero_contact_id})`);

              } catch (createError) {
                this.logger.warn(`Failed to create contact for payee "${payeeData.actual_payee_name}": ${createError.message}`);
                results.failedPayees.push({
                  payee: payeeData,
                  reason: `Contact creation failed: ${createError.message}`
                });
              }
            } else {
              this.logger.debug(`No match found for payee "${payeeData.actual_payee_name}" and auto-create is disabled`);
              results.failedPayees.push({
                payee: payeeData,
                reason: 'No match found and auto-create disabled'
              });
            }
          }

        } catch (error) {
          this.logger.error(`Error resolving payee mapping for "${payeeData.actual_payee_name}": ${error.message}`);
          results.failedPayees.push({
            payee: payeeData,
            reason: error.message
          });
        }
      }

      this.logger.debug(`Automatic resolution complete: ${results.resolvedCategories.length}/${missingCategories.length} categories, ${results.resolvedPayees.length}/${missingPayees.length} payees resolved`);

      return results;

    } catch (error) {
      this.logger.error(`Failed to attempt automatic mapping resolution: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate a unique account code for new Xero accounts
   * @param {string} accountName - Account name to generate code from
   * @returns {string} - Generated account code
   */
  generateAccountCode(accountName) {
    // Generate a code from the account name (first 3 letters + random number)
    const prefix = accountName.replace(/[^A-Za-z]/g, '').substring(0, 3).toUpperCase();
    const suffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${prefix}${suffix}`;
  }

  /**
   * Resolve missing mappings by searching Xero for matching accounts and contacts
   * @param {Object} options - Resolution options
   * @param {boolean} options.autoCreate - Whether to auto-create missing entities in Xero
   * @param {number} options.matchThreshold - Fuzzy match threshold (0-1, default: 0.8)
   * @param {number} options.limit - Maximum number of mappings to resolve per type
   * @returns {Promise<Object>} - Resolution results
   */
  async resolveMissingMappings(options = {}) {
    try {
      this.logger.info('Starting automatic mapping resolution');

      const resolveOptions = {
        autoCreate: options.autoCreate !== false, // Default to true
        matchThreshold: options.matchThreshold || 0.8,
        limit: options.limit || 50
      };

      // Get transactions with missing mappings
      const missingMappings = await this.xanoClient.getTransactionsWithMissingMappings({
        includeCategoryMissing: true,
        includePayeeMissing: true,
        limit: resolveOptions.limit
      });

      const results = {
        categories: {
          searched: 0,
          resolved: 0,
          created: 0,
          failed: 0,
          details: []
        },
        payees: {
          searched: 0,
          resolved: 0,
          created: 0,
          failed: 0,
          details: []
        }
      };

      // Resolve category mappings
      if (missingMappings.categoryMissing.length > 0) {
        this.logger.info(`Resolving ${missingMappings.categoryMissing.length} missing category mappings`);
        
        const categoryResults = await this.resolveCategoryMappings(
          missingMappings.categoryMissing,
          resolveOptions
        );
        
        results.categories = categoryResults;
      }

      // Resolve payee mappings
      if (missingMappings.payeeMissing.length > 0) {
        this.logger.info(`Resolving ${missingMappings.payeeMissing.length} missing payee mappings`);
        
        const payeeResults = await this.resolvePayeeMappings(
          missingMappings.payeeMissing,
          resolveOptions
        );
        
        results.payees = payeeResults;
      }

      this.logger.info(`Mapping resolution complete: ${results.categories.resolved + results.payees.resolved} mappings resolved`);
      
      return results;

    } catch (error) {
      this.logger.error(`Failed to resolve missing mappings: ${error.message}`);
      throw error;
    }
  }

  /**
   * Resolve category mappings by searching Xero for matching accounts
   * @param {Array} missingCategories - Transactions with missing category mappings
   * @param {Object} options - Resolution options
   * @returns {Promise<Object>} - Category resolution results
   */
  async resolveCategoryMappings(missingCategories, options) {
    const results = {
      searched: 0,
      resolved: 0,
      created: 0,
      failed: 0,
      details: []
    };

    // Extract unique categories to avoid duplicate searches
    const uniqueCategories = new Map();
    missingCategories.forEach(transaction => {
      if (transaction.actual_category_id && transaction.actual_category_name) {
        uniqueCategories.set(transaction.actual_category_id, {
          actual_category_id: transaction.actual_category_id,
          actual_category_name: transaction.actual_category_name
        });
      }
    });

    this.logger.debug(`Found ${uniqueCategories.size} unique categories to resolve`);

    const resolvedMappings = [];

    for (const [categoryId, categoryData] of uniqueCategories) {
      try {
        results.searched++;
        
        this.logger.debug(`Searching Xero for category: ${categoryData.actual_category_name}`);

        // Search for matching account in Xero
        const account = await this.xeroClient.findOrCreateAccount(categoryData.actual_category_name, {
          type: 'EXPENSE',
          autoCreate: options.autoCreate,
          matchThreshold: options.matchThreshold
        });

        if (account) {
          // Create or update mapping in Xano
          const mappingData = {
            actual_category_id: categoryData.actual_category_id,
            actual_category_name: categoryData.actual_category_name,
            xero_account_id: account.xero_account_id,
            xero_account_name: account.name,
            xero_account_code: account.code,
            is_active: true
          };

          await this.xanoClient.upsertCategoryMapping(mappingData);
          
          resolvedMappings.push(mappingData);
          results.resolved++;
          
          // Track if this was a newly created account
          if (account.status === 'ACTIVE' && options.autoCreate) {
            results.created++;
          }

          results.details.push({
            type: 'success',
            category: categoryData.actual_category_name,
            xero_account: account.name,
            xero_account_id: account.xero_account_id,
            was_created: account.status === 'ACTIVE' && options.autoCreate
          });

          this.logger.info(`Resolved category mapping: ${categoryData.actual_category_name} -> ${account.name}`);

        } else {
          results.failed++;
          results.details.push({
            type: 'failed',
            category: categoryData.actual_category_name,
            reason: 'No match found and auto-create disabled'
          });

          this.logger.warn(`Could not resolve category mapping for: ${categoryData.actual_category_name}`);
        }

      } catch (error) {
        results.failed++;
        results.details.push({
          type: 'error',
          category: categoryData.actual_category_name,
          reason: error.message
        });

        this.logger.error(`Error resolving category mapping for ${categoryData.actual_category_name}: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Resolve payee mappings by searching Xero for matching contacts
   * @param {Array} missingPayees - Transactions with missing payee mappings
   * @param {Object} options - Resolution options
   * @returns {Promise<Object>} - Payee resolution results
   */
  async resolvePayeeMappings(missingPayees, options) {
    const results = {
      searched: 0,
      resolved: 0,
      created: 0,
      failed: 0,
      details: []
    };

    // Extract unique payees to avoid duplicate searches
    const uniquePayees = new Map();
    missingPayees.forEach(transaction => {
      if (transaction.actual_payee_id && transaction.actual_payee_name) {
        uniquePayees.set(transaction.actual_payee_id, {
          actual_payee_id: transaction.actual_payee_id,
          actual_payee_name: transaction.actual_payee_name
        });
      }
    });

    this.logger.debug(`Found ${uniquePayees.size} unique payees to resolve`);

    const resolvedMappings = [];

    for (const [payeeId, payeeData] of uniquePayees) {
      try {
        results.searched++;
        
        this.logger.debug(`Searching Xero for payee: ${payeeData.actual_payee_name}`);

        // Search for matching contact in Xero
        const contact = await this.xeroClient.findOrCreateContact(payeeData.actual_payee_name, {
          isSupplier: true,
          isCustomer: false,
          autoCreate: options.autoCreate,
          matchThreshold: options.matchThreshold
        });

        if (contact) {
          // Create or update mapping in Xano
          const mappingData = {
            actual_payee_id: payeeData.actual_payee_id,
            actual_payee_name: payeeData.actual_payee_name,
            xero_contact_id: contact.xero_contact_id,
            xero_contact_name: contact.name,
            is_active: true
          };

          await this.xanoClient.upsertPayeeMapping(mappingData);
          
          resolvedMappings.push(mappingData);
          results.resolved++;
          
          // Track if this was a newly created contact
          if (contact.status === 'ACTIVE' && options.autoCreate) {
            results.created++;
          }

          results.details.push({
            type: 'success',
            payee: payeeData.actual_payee_name,
            xero_contact: contact.name,
            xero_contact_id: contact.xero_contact_id,
            was_created: contact.status === 'ACTIVE' && options.autoCreate
          });

          this.logger.info(`Resolved payee mapping: ${payeeData.actual_payee_name} -> ${contact.name}`);

        } else {
          results.failed++;
          results.details.push({
            type: 'failed',
            payee: payeeData.actual_payee_name,
            reason: 'No match found and auto-create disabled'
          });

          this.logger.warn(`Could not resolve payee mapping for: ${payeeData.actual_payee_name}`);
        }

      } catch (error) {
        results.failed++;
        results.details.push({
          type: 'error',
          payee: payeeData.actual_payee_name,
          reason: error.message
        });

        this.logger.error(`Error resolving payee mapping for ${payeeData.actual_payee_name}: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Validate mapping completeness and consistency
   * @param {Object} options - Validation options
   * @param {boolean} options.includeInactive - Include inactive mappings in validation
   * @returns {Promise<Object>} - Validation results
   */
  async validateMappings(options = {}) {
    try {
      this.logger.info('Starting mapping validation');

      const validation = {
        isValid: true,
        errors: [],
        warnings: [],
        statistics: {
          categories: {
            total: 0,
            active: 0,
            mapped: 0,
            unmapped: 0
          },
          payees: {
            total: 0,
            active: 0,
            mapped: 0,
            unmapped: 0
          }
        },
        missingMappings: {
          categories: [],
          payees: []
        }
      };

      // Get all mappings from Xano
      const allMappings = await this.xanoClient.batchGetMappings([], []);
      
      // Filter mappings based on options
      const categoryMappings = options.includeInactive 
        ? allMappings.categoryMappings 
        : allMappings.categoryMappings.filter(m => m.is_active);
        
      const payeeMappings = options.includeInactive 
        ? allMappings.payeeMappings 
        : allMappings.payeeMappings.filter(m => m.is_active);

      // Validate category mappings
      validation.statistics.categories.total = categoryMappings.length;
      validation.statistics.categories.active = categoryMappings.filter(m => m.is_active).length;
      
      const mappedCategories = categoryMappings.filter(m => m.xero_account_id);
      validation.statistics.categories.mapped = mappedCategories.length;
      validation.statistics.categories.unmapped = categoryMappings.length - mappedCategories.length;

      // Find unmapped categories
      const unmappedCategories = categoryMappings.filter(m => !m.xero_account_id);
      validation.missingMappings.categories = unmappedCategories.map(m => ({
        actual_category_id: m.actual_category_id,
        actual_category_name: m.actual_category_name
      }));

      // Validate payee mappings
      validation.statistics.payees.total = payeeMappings.length;
      validation.statistics.payees.active = payeeMappings.filter(m => m.is_active).length;
      
      const mappedPayees = payeeMappings.filter(m => m.xero_contact_id);
      validation.statistics.payees.mapped = mappedPayees.length;
      validation.statistics.payees.unmapped = payeeMappings.length - mappedPayees.length;

      // Find unmapped payees
      const unmappedPayees = payeeMappings.filter(m => !m.xero_contact_id);
      validation.missingMappings.payees = unmappedPayees.map(m => ({
        actual_payee_id: m.actual_payee_id,
        actual_payee_name: m.actual_payee_name
      }));

      // Check for validation issues
      if (validation.statistics.categories.unmapped > 0) {
        validation.warnings.push(`${validation.statistics.categories.unmapped} categories are not mapped to Xero accounts`);
      }

      if (validation.statistics.payees.unmapped > 0) {
        validation.warnings.push(`${validation.statistics.payees.unmapped} payees are not mapped to Xero contacts`);
      }

      // Check for duplicate Xero IDs
      const xeroAccountIds = mappedCategories.map(m => m.xero_account_id);
      const duplicateAccountIds = xeroAccountIds.filter((id, index) => xeroAccountIds.indexOf(id) !== index);
      if (duplicateAccountIds.length > 0) {
        validation.errors.push(`Duplicate Xero account IDs found: ${[...new Set(duplicateAccountIds)].join(', ')}`);
        validation.isValid = false;
      }

      const xeroContactIds = mappedPayees.map(m => m.xero_contact_id);
      const duplicateContactIds = xeroContactIds.filter((id, index) => xeroContactIds.indexOf(id) !== index);
      if (duplicateContactIds.length > 0) {
        validation.errors.push(`Duplicate Xero contact IDs found: ${[...new Set(duplicateContactIds)].join(', ')}`);
        validation.isValid = false;
      }

      // Get transactions that would be blocked by missing mappings
      const blockedTransactions = await this.xanoClient.getTransactionsWithMissingMappings({
        includeCategoryMissing: true,
        includePayeeMissing: true,
        limit: 100
      });

      const totalBlocked = blockedTransactions.categoryMissing.length + 
                          blockedTransactions.payeeMissing.length + 
                          blockedTransactions.bothMissing.length;

      if (totalBlocked > 0) {
        validation.warnings.push(`${totalBlocked} transactions are blocked due to missing mappings`);
      }

      this.logger.info(`Mapping validation complete: ${validation.errors.length} errors, ${validation.warnings.length} warnings`);
      
      return validation;

    } catch (error) {
      this.logger.error(`Failed to validate mappings: ${error.message}`);
      throw error;
    }
  }

  /**
   * Ensure all required mappings exist before Xero import
   * @param {Array} transactions - Transactions to validate
   * @returns {Promise<Object>} - Validation results with ready and blocked transactions
   */
  async validateTransactionsForXeroImport(transactions) {
    try {
      this.logger.debug(`Validating ${transactions.length} transactions for Xero import`);

      const validation = {
        ready: [],
        blocked: [],
        missingMappings: {
          categories: new Set(),
          payees: new Set()
        }
      };

      for (const transaction of transactions) {
        const hasValidCategoryMapping = !!(transaction.xero_account_id && transaction.xero_account_id.trim());
        const hasValidPayeeMapping = !!(transaction.xero_contact_id && transaction.xero_contact_id.trim());

        if (hasValidCategoryMapping && hasValidPayeeMapping) {
          validation.ready.push(transaction);
        } else {
          validation.blocked.push({
            transaction,
            missingCategory: !hasValidCategoryMapping,
            missingPayee: !hasValidPayeeMapping
          });

          // Track missing mappings for reporting
          if (!hasValidCategoryMapping && transaction.actual_category_id) {
            validation.missingMappings.categories.add(transaction.actual_category_id);
          }
          if (!hasValidPayeeMapping && transaction.actual_payee_id) {
            validation.missingMappings.payees.add(transaction.actual_payee_id);
          }
        }
      }

      this.logger.debug(`Validation complete: ${validation.ready.length} ready, ${validation.blocked.length} blocked`);

      return {
        ready: validation.ready,
        blocked: validation.blocked,
        missingMappings: {
          categories: Array.from(validation.missingMappings.categories),
          payees: Array.from(validation.missingMappings.payees)
        }
      };

    } catch (error) {
      this.logger.error(`Failed to validate transactions for Xero import: ${error.message}`);
      throw error;
    }
  }

  /**
   * Sync and update category mappings from Actual Budget
   * @param {string} categoryGroupId - Category group ID to sync
   * @returns {Promise<Object>} - Sync results
   */
  async syncCategoryMappings(categoryGroupId) {
    try {
      this.logger.info(`Syncing category mappings for group: ${categoryGroupId}`);

      // Get categories from Actual Budget
      const actualCategories = await this.actualClient.getCategories(categoryGroupId);
      
      if (actualCategories.length === 0) {
        this.logger.warn(`No categories found for group ${categoryGroupId}`);
        return { created: [], updated: [], errors: [] };
      }

      // Prepare category mappings for bulk upsert
      const categoryMappings = actualCategories.map(category => ({
        actual_category_id: category.id,
        actual_category_name: category.name,
        is_active: true
      }));

      // Bulk upsert category mappings in Xano
      const result = await this.xanoClient.bulkUpsertCategoryMappings(categoryMappings);

      this.logger.info(`Category mapping sync complete: ${result.created.length} created, ${result.updated.length} updated`);
      
      return result;

    } catch (error) {
      this.logger.error(`Failed to sync category mappings: ${error.message}`);
      throw error;
    }
  }

  /**
   * Sync and update payee mappings from Actual Budget
   * @returns {Promise<Object>} - Sync results
   */
  async syncPayeeMappings() {
    try {
      this.logger.info('Syncing payee mappings from Actual Budget');

      // Get payees from Actual Budget
      const actualPayees = await this.actualClient.getPayees();
      
      if (actualPayees.length === 0) {
        this.logger.warn('No payees found in Actual Budget');
        return { created: [], updated: [], errors: [] };
      }

      // Prepare payee mappings for bulk upsert
      const payeeMappings = actualPayees.map(payee => ({
        actual_payee_id: payee.id,
        actual_payee_name: payee.name,
        is_active: true
      }));

      // Bulk upsert payee mappings in Xano
      const result = await this.xanoClient.bulkUpsertPayeeMappings(payeeMappings);

      this.logger.info(`Payee mapping sync complete: ${result.created.length} created, ${result.updated.length} updated`);
      
      return result;

    } catch (error) {
      this.logger.error(`Failed to sync payee mappings: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reset sync statistics for a new sync run
   */
  resetStats() {
    this.stats = {
      transactionsFetched: 0,
      transactionsStored: 0,
      duplicatesSkipped: 0,
      transactionsMapped: 0,
      transactionsImported: 0,
      transactionsFailed: 0,
      mappingsResolved: 0,
      errors: []
    };
  }

  /**
   * Get sync results with timing and statistics
   * @param {number} startTime - Start time in milliseconds
   * @returns {Object} - Sync results
   */
  getSyncResults(startTime) {
    const endTime = Date.now();
    const duration = endTime - startTime;

    return {
      success: true,
      timestamp: new Date().toISOString(),
      duration,
      statistics: {
        transactionsFetched: this.stats.transactionsFetched,
        transactionsStored: this.stats.transactionsStored,
        duplicatesSkipped: this.stats.duplicatesSkipped,
        transactionsMapped: this.stats.transactionsMapped,
        transactionsImported: this.stats.transactionsImported,
        transactionsFailed: this.stats.transactionsFailed,
        mappingsResolved: this.stats.mappingsResolved,
        mappingErrors: this.stats.errors.filter(e => e.type === 'MISSING_MAPPINGS').length,
        totalErrors: this.stats.errors.length
      },
      errors: this.stats.errors,
      summary: {
        processed: this.stats.transactionsFetched,
        successful: this.stats.transactionsImported,
        failed: this.stats.transactionsFailed,
        skipped: this.stats.duplicatesSkipped,
        successRate: this.stats.transactionsFetched > 0 
          ? Math.round((this.stats.transactionsImported / this.stats.transactionsFetched) * 100) 
          : 0
      }
    };
  }

  /**
   * Create batches from an array of items
   * @param {Array} items - Items to batch
   * @param {number} batchSize - Size of each batch
   * @returns {Array} - Array of batches
   */
  createBatches(items, batchSize) {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    if (!batchSize || batchSize <= 0) {
      return [items];
    }

    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    return batches;
  }

  /**
   * Get service status and statistics
   * @returns {Object} - Service status
   */
  getStatus() {
    return {
      isConfigured: !!(this.actualClient && this.xanoClient && this.xeroClient),
      lastSyncStats: { ...this.stats },
      clients: {
        actual: this.actualClient?.getStatus(),
        xano: this.xanoClient?.getStatus(),
        xero: this.xeroClient?.getStatus()
      }
    };
  }
}

module.exports = SyncService;