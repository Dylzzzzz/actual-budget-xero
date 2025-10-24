const Joi = require('joi');

/**
 * Transaction status enumeration
 */
const TransactionStatus = {
  PENDING: 'pending',
  MAPPED: 'mapped',
  IMPORTED: 'imported',
  FAILED: 'failed'
};

/**
 * Transaction data model with comprehensive validation
 */
class Transaction {
  /**
   * Joi schema for transaction validation
   */
  static schema = Joi.object({
    // Xano fields
    id: Joi.number().integer().positive().optional(),
    
    // Actual Budget fields (required)
    actual_transaction_id: Joi.string().min(1).required()
      .messages({
        'string.min': 'Actual transaction ID cannot be empty',
        'any.required': 'Actual transaction ID is required'
      }),
    
    transaction_date: Joi.date().required()
      .messages({
        'any.required': 'Transaction date is required',
        'date.base': 'Transaction date must be a valid date'
      }),
    
    amount: Joi.number().precision(2).required()
      .messages({
        'any.required': 'Transaction amount is required',
        'number.base': 'Transaction amount must be a number'
      }),
    
    description: Joi.string().allow('').optional(),
    
    // Mapping fields
    actual_category_id: Joi.string().allow('').optional(),
    actual_payee_id: Joi.string().allow('').optional(),
    xero_account_id: Joi.string().allow('').optional(),
    xero_contact_id: Joi.string().allow('').optional(),
    
    // Xero import tracking
    xero_transaction_id: Joi.string().allow('').optional(),
    xero_imported_date: Joi.date().allow(null).optional(),
    
    // Status and error tracking
    status: Joi.string().valid(...Object.values(TransactionStatus)).default(TransactionStatus.PENDING)
      .messages({
        'any.only': `Status must be one of: ${Object.values(TransactionStatus).join(', ')}`
      }),
    
    error_message: Joi.string().allow('').optional(),
    
    // Timestamps
    created_date: Joi.date().default(() => new Date()),
    updated_date: Joi.date().optional()
  });

  /**
   * Create a new Transaction instance
   * @param {Object} data - Transaction data
   */
  constructor(data = {}) {
    // Validate and set data
    const validation = Transaction.validate(data);
    if (!validation.isValid) {
      throw new Error(`Transaction validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
    }
    
    Object.assign(this, validation.transaction);
  }

  /**
   * Validate transaction data
   * @param {Object} data - Transaction data to validate
   * @returns {Object} - Validation result
   */
  static validate(data) {
    const { error, value } = this.schema.validate(data, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));

      return {
        isValid: false,
        errors,
        transaction: null
      };
    }

    return {
      isValid: true,
      errors: [],
      transaction: value
    };
  }

  /**
   * Create transaction from Actual Budget data
   * @param {Object} actualData - Data from Actual Budget API
   * @returns {Transaction} - New transaction instance
   */
  static fromActualBudget(actualData) {
    const transactionData = {
      actual_transaction_id: actualData.id,
      transaction_date: new Date(actualData.date),
      amount: actualData.amount / 100, // Convert from cents to dollars
      description: actualData.notes || actualData.imported_description || '',
      actual_category_id: actualData.category,
      actual_payee_id: actualData.payee,
      status: TransactionStatus.PENDING
    };

    return new Transaction(transactionData);
  }

  /**
   * Update transaction status
   * @param {string} status - New status
   * @param {string} errorMessage - Optional error message
   */
  updateStatus(status, errorMessage = '') {
    if (!Object.values(TransactionStatus).includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    this.status = status;
    this.error_message = errorMessage;
    this.updated_date = new Date();

    // Clear error message if status is not failed
    if (status !== TransactionStatus.FAILED) {
      this.error_message = '';
    }
  }

  /**
   * Mark transaction as mapped with Xero IDs
   * @param {string} xeroAccountId - Xero account ID
   * @param {string} xeroContactId - Xero contact ID
   */
  setMappings(xeroAccountId, xeroContactId) {
    this.xero_account_id = xeroAccountId || '';
    this.xero_contact_id = xeroContactId || '';
    
    // Update status to mapped if both mappings are provided
    if (xeroAccountId && xeroContactId) {
      this.updateStatus(TransactionStatus.MAPPED);
    }
  }

  /**
   * Mark transaction as imported to Xero
   * @param {string} xeroTransactionId - Xero transaction ID
   */
  markAsImported(xeroTransactionId) {
    this.xero_transaction_id = xeroTransactionId;
    this.xero_imported_date = new Date();
    this.updateStatus(TransactionStatus.IMPORTED);
  }

  /**
   * Mark transaction as failed
   * @param {string} errorMessage - Error message
   */
  markAsFailed(errorMessage) {
    this.updateStatus(TransactionStatus.FAILED, errorMessage);
  }

  /**
   * Check if transaction has all required mappings for Xero import
   * @returns {boolean} - True if ready for import
   */
  isReadyForXeroImport() {
    return !!(this.xero_account_id && this.xero_contact_id && this.status === TransactionStatus.MAPPED);
  }

  /**
   * Check if transaction has been imported to Xero
   * @returns {boolean} - True if imported
   */
  isImported() {
    return this.status === TransactionStatus.IMPORTED && !!this.xero_transaction_id;
  }

  /**
   * Check if transaction processing failed
   * @returns {boolean} - True if failed
   */
  hasFailed() {
    return this.status === TransactionStatus.FAILED;
  }

  /**
   * Get transaction reference for Xero (format: Xano-{ID})
   * @returns {string} - Xero reference
   */
  getXeroReference() {
    if (!this.id) {
      throw new Error('Transaction must have an ID to generate Xero reference');
    }
    return `Xano-${this.id}`;
  }

  /**
   * Convert transaction to Xero API format
   * @returns {Object} - Xero transaction object
   */
  toXeroFormat() {
    if (!this.isReadyForXeroImport()) {
      throw new Error('Transaction is not ready for Xero import - missing mappings');
    }

    return {
      Type: this.amount < 0 ? 'SPEND' : 'RECEIVE',
      Contact: {
        ContactID: this.xero_contact_id
      },
      Date: this.transaction_date.toISOString().split('T')[0], // YYYY-MM-DD format
      LineItems: [{
        Description: this.description || 'Transaction from Actual Budget',
        Quantity: 1,
        UnitAmount: Math.abs(this.amount),
        AccountCode: this.xero_account_id,
        TaxType: 'NONE' // Default tax type, can be configured
      }],
      Reference: this.getXeroReference(),
      Status: 'AUTHORISED'
    };
  }

  /**
   * Convert transaction to plain object for storage
   * @returns {Object} - Plain object representation
   */
  toObject() {
    return {
      id: this.id,
      actual_transaction_id: this.actual_transaction_id,
      transaction_date: this.transaction_date,
      created_date: this.created_date,
      amount: this.amount,
      description: this.description,
      actual_category_id: this.actual_category_id,
      actual_payee_id: this.actual_payee_id,
      xero_account_id: this.xero_account_id,
      xero_contact_id: this.xero_contact_id,
      xero_transaction_id: this.xero_transaction_id,
      xero_imported_date: this.xero_imported_date,
      status: this.status,
      error_message: this.error_message,
      updated_date: this.updated_date
    };
  }

  /**
   * Create transaction instance from database record
   * @param {Object} record - Database record
   * @returns {Transaction} - Transaction instance
   */
  static fromDatabaseRecord(record) {
    return new Transaction({
      ...record,
      transaction_date: new Date(record.transaction_date),
      created_date: record.created_date ? new Date(record.created_date) : new Date(),
      xero_imported_date: record.xero_imported_date ? new Date(record.xero_imported_date) : null,
      updated_date: record.updated_date ? new Date(record.updated_date) : null
    });
  }
}

module.exports = { Transaction, TransactionStatus };