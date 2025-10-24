const { Transaction, TransactionStatus } = require('../models/transaction');

/**
 * ReprocessingService - Service for reprocessing failed transactions with updated mappings
 * 
 * Handles finding and reprocessing transactions that failed due to missing mappings,
 * attempting to resolve mappings automatically, and providing comprehensive reporting
 */
class ReprocessingService {
  constructor(options = {}) {
    this.xanoClient = options.xanoClient;
    this.xeroClient = options.xeroClient;
    this.actualClient = options.actualClient;
    this.logger = options.logger || console;
    this.config = options.config || {};

    // Reprocessing statistics
    this.stats = {
      transactionsFound: 0,
      transactionsProcessed: 0,
      transactionsResolved: 0,
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
    if (!this.xanoClient) {
      throw new Error('XanoClient is required');
    }
    if (!this.xeroClient) {
      throw new Error('XeroClient is required');
    }
    if (!this.actualClient) {
      throw new Error('ActualBudgetClient is required');
    }
  }

  /**
   * Find and reprocess failed transactions with updated mappings
   * @param {Object} options - Reprocessing options
   * @param {number} options.limit - Maximum number of transactions to reprocess (default: 50)
   * @param {string[]} options.statuses - Transaction statuses to reprocess (default: ['pending', 'failed'])
   * @param {boolean} options.autoResolve - Attempt automatic mapping resolution (default: true)
   * @param {boolean} options.importToXero - Import successfully mapped transactions to Xero (default: true)
   * @param {boolean} options.dryRun - Preview reprocessing without making changes (default: false)
   * @returns {Promise<Object>} - Comprehensive reprocessing results
   */
  async reprocessFailedTransactions(options = {}) {
    const startTime = Date.now();
    this.resetStats();

    try {
      this.logger.info('Starting transaction reprocessing');

      const reprocessOptions = {
        limit: options.limit || 50,
        statuses: options.statuses || ['pending', 'failed'],
        autoResolve: options.autoResolve !== false,
        importToXero: options.importToXero !== false,
        dryRun: options.dryRun || false
      };

      this.logger.info(`Reprocessing options: limit=${reprocessOptions.limit}, statuses=[${reprocessOptions.statuses.join(', ')}], autoResolve=${reprocessOptions.autoResolve}, importToXero=${reprocessOptions.importToXero}, dryRun=${reprocessOptions.dryRun}`);

      // Step 1: Find transactions ready for reprocessing
      const transactionsToReprocess = await this.findTransactionsForReprocessing(reprocessOptions);

      if (transactionsToReprocess.length === 0) {
        this.logger.info('No transactions found for reprocessing');
        return this.getReprocessingResults(startTime, reprocessOptions);
      }

      // Step 2: Analyze missing mappings and attempt resolution
      const mappingAnalysis = await this.analyzeMissingMappings(transactionsToReprocess);

      // Step 3: Attempt automatic mapping resolution if enabled
      if (reprocessOptions.autoResolve && (mappingAnalysis.missingCategories.length > 0 || mappingAnalysis.missingPayees.length > 0)) {
        await this.attemptAutomaticMappingResolution(mappingAnalysis);
      }

      // Step 4: Reprocess transactions with updated mappings
      const reprocessedTransactions = await this.processTransactionsWithMappings(
        transactionsToReprocess, 
        reprocessOptions
      );

      // Step 5: Import successfully mapped transactions to Xero
      if (reprocessOptions.importToXero && !reprocessOptions.dryRun && reprocessedTransactions.readyForXero.length > 0) {
        await this.importReprocessedTransactionsToXero(reprocessedTransactions.readyForXero);
      }

      const results = this.getReprocessingResults(startTime, reprocessOptions);
      this.logger.info(`Reprocessing completed: ${results.summary} in ${results.duration}ms`);
      
      return results;

    } catch (error) {
      this.stats.errors.push({
        type: 'REPROCESSING_ERROR',
        message: error.message,
        timestamp: new Date().toISOString()
      });

      this.logger.error(`Transaction reprocessing failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Find transactions that are ready for reprocessing
   * @param {Object} options - Query options
   * @returns {Promise<Array>} - Array of transactions ready for reprocessing
   */
  async findTransactionsForReprocessing(options) {
    try {
      this.logger.info(`Finding transactions for reprocessing with statuses: [${options.statuses.join(', ')}]`);

      const transactions = await this.xanoClient.getTransactionsForReprocessing({
        limit: options.limit,
        statuses: options.statuses
      });

      this.stats.transactionsFound = transactions.length;
      
      // Filter transactions that failed due to missing mappings
      const eligibleTransactions = transactions.filter(transaction => {
        // Check if transaction failed due to missing mappings
        const hasMissingMappings = !transaction.xero_account_id || !transaction.xero_contact_id;
        const isMappingError = transaction.error_message && 
          (transaction.error_message.includes('mapping') || 
           transaction.error_message.includes('Missing'));

        return hasMissingMappings || isMappingError;
      });

      this.logger.info(`Found ${transactions.length} transactions with status [${options.statuses.join(', ')}], ${eligibleTransactions.length} eligible for reprocessing`);

      return eligibleTransactions;

    } catch (error) {
      this.stats.errors.push({
        type: 'FIND_TRANSACTIONS_ERROR',
        message: error.message,
        timestamp: new Date().toISOString()
      });

      this.logger.error(`Failed to find transactions for reprocessing: ${error.message}`);
      throw error;
    }
  }

  /**
   * Analyze missing mappings for transactions
   * @param {Array} transactions - Transactions to analyze
   * @returns {Promise<Object>} - Analysis of missing mappings
   */
  async analyzeMissingMappings(transactions) {
    try {
      this.logger.info(`Analyzing missing mappings for ${transactions.length} transactions`);

      const analysis = {
        missingCategories: new Map(),
        missingPayees: new Map(),
        transactionsByMissingType: {
          categoryOnly: [],
          payeeOnly: [],
          both: [],
          neither: []
        }
      };

      // Analyze each transaction for missing mappings
      for (const transaction of transactions) {
        const missingCategory = !transaction.xero_account_id && transaction.actual_category_id;
        const missingPayee = !transaction.xero_contact_id && transaction.actual_payee_id;

        // Categorize transaction by missing mapping type
        if (missingCategory && missingPayee) {
          analysis.transactionsByMissingType.both.push(transaction);
        } else if (missingCategory) {
          analysis.transactionsByMissingType.categoryOnly.push(transaction);
        } else if (missingPayee) {
          analysis.transactionsByMissingType.payeeOnly.push(transaction);
        } else {
          analysis.transactionsByMissingType.neither.push(transaction);
        }

        // Track unique missing categories
        if (missingCategory && transaction.actual_category_name) {
          analysis.missingCategories.set(transaction.actual_category_id, {
            actual_category_id: transaction.actual_category_id,
            actual_category_name: transaction.actual_category_name,
            transaction_count: (analysis.missingCategories.get(transaction.actual_category_id)?.transaction_count || 0) + 1
          });
        }

        // Track unique missing payees
        if (missingPayee && transaction.actual_payee_name) {
          analysis.missingPayees.set(transaction.actual_payee_id, {
            actual_payee_id: transaction.actual_payee_id,
            actual_payee_name: transaction.actual_payee_name,
            transaction_count: (analysis.missingPayees.get(transaction.actual_payee_id)?.transaction_count || 0) + 1
          });
        }
      }

      // Convert maps to arrays
      analysis.missingCategories = Array.from(analysis.missingCategories.values());
      analysis.missingPayees = Array.from(analysis.missingPayees.values());

      this.logger.info(`Missing mapping analysis: ${analysis.missingCategories.length} categories, ${analysis.missingPayees.length} payees`);
      this.logger.debug(`Transaction breakdown: ${analysis.transactionsByMissingType.both.length} missing both, ${analysis.transactionsByMissingType.categoryOnly.length} missing category, ${analysis.transactionsByMissingType.payeeOnly.length} missing payee, ${analysis.transactionsByMissingType.neither.length} missing neither`);

      return analysis;

    } catch (error) {
      this.stats.errors.push({
        type: 'MAPPING_ANALYSIS_ERROR',
        message: error.message,
        timestamp: new Date().toISOString()
      });

      this.logger.error(`Failed to analyze missing mappings: ${error.message}`);
      throw error;
    }
  }

  /**
   * Attempt automatic resolution of missing mappings
   * @param {Object} mappingAnalysis - Analysis of missing mappings
   * @returns {Promise<Object>} - Resolution results
   */
  async attemptAutomaticMappingResolution(mappingAnalysis) {
    try {
      this.logger.info(`Attempting automatic resolution for ${mappingAnalysis.missingCategories.length} categories and ${mappingAnalysis.missingPayees.length} payees`);

      const resolutionResults = {
        resolvedCategories: [],
        resolvedPayees: [],
        failedCategories: [],
        failedPayees: []
      };

      // Attempt to resolve missing category mappings
      if (mappingAnalysis.missingCategories.length > 0) {
        for (const categoryInfo of mappingAnalysis.missingCategories) {
          try {
            this.logger.debug(`Searching Xero for category: ${categoryInfo.actual_category_name}`);
            
            const xeroAccounts = await this.xeroClient.searchAccounts(categoryInfo.actual_category_name);
            
            if (xeroAccounts && xeroAccounts.length > 0) {
              // Use the first match (could be enhanced with fuzzy matching)
              const bestMatch = xeroAccounts[0];
              
              // Create or update the mapping in Xano
              const mappingData = {
                actual_category_id: categoryInfo.actual_category_id,
                actual_category_name: categoryInfo.actual_category_name,
                xero_account_id: bestMatch.AccountID,
                xero_account_name: bestMatch.Name,
                xero_account_code: bestMatch.Code,
                is_active: true
              };

              await this.xanoClient.upsertCategoryMapping(mappingData);
              
              resolutionResults.resolvedCategories.push({
                ...mappingData,
                transaction_count: categoryInfo.transaction_count
              });

              this.stats.mappingsResolved++;
              
              this.logger.info(`Resolved category mapping: ${categoryInfo.actual_category_name} -> ${bestMatch.Name} (${bestMatch.Code})`);
            } else {
              resolutionResults.failedCategories.push({
                ...categoryInfo,
                reason: 'No matching Xero account found'
              });
              
              this.logger.debug(`No Xero account found for category: ${categoryInfo.actual_category_name}`);
            }

          } catch (error) {
            resolutionResults.failedCategories.push({
              ...categoryInfo,
              reason: error.message
            });
            
            this.logger.warn(`Failed to resolve category mapping for ${categoryInfo.actual_category_name}: ${error.message}`);
          }
        }
      }

      // Attempt to resolve missing payee mappings
      if (mappingAnalysis.missingPayees.length > 0) {
        for (const payeeInfo of mappingAnalysis.missingPayees) {
          try {
            this.logger.debug(`Searching Xero for payee: ${payeeInfo.actual_payee_name}`);
            
            const xeroContacts = await this.xeroClient.searchContacts(payeeInfo.actual_payee_name);
            
            if (xeroContacts && xeroContacts.length > 0) {
              // Use the first match (could be enhanced with fuzzy matching)
              const bestMatch = xeroContacts[0];
              
              // Create or update the mapping in Xano
              const mappingData = {
                actual_payee_id: payeeInfo.actual_payee_id,
                actual_payee_name: payeeInfo.actual_payee_name,
                xero_contact_id: bestMatch.ContactID,
                xero_contact_name: bestMatch.Name,
                is_active: true
              };

              await this.xanoClient.upsertPayeeMapping(mappingData);
              
              resolutionResults.resolvedPayees.push({
                ...mappingData,
                transaction_count: payeeInfo.transaction_count
              });

              this.stats.mappingsResolved++;
              
              this.logger.info(`Resolved payee mapping: ${payeeInfo.actual_payee_name} -> ${bestMatch.Name}`);
            } else {
              resolutionResults.failedPayees.push({
                ...payeeInfo,
                reason: 'No matching Xero contact found'
              });
              
              this.logger.debug(`No Xero contact found for payee: ${payeeInfo.actual_payee_name}`);
            }

          } catch (error) {
            resolutionResults.failedPayees.push({
              ...payeeInfo,
              reason: error.message
            });
            
            this.logger.warn(`Failed to resolve payee mapping for ${payeeInfo.actual_payee_name}: ${error.message}`);
          }
        }
      }

      this.logger.info(`Automatic resolution complete: ${resolutionResults.resolvedCategories.length} categories, ${resolutionResults.resolvedPayees.length} payees resolved`);

      return resolutionResults;

    } catch (error) {
      this.stats.errors.push({
        type: 'AUTOMATIC_RESOLUTION_ERROR',
        message: error.message,
        timestamp: new Date().toISOString()
      });

      this.logger.error(`Failed to attempt automatic mapping resolution: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process transactions with updated mappings
   * @param {Array} transactions - Transactions to reprocess
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processing results
   */
  async processTransactionsWithMappings(transactions, options) {
    try {
      this.logger.info(`Processing ${transactions.length} transactions with updated mappings`);

      const results = {
        readyForXero: [],
        stillMissingMappings: [],
        processingErrors: []
      };

      // Get updated mappings for all transactions
      const categoryIds = [...new Set(transactions.map(t => t.actual_category_id).filter(id => id))];
      const payeeIds = [...new Set(transactions.map(t => t.actual_payee_id).filter(id => id))];

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

      // Process each transaction
      const mappingUpdates = [];

      for (const transaction of transactions) {
        try {
          const categoryMapping = categoryMappingMap.get(transaction.actual_category_id);
          const payeeMapping = payeeMappingMap.get(transaction.actual_payee_id);

          const hasValidCategoryMapping = categoryMapping && categoryMapping.xero_account_id;
          const hasValidPayeeMapping = payeeMapping && payeeMapping.xero_contact_id;

          if (hasValidCategoryMapping && hasValidPayeeMapping) {
            // Transaction now has all required mappings
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

            results.readyForXero.push(transaction);
            this.stats.transactionsResolved++;

          } else {
            // Transaction is still missing mappings
            const missingMappings = [];
            if (!hasValidCategoryMapping) missingMappings.push('category');
            if (!hasValidPayeeMapping) missingMappings.push('payee');

            const errorMessage = `Still missing ${missingMappings.join(' and ')} mapping(s) after reprocessing`;
            
            results.stillMissingMappings.push({
              transaction,
              missingMappings,
              errorMessage
            });

            // Mark transaction as failed if not in dry run mode
            if (!options.dryRun) {
              try {
                await this.xanoClient.markTransactionFailed(transaction.id, errorMessage);
                this.stats.transactionsFailed++;
              } catch (error) {
                this.logger.warn(`Failed to mark transaction ${transaction.id} as failed: ${error.message}`);
              }
            }
          }

          this.stats.transactionsProcessed++;

        } catch (error) {
          results.processingErrors.push({
            transaction,
            error: error.message
          });

          this.stats.errors.push({
            type: 'TRANSACTION_PROCESSING_ERROR',
            message: error.message,
            transaction_id: transaction.actual_transaction_id,
            xano_id: transaction.id,
            timestamp: new Date().toISOString()
          });

          this.logger.error(`Failed to process transaction ${transaction.id}: ${error.message}`);
        }
      }

      // Bulk update transaction mappings in Xano
      if (mappingUpdates.length > 0 && !options.dryRun) {
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

      this.logger.info(`Transaction processing complete: ${results.readyForXero.length} ready for Xero, ${results.stillMissingMappings.length} still missing mappings, ${results.processingErrors.length} errors`);

      return results;

    } catch (error) {
      this.stats.errors.push({
        type: 'PROCESS_TRANSACTIONS_ERROR',
        message: error.message,
        timestamp: new Date().toISOString()
      });

      this.logger.error(`Failed to process transactions with mappings: ${error.message}`);
      throw error;
    }
  }

  /**
   * Import reprocessed transactions to Xero
   * @param {Array} transactions - Transactions ready for Xero import
   * @returns {Promise<Object>} - Import results
   */
  async importReprocessedTransactionsToXero(transactions) {
    try {
      this.logger.info(`Importing ${transactions.length} reprocessed transactions to Xero`);

      const importResults = {
        imported: 0,
        failed: 0,
        errors: [],
        xeroUpdates: []
      };

      // Process transactions individually for better error handling
      for (const transaction of transactions) {
        try {
          // Generate Xero reference using Xano ID
          const xeroReference = `Xano-${transaction.id}`;
          
          // Format transaction for Xero
          const xeroTransactionData = await this.formatTransactionForXero(transaction, xeroReference);

          // Create transaction in Xero
          const xeroResult = await this.xeroClient.createTransaction({
            ...xeroTransactionData,
            xano_id: transaction.id
          });

          // Prepare update for Xano
          importResults.xeroUpdates.push({
            xano_id: transaction.id,
            xero_transaction_id: xeroResult.xero_transaction_id,
            xero_imported_date: new Date().toISOString(),
            xero_reference: xeroReference,
            xero_status: xeroResult.xero_status || 'AUTHORISED'
          });

          importResults.imported++;
          this.stats.transactionsImported++;

          // Tag transaction in Actual Budget
          try {
            await this.actualClient.addXeroTag(transaction.actual_transaction_id);
          } catch (tagError) {
            this.logger.warn(`Failed to tag transaction ${transaction.actual_transaction_id}: ${tagError.message}`);
          }

          this.logger.debug(`Successfully imported reprocessed transaction ${transaction.id} to Xero: ${xeroResult.xero_transaction_id}`);

        } catch (error) {
          importResults.failed++;
          this.stats.transactionsFailed++;
          
          const errorDetails = {
            type: 'XERO_IMPORT_ERROR',
            message: error.message,
            transaction_id: transaction.actual_transaction_id,
            xano_id: transaction.id,
            timestamp: new Date().toISOString()
          };

          importResults.errors.push(errorDetails);
          this.stats.errors.push(errorDetails);

          // Mark transaction as failed in Xano
          try {
            await this.xanoClient.markTransactionFailed(transaction.id, `Xero import failed: ${error.message}`);
          } catch (markError) {
            this.logger.warn(`Failed to mark transaction ${transaction.id} as failed: ${markError.message}`);
          }

          this.logger.error(`Failed to import reprocessed transaction ${transaction.id} to Xero: ${error.message}`);
        }
      }

      // Bulk update Xano with Xero import results
      if (importResults.xeroUpdates.length > 0) {
        try {
          await this.xanoClient.bulkUpdateTransactionXeroImports(importResults.xeroUpdates);
          this.logger.info(`Updated ${importResults.xeroUpdates.length} transactions with Xero import data`);
        } catch (error) {
          this.logger.error(`Failed to bulk update Xero import data: ${error.message}`);
          
          // Try individual updates as fallback
          for (const update of importResults.xeroUpdates) {
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

      this.logger.info(`Reprocessed transaction import complete: ${importResults.imported} imported, ${importResults.failed} failed`);

      return importResults;

    } catch (error) {
      this.stats.errors.push({
        type: 'IMPORT_REPROCESSED_ERROR',
        message: error.message,
        timestamp: new Date().toISOString()
      });

      this.logger.error(`Failed to import reprocessed transactions to Xero: ${error.message}`);
      throw error;
    }
  }

  /**
   * Format transaction for Xero API
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

      // Format description with fallback
      const description = transaction.description || 
                         `Reprocessed transaction from Actual Budget (${transaction.actual_transaction_id})`;

      // Build Xero transaction object
      const xeroTransaction = {
        Type: isSpend ? 'SPEND' : 'RECEIVE',
        Contact: {
          ContactID: transaction.xero_contact_id
        },
        Date: formattedDate,
        Reference: xeroReference,
        Status: 'AUTHORISED',
        LineItems: [{
          Description: description.substring(0, 4000), // Xero has a 4000 character limit
          Quantity: 1,
          UnitAmount: absoluteAmount,
          AccountID: transaction.xero_account_id,
          TaxType: 'NONE'
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
   * Get comprehensive reprocessing results
   * @param {number} startTime - Processing start time
   * @param {Object} options - Reprocessing options
   * @returns {Object} - Comprehensive results summary
   */
  getReprocessingResults(startTime, options) {
    const duration = Date.now() - startTime;
    
    return {
      success: this.stats.errors.length === 0,
      timestamp: new Date().toISOString(),
      duration,
      options,
      statistics: { ...this.stats },
      summary: `Found ${this.stats.transactionsFound} transactions, processed ${this.stats.transactionsProcessed}, resolved ${this.stats.transactionsResolved}, imported ${this.stats.transactionsImported}, failed ${this.stats.transactionsFailed}`,
      errors: this.stats.errors
    };
  }

  /**
   * Reset statistics for new reprocessing run
   */
  resetStats() {
    this.stats = {
      transactionsFound: 0,
      transactionsProcessed: 0,
      transactionsResolved: 0,
      transactionsImported: 0,
      transactionsFailed: 0,
      mappingsResolved: 0,
      errors: []
    };
  }

  /**
   * Get reprocessing service status
   * @returns {Object} - Service status and statistics
   */
  getStatus() {
    return {
      service: 'ReprocessingService',
      statistics: { ...this.stats },
      dependencies: {
        xanoClient: !!this.xanoClient,
        xeroClient: !!this.xeroClient,
        actualClient: !!this.actualClient
      }
    };
  }
}

module.exports = ReprocessingService;