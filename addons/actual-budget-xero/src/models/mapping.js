const Joi = require('joi');

/**
 * Base mapping class with common functionality
 */
class BaseMapping {
  /**
   * Base schema for all mappings
   */
  static baseSchema = {
    id: Joi.number().integer().positive().optional(),
    is_active: Joi.boolean().default(true),
    created_date: Joi.date().default(() => new Date()),
    updated_date: Joi.date().optional()
  };

  /**
   * Create a new mapping instance
   * @param {Object} data - Mapping data
   * @param {Object} schema - Joi schema for validation
   */
  constructor(data = {}, schema) {
    // Validate and set data
    const validation = this.constructor.validate(data, schema);
    if (!validation.isValid) {
      throw new Error(`${this.constructor.name} validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
    }
    
    Object.assign(this, validation.mapping);
  }

  /**
   * Validate mapping data
   * @param {Object} data - Mapping data to validate
   * @param {Object} schema - Joi schema
   * @returns {Object} - Validation result
   */
  static validate(data, schema) {
    const { error, value } = schema.validate(data, {
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
        mapping: null
      };
    }

    return {
      isValid: true,
      errors: [],
      mapping: value
    };
  }

  /**
   * Activate the mapping
   */
  activate() {
    this.is_active = true;
    this.updated_date = new Date();
  }

  /**
   * Deactivate the mapping
   */
  deactivate() {
    this.is_active = false;
    this.updated_date = new Date();
  }

  /**
   * Check if mapping is active
   * @returns {boolean} - True if active
   */
  isActive() {
    return this.is_active === true;
  }

  /**
   * Check if mapping has Xero ID assigned
   * @returns {boolean} - True if mapped
   */
  isMapped() {
    // Override in subclasses
    return false;
  }

  /**
   * Convert mapping to plain object for storage
   * @returns {Object} - Plain object representation
   */
  toObject() {
    return {
      id: this.id,
      is_active: this.is_active,
      created_date: this.created_date,
      updated_date: this.updated_date
    };
  }

  /**
   * Create mapping instance from database record
   * @param {Object} record - Database record
   * @returns {BaseMapping} - Mapping instance
   */
  static fromDatabaseRecord(record) {
    return new this({
      ...record,
      created_date: record.created_date ? new Date(record.created_date) : new Date(),
      updated_date: record.updated_date ? new Date(record.updated_date) : null
    });
  }
}

/**
 * Category mapping between Actual Budget and Xero
 */
class CategoryMapping extends BaseMapping {
  /**
   * Joi schema for category mapping validation
   */
  static schema = Joi.object({
    ...BaseMapping.baseSchema,
    
    // Actual Budget fields (required)
    actual_category_id: Joi.string().min(1).required()
      .messages({
        'string.min': 'Actual category ID cannot be empty',
        'any.required': 'Actual category ID is required'
      }),
    
    actual_category_name: Joi.string().min(1).required()
      .messages({
        'string.min': 'Actual category name cannot be empty',
        'any.required': 'Actual category name is required'
      }),
    
    // Xero fields (optional until mapped)
    xero_account_id: Joi.string().allow('').optional(),
    xero_account_name: Joi.string().allow('').optional(),
    xero_account_code: Joi.string().max(10).allow('').optional()
      .messages({
        'string.max': 'Xero account code cannot exceed 10 characters'
      })
  });

  /**
   * Create a new CategoryMapping instance
   * @param {Object} data - Category mapping data
   */
  constructor(data = {}) {
    super(data, CategoryMapping.schema);
  }

  /**
   * Validate category mapping data
   * @param {Object} data - Category mapping data to validate
   * @returns {Object} - Validation result
   */
  static validate(data) {
    return super.validate(data, this.schema);
  }

  /**
   * Set Xero account mapping
   * @param {string} accountId - Xero account ID
   * @param {string} accountName - Xero account name
   * @param {string} accountCode - Xero account code
   */
  setXeroMapping(accountId, accountName = '', accountCode = '') {
    this.xero_account_id = accountId;
    this.xero_account_name = accountName;
    this.xero_account_code = accountCode;
    this.updated_date = new Date();
  }

  /**
   * Clear Xero account mapping
   */
  clearXeroMapping() {
    this.xero_account_id = '';
    this.xero_account_name = '';
    this.xero_account_code = '';
    this.updated_date = new Date();
  }

  /**
   * Check if mapping has Xero account ID assigned
   * @returns {boolean} - True if mapped
   */
  isMapped() {
    return !!(this.xero_account_id && this.xero_account_id.trim());
  }

  /**
   * Get search terms for finding matching Xero accounts
   * @returns {Array<string>} - Array of search terms
   */
  getSearchTerms() {
    const terms = [this.actual_category_name];
    
    // Add variations of the category name
    const name = this.actual_category_name.toLowerCase();
    
    // Remove common prefixes/suffixes
    const cleanName = name
      .replace(/^(business\s+|work\s+|company\s+)/i, '')
      .replace(/(\s+expenses?|\s+costs?|\s+fees?)$/i, '');
    
    if (cleanName !== name) {
      terms.push(cleanName);
    }
    
    return [...new Set(terms)]; // Remove duplicates
  }

  /**
   * Convert mapping to plain object for storage
   * @returns {Object} - Plain object representation
   */
  toObject() {
    return {
      ...super.toObject(),
      actual_category_id: this.actual_category_id,
      actual_category_name: this.actual_category_name,
      xero_account_id: this.xero_account_id,
      xero_account_name: this.xero_account_name,
      xero_account_code: this.xero_account_code
    };
  }

  /**
   * Create category mapping from Actual Budget category
   * @param {Object} actualCategory - Category from Actual Budget API
   * @returns {CategoryMapping} - New category mapping instance
   */
  static fromActualBudgetCategory(actualCategory) {
    return new CategoryMapping({
      actual_category_id: actualCategory.id,
      actual_category_name: actualCategory.name,
      is_active: true
    });
  }
}

/**
 * Payee mapping between Actual Budget and Xero
 */
class PayeeMapping extends BaseMapping {
  /**
   * Joi schema for payee mapping validation
   */
  static schema = Joi.object({
    ...BaseMapping.baseSchema,
    
    // Actual Budget fields (required)
    actual_payee_id: Joi.string().min(1).required()
      .messages({
        'string.min': 'Actual payee ID cannot be empty',
        'any.required': 'Actual payee ID is required'
      }),
    
    actual_payee_name: Joi.string().min(1).required()
      .messages({
        'string.min': 'Actual payee name cannot be empty',
        'any.required': 'Actual payee name is required'
      }),
    
    // Xero fields (optional until mapped)
    xero_contact_id: Joi.string().allow('').optional(),
    xero_contact_name: Joi.string().allow('').optional()
  });

  /**
   * Create a new PayeeMapping instance
   * @param {Object} data - Payee mapping data
   */
  constructor(data = {}) {
    super(data, PayeeMapping.schema);
  }

  /**
   * Validate payee mapping data
   * @param {Object} data - Payee mapping data to validate
   * @returns {Object} - Validation result
   */
  static validate(data) {
    return super.validate(data, this.schema);
  }

  /**
   * Set Xero contact mapping
   * @param {string} contactId - Xero contact ID
   * @param {string} contactName - Xero contact name
   */
  setXeroMapping(contactId, contactName = '') {
    this.xero_contact_id = contactId;
    this.xero_contact_name = contactName;
    this.updated_date = new Date();
  }

  /**
   * Clear Xero contact mapping
   */
  clearXeroMapping() {
    this.xero_contact_id = '';
    this.xero_contact_name = '';
    this.updated_date = new Date();
  }

  /**
   * Check if mapping has Xero contact ID assigned
   * @returns {boolean} - True if mapped
   */
  isMapped() {
    return !!(this.xero_contact_id && this.xero_contact_id.trim());
  }

  /**
   * Get search terms for finding matching Xero contacts
   * @returns {Array<string>} - Array of search terms
   */
  getSearchTerms() {
    const terms = [this.actual_payee_name];
    
    // Add variations of the payee name
    const name = this.actual_payee_name.toLowerCase();
    
    // Remove common suffixes
    const cleanName = name
      .replace(/(\s+inc\.?|\s+llc\.?|\s+ltd\.?|\s+corp\.?|\s+co\.?)$/i, '')
      .replace(/(\s+&\s+co\.?|\s+and\s+co\.?)$/i, '');
    
    if (cleanName !== name) {
      terms.push(cleanName);
    }
    
    // Add abbreviated version
    const words = cleanName.split(/\s+/);
    if (words.length > 1) {
      const abbreviated = words.map(word => word.charAt(0).toUpperCase()).join('');
      if (abbreviated.length >= 2) {
        terms.push(abbreviated);
      }
    }
    
    return [...new Set(terms)]; // Remove duplicates
  }

  /**
   * Convert mapping to plain object for storage
   * @returns {Object} - Plain object representation
   */
  toObject() {
    return {
      ...super.toObject(),
      actual_payee_id: this.actual_payee_id,
      actual_payee_name: this.actual_payee_name,
      xero_contact_id: this.xero_contact_id,
      xero_contact_name: this.xero_contact_name
    };
  }

  /**
   * Create payee mapping from Actual Budget payee
   * @param {Object} actualPayee - Payee from Actual Budget API
   * @returns {PayeeMapping} - New payee mapping instance
   */
  static fromActualBudgetPayee(actualPayee) {
    return new PayeeMapping({
      actual_payee_id: actualPayee.id,
      actual_payee_name: actualPayee.name,
      is_active: true
    });
  }
}

/**
 * Utility class for managing mappings
 */
class MappingManager {
  /**
   * Validate mapping consistency between category and payee mappings
   * @param {Array<CategoryMapping>} categoryMappings - Category mappings
   * @param {Array<PayeeMapping>} payeeMappings - Payee mappings
   * @returns {Object} - Validation result
   */
  static validateMappingConsistency(categoryMappings, payeeMappings) {
    const errors = [];
    const warnings = [];

    // Check for duplicate Actual Budget IDs
    const categoryIds = categoryMappings.map(m => m.actual_category_id);
    const duplicateCategoryIds = categoryIds.filter((id, index) => categoryIds.indexOf(id) !== index);
    if (duplicateCategoryIds.length > 0) {
      errors.push(`Duplicate category IDs found: ${duplicateCategoryIds.join(', ')}`);
    }

    const payeeIds = payeeMappings.map(m => m.actual_payee_id);
    const duplicatePayeeIds = payeeIds.filter((id, index) => payeeIds.indexOf(id) !== index);
    if (duplicatePayeeIds.length > 0) {
      errors.push(`Duplicate payee IDs found: ${duplicatePayeeIds.join(', ')}`);
    }

    // Check for unmapped active mappings
    const unmappedCategories = categoryMappings.filter(m => m.isActive() && !m.isMapped());
    if (unmappedCategories.length > 0) {
      warnings.push(`${unmappedCategories.length} active categories are not mapped to Xero accounts`);
    }

    const unmappedPayees = payeeMappings.filter(m => m.isActive() && !m.isMapped());
    if (unmappedPayees.length > 0) {
      warnings.push(`${unmappedPayees.length} active payees are not mapped to Xero contacts`);
    }

    // Check for duplicate Xero IDs
    const xeroAccountIds = categoryMappings
      .filter(m => m.isMapped())
      .map(m => m.xero_account_id);
    const duplicateXeroAccountIds = xeroAccountIds.filter((id, index) => xeroAccountIds.indexOf(id) !== index);
    if (duplicateXeroAccountIds.length > 0) {
      warnings.push(`Duplicate Xero account IDs found: ${duplicateXeroAccountIds.join(', ')}`);
    }

    const xeroContactIds = payeeMappings
      .filter(m => m.isMapped())
      .map(m => m.xero_contact_id);
    const duplicateXeroContactIds = xeroContactIds.filter((id, index) => xeroContactIds.indexOf(id) !== index);
    if (duplicateXeroContactIds.length > 0) {
      warnings.push(`Duplicate Xero contact IDs found: ${duplicateXeroContactIds.join(', ')}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get mapping statistics
   * @param {Array<CategoryMapping>} categoryMappings - Category mappings
   * @param {Array<PayeeMapping>} payeeMappings - Payee mappings
   * @returns {Object} - Mapping statistics
   */
  static getMappingStatistics(categoryMappings, payeeMappings) {
    const activeCategoryMappings = categoryMappings.filter(m => m.isActive());
    const activePayeeMappings = payeeMappings.filter(m => m.isActive());

    return {
      categories: {
        total: categoryMappings.length,
        active: activeCategoryMappings.length,
        mapped: activeCategoryMappings.filter(m => m.isMapped()).length,
        unmapped: activeCategoryMappings.filter(m => !m.isMapped()).length
      },
      payees: {
        total: payeeMappings.length,
        active: activePayeeMappings.length,
        mapped: activePayeeMappings.filter(m => m.isMapped()).length,
        unmapped: activePayeeMappings.filter(m => !m.isMapped()).length
      }
    };
  }
}

module.exports = {
  BaseMapping,
  CategoryMapping,
  PayeeMapping,
  MappingManager
};