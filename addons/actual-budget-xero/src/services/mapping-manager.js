const fs = require('fs').promises;
const path = require('path');

/**
 * MappingManager - Utility service for bulk mapping operations, validation, and backup/restore
 * 
 * Provides comprehensive mapping management functionality including:
 * - Bulk import/export of category and payee mappings
 * - Mapping validation and consistency checks
 * - Backup and restore operations
 * - Mapping synchronization utilities
 */
class MappingManager {
  constructor(options = {}) {
    this.xanoClient = options.xanoClient;
    this.actualClient = options.actualClient;
    this.xeroClient = options.xeroClient;
    this.logger = options.logger || console;
    this.backupDirectory = options.backupDirectory || './backups/mappings';

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
    if (!this.actualClient) {
      throw new Error('ActualBudgetClient is required');
    }
    if (!this.xeroClient) {
      throw new Error('XeroClient is required');
    }
  }

  /**
   * Bulk update category mappings from CSV or JSON data
   * @param {Array|string} mappingData - Array of mapping objects or CSV string
   * @param {Object} options - Update options
   * @param {boolean} options.validateXero - Validate Xero account IDs exist (default: true)
   * @param {boolean} options.createBackup - Create backup before update (default: true)
   * @param {boolean} options.dryRun - Preview changes without applying (default: false)
   * @returns {Promise<Object>} - Update results
   */
  async bulkUpdateCategoryMappings(mappingData, options = {}) {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting bulk category mapping update');

      const updateOptions = {
        validateXero: options.validateXero !== false,
        createBackup: options.createBackup !== false,
        dryRun: options.dryRun || false
      };

      // Parse mapping data if it's a string (CSV)
      const mappings = typeof mappingData === 'string' 
        ? this.parseCsvMappings(mappingData, 'category')
        : mappingData;

      if (!Array.isArray(mappings) || mappings.length === 0) {
        throw new Error('Invalid mapping data: expected array of mapping objects');
      }

      this.logger.info(`Processing ${mappings.length} category mappings`);

      // Validate mapping data structure
      const validationResult = this.validateCategoryMappingData(mappings);
      if (!validationResult.isValid) {
        throw new Error(`Mapping validation failed: ${validationResult.errors.join(', ')}`);
      }

      // Create backup if requested
      if (updateOptions.createBackup && !updateOptions.dryRun) {
        await this.createMappingBackup('category');
      }

      // Validate Xero account IDs if requested
      let xeroValidationResults = { valid: [], invalid: [] };
      if (updateOptions.validateXero) {
        xeroValidationResults = await this.validateXeroAccountIds(
          mappings.filter(m => m.xero_account_id)
        );

        if (xeroValidationResults.invalid.length > 0) {
          this.logger.warn(`${xeroValidationResults.invalid.length} mappings have invalid Xero account IDs`);
        }
      }

      // Process mappings in batches
      const batchSize = 25;
      const batches = this.createBatches(mappings, batchSize);
      const results = {
        processed: 0,
        created: 0,
        updated: 0,
        failed: 0,
        errors: [],
        xeroValidation: xeroValidationResults
      };

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        this.logger.debug(`Processing category mapping batch ${i + 1}/${batches.length} (${batch.length} mappings)`);

        try {
          if (!updateOptions.dryRun) {
            const batchResult = await this.xanoClient.bulkUpsertCategoryMappings(batch);
            
            results.created += batchResult.created.length;
            results.updated += batchResult.updated.length;
            results.errors.push(...batchResult.errors);
          }
          
          results.processed += batch.length;

        } catch (error) {
          this.logger.error(`Failed to process category mapping batch ${i + 1}: ${error.message}`);
          
          // Try individual updates for this batch
          for (const mapping of batch) {
            try {
              if (!updateOptions.dryRun) {
                await this.xanoClient.upsertCategoryMapping(mapping);
                results.updated++;
              }
              results.processed++;
            } catch (individualError) {
              results.failed++;
              results.errors.push({
                mapping: mapping.actual_category_name,
                error: individualError.message
              });
            }
          }
        }
      }

      const summary = {
        success: true,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        dryRun: updateOptions.dryRun,
        results,
        summary: `Processed ${results.processed} mappings: ${results.created} created, ${results.updated} updated, ${results.failed} failed`
      };

      this.logger.info(`Bulk category mapping update complete: ${summary.summary} in ${summary.duration}ms`);
      
      return summary;

    } catch (error) {
      this.logger.error(`Bulk category mapping update failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Bulk update payee mappings from CSV or JSON data
   * @param {Array|string} mappingData - Array of mapping objects or CSV string
   * @param {Object} options - Update options
   * @param {boolean} options.validateXero - Validate Xero contact IDs exist (default: true)
   * @param {boolean} options.createBackup - Create backup before update (default: true)
   * @param {boolean} options.dryRun - Preview changes without applying (default: false)
   * @returns {Promise<Object>} - Update results
   */
  async bulkUpdatePayeeMappings(mappingData, options = {}) {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting bulk payee mapping update');

      const updateOptions = {
        validateXero: options.validateXero !== false,
        createBackup: options.createBackup !== false,
        dryRun: options.dryRun || false
      };

      // Parse mapping data if it's a string (CSV)
      const mappings = typeof mappingData === 'string' 
        ? this.parseCsvMappings(mappingData, 'payee')
        : mappingData;

      if (!Array.isArray(mappings) || mappings.length === 0) {
        throw new Error('Invalid mapping data: expected array of mapping objects');
      }

      this.logger.info(`Processing ${mappings.length} payee mappings`);

      // Validate mapping data structure
      const validationResult = this.validatePayeeMappingData(mappings);
      if (!validationResult.isValid) {
        throw new Error(`Mapping validation failed: ${validationResult.errors.join(', ')}`);
      }

      // Create backup if requested
      if (updateOptions.createBackup && !updateOptions.dryRun) {
        await this.createMappingBackup('payee');
      }

      // Validate Xero contact IDs if requested
      let xeroValidationResults = { valid: [], invalid: [] };
      if (updateOptions.validateXero) {
        xeroValidationResults = await this.validateXeroContactIds(
          mappings.filter(m => m.xero_contact_id)
        );

        if (xeroValidationResults.invalid.length > 0) {
          this.logger.warn(`${xeroValidationResults.invalid.length} mappings have invalid Xero contact IDs`);
        }
      }

      // Process mappings in batches
      const batchSize = 25;
      const batches = this.createBatches(mappings, batchSize);
      const results = {
        processed: 0,
        created: 0,
        updated: 0,
        failed: 0,
        errors: [],
        xeroValidation: xeroValidationResults
      };

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        this.logger.debug(`Processing payee mapping batch ${i + 1}/${batches.length} (${batch.length} mappings)`);

        try {
          if (!updateOptions.dryRun) {
            const batchResult = await this.xanoClient.bulkUpsertPayeeMappings(batch);
            
            results.created += batchResult.created.length;
            results.updated += batchResult.updated.length;
            results.errors.push(...batchResult.errors);
          }
          
          results.processed += batch.length;

        } catch (error) {
          this.logger.error(`Failed to process payee mapping batch ${i + 1}: ${error.message}`);
          
          // Try individual updates for this batch
          for (const mapping of batch) {
            try {
              if (!updateOptions.dryRun) {
                await this.xanoClient.upsertPayeeMapping(mapping);
                results.updated++;
              }
              results.processed++;
            } catch (individualError) {
              results.failed++;
              results.errors.push({
                mapping: mapping.actual_payee_name,
                error: individualError.message
              });
            }
          }
        }
      }

      const summary = {
        success: true,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        dryRun: updateOptions.dryRun,
        results,
        summary: `Processed ${results.processed} mappings: ${results.created} created, ${results.updated} updated, ${results.failed} failed`
      };

      this.logger.info(`Bulk payee mapping update complete: ${summary.summary} in ${summary.duration}ms`);
      
      return summary;

    } catch (error) {
      this.logger.error(`Bulk payee mapping update failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Export all mappings to various formats
   * @param {Object} options - Export options
   * @param {string} options.format - Export format: 'json', 'csv' (default: 'json')
   * @param {string} options.outputPath - Output file path (optional)
   * @param {boolean} options.includeInactive - Include inactive mappings (default: false)
   * @param {string[]} options.types - Mapping types to export: ['category', 'payee'] (default: both)
   * @returns {Promise<Object>} - Export results with data and file paths
   */
  async exportMappings(options = {}) {
    try {
      this.logger.info('Starting mapping export');

      const exportOptions = {
        format: options.format || 'json',
        outputPath: options.outputPath,
        includeInactive: options.includeInactive || false,
        types: options.types || ['category', 'payee']
      };

      // Validate format
      if (!['json', 'csv'].includes(exportOptions.format)) {
        throw new Error('Export format must be "json" or "csv"');
      }

      // Get all mappings from Xano
      const allMappings = await this.xanoClient.batchGetMappings([], []);
      
      const exportData = {};
      const filePaths = {};

      // Export category mappings
      if (exportOptions.types.includes('category')) {
        const categoryMappings = exportOptions.includeInactive 
          ? allMappings.categoryMappings 
          : allMappings.categoryMappings.filter(m => m.is_active);

        exportData.categories = categoryMappings;

        if (exportOptions.outputPath) {
          const categoryPath = this.generateExportPath(exportOptions.outputPath, 'category', exportOptions.format);
          await this.writeExportFile(categoryMappings, categoryPath, exportOptions.format, 'category');
          filePaths.categories = categoryPath;
        }
      }

      // Export payee mappings
      if (exportOptions.types.includes('payee')) {
        const payeeMappings = exportOptions.includeInactive 
          ? allMappings.payeeMappings 
          : allMappings.payeeMappings.filter(m => m.is_active);

        exportData.payees = payeeMappings;

        if (exportOptions.outputPath) {
          const payeePath = this.generateExportPath(exportOptions.outputPath, 'payee', exportOptions.format);
          await this.writeExportFile(payeeMappings, payeePath, exportOptions.format, 'payee');
          filePaths.payees = payeePath;
        }
      }

      const summary = {
        success: true,
        timestamp: new Date().toISOString(),
        format: exportOptions.format,
        exportedTypes: exportOptions.types,
        counts: {
          categories: exportData.categories?.length || 0,
          payees: exportData.payees?.length || 0
        },
        filePaths,
        data: exportData
      };

      this.logger.info(`Mapping export complete: ${summary.counts.categories} categories, ${summary.counts.payees} payees exported as ${exportOptions.format}`);
      
      return summary;

    } catch (error) {
      this.logger.error(`Mapping export failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Import mappings from file or data
   * @param {string|Object} source - File path or mapping data object
   * @param {Object} options - Import options
   * @param {string} options.format - Import format: 'json', 'csv' (auto-detected if not specified)
   * @param {boolean} options.validateXero - Validate Xero IDs exist (default: true)
   * @param {boolean} options.createBackup - Create backup before import (default: true)
   * @param {boolean} options.dryRun - Preview import without applying (default: false)
   * @param {string[]} options.types - Mapping types to import: ['category', 'payee'] (default: both)
   * @returns {Promise<Object>} - Import results
   */
  async importMappings(source, options = {}) {
    try {
      this.logger.info('Starting mapping import');

      const importOptions = {
        format: options.format,
        validateXero: options.validateXero !== false,
        createBackup: options.createBackup !== false,
        dryRun: options.dryRun || false,
        types: options.types || ['category', 'payee']
      };

      // Load mapping data
      let mappingData;
      if (typeof source === 'string') {
        // Source is a file path
        mappingData = await this.loadMappingFile(source, importOptions.format);
      } else if (typeof source === 'object') {
        // Source is mapping data object
        mappingData = source;
      } else {
        throw new Error('Source must be a file path string or mapping data object');
      }

      const results = {
        categories: { processed: 0, created: 0, updated: 0, failed: 0, errors: [] },
        payees: { processed: 0, created: 0, updated: 0, failed: 0, errors: [] }
      };

      // Import category mappings
      if (importOptions.types.includes('category') && mappingData.categories) {
        this.logger.info(`Importing ${mappingData.categories.length} category mappings`);
        
        const categoryResult = await this.bulkUpdateCategoryMappings(mappingData.categories, {
          validateXero: importOptions.validateXero,
          createBackup: false, // Already handled at import level
          dryRun: importOptions.dryRun
        });
        
        results.categories = categoryResult.results;
      }

      // Import payee mappings
      if (importOptions.types.includes('payee') && mappingData.payees) {
        this.logger.info(`Importing ${mappingData.payees.length} payee mappings`);
        
        const payeeResult = await this.bulkUpdatePayeeMappings(mappingData.payees, {
          validateXero: importOptions.validateXero,
          createBackup: false, // Already handled at import level
          dryRun: importOptions.dryRun
        });
        
        results.payees = payeeResult.results;
      }

      const summary = {
        success: true,
        timestamp: new Date().toISOString(),
        dryRun: importOptions.dryRun,
        importedTypes: importOptions.types,
        results,
        summary: `Categories: ${results.categories.created} created, ${results.categories.updated} updated. Payees: ${results.payees.created} created, ${results.payees.updated} updated`
      };

      this.logger.info(`Mapping import complete: ${summary.summary}`);
      
      return summary;

    } catch (error) {
      this.logger.error(`Mapping import failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create backup of current mappings
   * @param {string} type - Mapping type: 'category', 'payee', or 'all' (default: 'all')
   * @param {string} backupPath - Custom backup path (optional)
   * @returns {Promise<Object>} - Backup results with file paths
   */
  async createMappingBackup(type = 'all', backupPath = null) {
    try {
      this.logger.info(`Creating mapping backup for type: ${type}`);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = backupPath || path.join(this.backupDirectory, timestamp);
      
      // Ensure backup directory exists
      await fs.mkdir(backupDir, { recursive: true });

      const backupFiles = {};
      const types = type === 'all' ? ['category', 'payee'] : [type];

      // Export mappings to backup directory
      const exportResult = await this.exportMappings({
        format: 'json',
        outputPath: backupDir,
        includeInactive: true,
        types
      });

      backupFiles.mappings = exportResult.filePaths;

      // Also create a metadata file
      const metadata = {
        backupCreated: new Date().toISOString(),
        backupType: type,
        counts: exportResult.counts,
        version: '1.0'
      };

      const metadataPath = path.join(backupDir, 'backup-metadata.json');
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      backupFiles.metadata = metadataPath;

      this.logger.info(`Mapping backup created: ${backupDir}`);
      
      return {
        success: true,
        timestamp: new Date().toISOString(),
        backupDirectory: backupDir,
        backupType: type,
        files: backupFiles,
        metadata
      };

    } catch (error) {
      this.logger.error(`Failed to create mapping backup: ${error.message}`);
      throw error;
    }
  }

  /**
   * Restore mappings from backup
   * @param {string} backupPath - Path to backup directory or file
   * @param {Object} options - Restore options
   * @param {boolean} options.validateXero - Validate Xero IDs exist (default: false for restore)
   * @param {boolean} options.createBackup - Create backup before restore (default: true)
   * @param {boolean} options.dryRun - Preview restore without applying (default: false)
   * @returns {Promise<Object>} - Restore results
   */
  async restoreMappingBackup(backupPath, options = {}) {
    try {
      this.logger.info(`Restoring mappings from backup: ${backupPath}`);

      const restoreOptions = {
        validateXero: options.validateXero || false, // Default to false for restore
        createBackup: options.createBackup !== false,
        dryRun: options.dryRun || false
      };

      // Create current backup before restore if requested
      if (restoreOptions.createBackup && !restoreOptions.dryRun) {
        await this.createMappingBackup('all');
      }

      // Load backup metadata if available
      let metadata = null;
      const metadataPath = path.join(backupPath, 'backup-metadata.json');
      
      try {
        const metadataContent = await fs.readFile(metadataPath, 'utf8');
        metadata = JSON.parse(metadataContent);
        this.logger.info(`Loaded backup metadata: created ${metadata.backupCreated}, type ${metadata.backupType}`);
      } catch (error) {
        this.logger.warn(`Could not load backup metadata: ${error.message}`);
      }

      // Import mappings from backup
      const importResult = await this.importMappings(backupPath, {
        format: 'json',
        validateXero: restoreOptions.validateXero,
        createBackup: false, // Already handled above
        dryRun: restoreOptions.dryRun,
        types: ['category', 'payee']
      });

      const summary = {
        success: true,
        timestamp: new Date().toISOString(),
        backupPath,
        metadata,
        dryRun: restoreOptions.dryRun,
        results: importResult.results,
        summary: importResult.summary
      };

      this.logger.info(`Mapping restore complete: ${summary.summary}`);
      
      return summary;

    } catch (error) {
      this.logger.error(`Failed to restore mapping backup: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validate mapping consistency and completeness
   * @param {Object} options - Validation options
   * @param {boolean} options.checkXeroIds - Validate Xero IDs exist in Xero (default: false)
   * @param {boolean} options.checkDuplicates - Check for duplicate mappings (default: true)
   * @param {boolean} options.checkOrphaned - Check for orphaned mappings (default: true)
   * @returns {Promise<Object>} - Comprehensive validation results
   */
  async validateMappingConsistency(options = {}) {
    try {
      this.logger.info('Starting comprehensive mapping validation');

      const validationOptions = {
        checkXeroIds: options.checkXeroIds || false,
        checkDuplicates: options.checkDuplicates !== false,
        checkOrphaned: options.checkOrphaned !== false
      };

      const validation = {
        isValid: true,
        errors: [],
        warnings: [],
        statistics: {
          categories: { total: 0, active: 0, mapped: 0, unmapped: 0, duplicates: 0, orphaned: 0 },
          payees: { total: 0, active: 0, mapped: 0, unmapped: 0, duplicates: 0, orphaned: 0 }
        },
        details: {
          duplicateXeroIds: { categories: [], payees: [] },
          orphanedMappings: { categories: [], payees: [] },
          invalidXeroIds: { categories: [], payees: [] }
        }
      };

      // Get all mappings
      const allMappings = await this.xanoClient.batchGetMappings([], []);
      
      // Validate category mappings
      const categoryValidation = await this.validateCategoryMappingConsistency(
        allMappings.categoryMappings, 
        validationOptions
      );
      
      validation.statistics.categories = categoryValidation.statistics;
      validation.details.duplicateXeroIds.categories = categoryValidation.duplicateXeroIds;
      validation.details.orphanedMappings.categories = categoryValidation.orphanedMappings;
      validation.details.invalidXeroIds.categories = categoryValidation.invalidXeroIds;
      
      validation.errors.push(...categoryValidation.errors);
      validation.warnings.push(...categoryValidation.warnings);

      // Validate payee mappings
      const payeeValidation = await this.validatePayeeMappingConsistency(
        allMappings.payeeMappings, 
        validationOptions
      );
      
      validation.statistics.payees = payeeValidation.statistics;
      validation.details.duplicateXeroIds.payees = payeeValidation.duplicateXeroIds;
      validation.details.orphanedMappings.payees = payeeValidation.orphanedMappings;
      validation.details.invalidXeroIds.payees = payeeValidation.invalidXeroIds;
      
      validation.errors.push(...payeeValidation.errors);
      validation.warnings.push(...payeeValidation.warnings);

      // Determine overall validation status
      validation.isValid = validation.errors.length === 0;

      // Add warnings for unmapped items
      if (validation.statistics.categories.unmapped > 0) {
        validation.warnings.push(`${validation.statistics.categories.unmapped} categories are not mapped to Xero accounts`);
      }

      if (validation.statistics.payees.unmapped > 0) {
        validation.warnings.push(`${validation.statistics.payees.unmapped} payees are not mapped to Xero contacts`);
      }

      // Generate summary
      const totalMapped = validation.statistics.categories.mapped + validation.statistics.payees.mapped;
      const totalUnmapped = validation.statistics.categories.unmapped + validation.statistics.payees.unmapped;
      const totalDuplicates = validation.statistics.categories.duplicates + validation.statistics.payees.duplicates;

      this.logger.info(`Mapping validation complete: ${totalMapped} mapped, ${totalUnmapped} unmapped, ${totalDuplicates} duplicates, ${validation.errors.length} errors`);
      
      return validation;

    } catch (error) {
      this.logger.error(`Failed to validate mapping consistency: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validate category mapping consistency
   * @param {Array} categoryMappings - Category mappings to validate
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} - Category validation results
   */
  async validateCategoryMappingConsistency(categoryMappings, options) {
    const validation = {
      statistics: { total: 0, active: 0, mapped: 0, unmapped: 0, duplicates: 0, orphaned: 0 },
      duplicateXeroIds: [],
      orphanedMappings: [],
      invalidXeroIds: [],
      errors: [],
      warnings: []
    };

    validation.statistics.total = categoryMappings.length;
    validation.statistics.active = categoryMappings.filter(m => m.is_active).length;
    
    const mappedCategories = categoryMappings.filter(m => m.xero_account_id);
    validation.statistics.mapped = mappedCategories.length;
    validation.statistics.unmapped = categoryMappings.length - mappedCategories.length;

    // Check for duplicate Xero account IDs
    if (options.checkDuplicates) {
      const xeroAccountIds = mappedCategories.map(m => m.xero_account_id);
      const duplicateIds = xeroAccountIds.filter((id, index) => xeroAccountIds.indexOf(id) !== index);
      
      if (duplicateIds.length > 0) {
        const uniqueDuplicates = [...new Set(duplicateIds)];
        validation.statistics.duplicates = uniqueDuplicates.length;
        validation.duplicateXeroIds = uniqueDuplicates;
        
        validation.errors.push(`Found ${uniqueDuplicates.length} duplicate Xero account IDs in category mappings`);
      }
    }

    // Check for orphaned mappings (categories that no longer exist in Actual Budget)
    if (options.checkOrphaned) {
      try {
        // This would require getting current categories from Actual Budget
        // For now, we'll skip this check as it requires additional API calls
        this.logger.debug('Orphaned mapping check skipped - requires Actual Budget API integration');
      } catch (error) {
        validation.warnings.push(`Could not check for orphaned category mappings: ${error.message}`);
      }
    }

    // Validate Xero account IDs exist in Xero
    if (options.checkXeroIds && mappedCategories.length > 0) {
      try {
        const xeroValidation = await this.validateXeroAccountIds(mappedCategories);
        validation.invalidXeroIds = xeroValidation.invalid.map(v => ({
          actual_category_id: v.actual_category_id,
          actual_category_name: v.actual_category_name,
          xero_account_id: v.xero_account_id,
          error: v.error
        }));

        if (validation.invalidXeroIds.length > 0) {
          validation.errors.push(`Found ${validation.invalidXeroIds.length} invalid Xero account IDs in category mappings`);
        }
      } catch (error) {
        validation.warnings.push(`Could not validate Xero account IDs: ${error.message}`);
      }
    }

    return validation;
  }

  /**
   * Validate payee mapping consistency
   * @param {Array} payeeMappings - Payee mappings to validate
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} - Payee validation results
   */
  async validatePayeeMappingConsistency(payeeMappings, options) {
    const validation = {
      statistics: { total: 0, active: 0, mapped: 0, unmapped: 0, duplicates: 0, orphaned: 0 },
      duplicateXeroIds: [],
      orphanedMappings: [],
      invalidXeroIds: [],
      errors: [],
      warnings: []
    };

    validation.statistics.total = payeeMappings.length;
    validation.statistics.active = payeeMappings.filter(m => m.is_active).length;
    
    const mappedPayees = payeeMappings.filter(m => m.xero_contact_id);
    validation.statistics.mapped = mappedPayees.length;
    validation.statistics.unmapped = payeeMappings.length - mappedPayees.length;

    // Check for duplicate Xero contact IDs
    if (options.checkDuplicates) {
      const xeroContactIds = mappedPayees.map(m => m.xero_contact_id);
      const duplicateIds = xeroContactIds.filter((id, index) => xeroContactIds.indexOf(id) !== index);
      
      if (duplicateIds.length > 0) {
        const uniqueDuplicates = [...new Set(duplicateIds)];
        validation.statistics.duplicates = uniqueDuplicates.length;
        validation.duplicateXeroIds = uniqueDuplicates;
        
        validation.errors.push(`Found ${uniqueDuplicates.length} duplicate Xero contact IDs in payee mappings`);
      }
    }

    // Check for orphaned mappings (payees that no longer exist in Actual Budget)
    if (options.checkOrphaned) {
      try {
        // This would require getting current payees from Actual Budget
        // For now, we'll skip this check as it requires additional API calls
        this.logger.debug('Orphaned mapping check skipped - requires Actual Budget API integration');
      } catch (error) {
        validation.warnings.push(`Could not check for orphaned payee mappings: ${error.message}`);
      }
    }

    // Validate Xero contact IDs exist in Xero
    if (options.checkXeroIds && mappedPayees.length > 0) {
      try {
        const xeroValidation = await this.validateXeroContactIds(mappedPayees);
        validation.invalidXeroIds = xeroValidation.invalid.map(v => ({
          actual_payee_id: v.actual_payee_id,
          actual_payee_name: v.actual_payee_name,
          xero_contact_id: v.xero_contact_id,
          error: v.error
        }));

        if (validation.invalidXeroIds.length > 0) {
          validation.errors.push(`Found ${validation.invalidXeroIds.length} invalid Xero contact IDs in payee mappings`);
        }
      } catch (error) {
        validation.warnings.push(`Could not validate Xero contact IDs: ${error.message}`);
      }
    }

    return validation;
  }

  /**
   * Validate that Xero account IDs exist in Xero
   * @param {Array} mappings - Mappings with xero_account_id to validate
   * @returns {Promise<Object>} - Validation results
   */
  async validateXeroAccountIds(mappings) {
    const validation = { valid: [], invalid: [] };

    for (const mapping of mappings) {
      if (!mapping.xero_account_id) continue;

      try {
        const account = await this.xeroClient.getAccount(mapping.xero_account_id);
        
        if (account) {
          validation.valid.push({
            ...mapping,
            xero_account_name: account.name,
            xero_account_code: account.code
          });
        } else {
          validation.invalid.push({
            ...mapping,
            error: 'Account not found in Xero'
          });
        }
      } catch (error) {
        validation.invalid.push({
          ...mapping,
          error: error.message
        });
      }
    }

    return validation;
  }

  /**
   * Validate that Xero contact IDs exist in Xero
   * @param {Array} mappings - Mappings with xero_contact_id to validate
   * @returns {Promise<Object>} - Validation results
   */
  async validateXeroContactIds(mappings) {
    const validation = { valid: [], invalid: [] };

    for (const mapping of mappings) {
      if (!mapping.xero_contact_id) continue;

      try {
        const contact = await this.xeroClient.getContact(mapping.xero_contact_id);
        
        if (contact) {
          validation.valid.push({
            ...mapping,
            xero_contact_name: contact.name
          });
        } else {
          validation.invalid.push({
            ...mapping,
            error: 'Contact not found in Xero'
          });
        }
      } catch (error) {
        validation.invalid.push({
          ...mapping,
          error: error.message
        });
      }
    }

    return validation;
  }

  /**
   * Parse CSV mapping data
   * @param {string} csvData - CSV string data
   * @param {string} type - Mapping type: 'category' or 'payee'
   * @returns {Array} - Parsed mapping objects
   */
  parseCsvMappings(csvData, type) {
    const lines = csvData.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    const mappings = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const mapping = {};

      headers.forEach((header, index) => {
        mapping[header] = values[index] || '';
      });

      // Convert string booleans
      if (mapping.is_active !== undefined) {
        mapping.is_active = mapping.is_active.toLowerCase() === 'true';
      }

      mappings.push(mapping);
    }

    return mappings;
  }

  /**
   * Validate category mapping data structure
   * @param {Array} mappings - Category mappings to validate
   * @returns {Object} - Validation result
   */
  validateCategoryMappingData(mappings) {
    const validation = { isValid: true, errors: [] };

    for (let i = 0; i < mappings.length; i++) {
      const mapping = mappings[i];
      const prefix = `Row ${i + 1}:`;

      if (!mapping.actual_category_id) {
        validation.errors.push(`${prefix} actual_category_id is required`);
      }

      if (!mapping.actual_category_name) {
        validation.errors.push(`${prefix} actual_category_name is required`);
      }

      if (mapping.is_active !== undefined && typeof mapping.is_active !== 'boolean') {
        validation.errors.push(`${prefix} is_active must be a boolean`);
      }
    }

    validation.isValid = validation.errors.length === 0;
    return validation;
  }

  /**
   * Validate payee mapping data structure
   * @param {Array} mappings - Payee mappings to validate
   * @returns {Object} - Validation result
   */
  validatePayeeMappingData(mappings) {
    const validation = { isValid: true, errors: [] };

    for (let i = 0; i < mappings.length; i++) {
      const mapping = mappings[i];
      const prefix = `Row ${i + 1}:`;

      if (!mapping.actual_payee_id) {
        validation.errors.push(`${prefix} actual_payee_id is required`);
      }

      if (!mapping.actual_payee_name) {
        validation.errors.push(`${prefix} actual_payee_name is required`);
      }

      if (mapping.is_active !== undefined && typeof mapping.is_active !== 'boolean') {
        validation.errors.push(`${prefix} is_active must be a boolean`);
      }
    }

    validation.isValid = validation.errors.length === 0;
    return validation;
  }

  /**
   * Generate export file path
   * @param {string} basePath - Base output path
   * @param {string} type - Mapping type
   * @param {string} format - File format
   * @returns {string} - Generated file path
   */
  generateExportPath(basePath, type, format) {
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const filename = `${type}-mappings-${timestamp}.${format}`;
    
    // If basePath is a directory, append filename
    if (basePath.endsWith('/') || !path.extname(basePath)) {
      return path.join(basePath, filename);
    }
    
    // If basePath is a file, use it directly but ensure correct extension
    const dir = path.dirname(basePath);
    const name = path.basename(basePath, path.extname(basePath));
    return path.join(dir, `${name}-${type}.${format}`);
  }

  /**
   * Write export data to file
   * @param {Array} data - Data to export
   * @param {string} filePath - Output file path
   * @param {string} format - Export format
   * @param {string} type - Mapping type
   */
  async writeExportFile(data, filePath, format, type) {
    // Ensure directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    if (format === 'json') {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } else if (format === 'csv') {
      const csv = this.convertToCsv(data, type);
      await fs.writeFile(filePath, csv);
    }
  }

  /**
   * Convert mapping data to CSV format
   * @param {Array} data - Mapping data
   * @param {string} type - Mapping type
   * @returns {string} - CSV string
   */
  convertToCsv(data, type) {
    if (data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const csvLines = [headers.join(',')];

    for (const item of data) {
      const values = headers.map(header => {
        const value = item[header];
        // Handle null/undefined values
        if (value === null || value === undefined) {
          return '';
        }
        // Escape commas and quotes in CSV values
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return String(value);
      });
      csvLines.push(values.join(','));
    }

    return csvLines.join('\n');
  }

  /**
   * Load mapping data from file
   * @param {string} filePath - File path to load
   * @param {string} format - File format (auto-detected if not specified)
   * @returns {Promise<Object>} - Loaded mapping data
   */
  async loadMappingFile(filePath, format = null) {
    const detectedFormat = format || path.extname(filePath).substring(1).toLowerCase();
    
    if (!['json', 'csv'].includes(detectedFormat)) {
      throw new Error(`Unsupported file format: ${detectedFormat}`);
    }

    const fileContent = await fs.readFile(filePath, 'utf8');

    if (detectedFormat === 'json') {
      return JSON.parse(fileContent);
    } else if (detectedFormat === 'csv') {
      // For CSV, we need to determine the mapping type from filename or content
      const filename = path.basename(filePath).toLowerCase();
      
      if (filename.includes('category')) {
        return { categories: this.parseCsvMappings(fileContent, 'category') };
      } else if (filename.includes('payee')) {
        return { payees: this.parseCsvMappings(fileContent, 'payee') };
      } else {
        throw new Error('Cannot determine mapping type from CSV filename. Use JSON format or include "category" or "payee" in filename.');
      }
    }
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
      isConfigured: !!(this.xanoClient && this.actualClient && this.xeroClient),
      backupDirectory: this.backupDirectory,
      clients: {
        xano: this.xanoClient?.getStatus(),
        actual: this.actualClient?.getStatus(),
        xero: this.xeroClient?.getStatus()
      }
    };
  }
}

module.exports = MappingManager;