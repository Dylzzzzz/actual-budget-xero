const Joi = require('joi');

/**
 * Configuration model with comprehensive validation
 */
class ConfigValidator {
  /**
   * Joi schema for configuration validation
   */
  static schema = Joi.object({
    // Actual Budget Configuration
    actual_budget_url: Joi.string().uri().required()
      .messages({
        'string.uri': 'Actual Budget URL must be a valid URL',
        'any.required': 'Actual Budget URL is required'
      }),
    
    actual_budget_password: Joi.string().min(1).required()
      .messages({
        'string.min': 'Actual Budget password cannot be empty',
        'any.required': 'Actual Budget password is required'
      }),
    
    business_category_group_id: Joi.string().allow('').optional(),
    
    business_category_group_name: Joi.string().min(1).required()
      .messages({
        'string.min': 'Business category group name cannot be empty',
        'any.required': 'Business category group name is required'
      }),
    
    // Xano Configuration
    xano_api_url: Joi.string().uri().required()
      .messages({
        'string.uri': 'Xano API URL must be a valid URL',
        'any.required': 'Xano API URL is required'
      }),
    
    xano_api_key: Joi.string().min(1).required()
      .messages({
        'string.min': 'Xano API key cannot be empty',
        'any.required': 'Xano API key is required'
      }),
    
    xano_rate_limit: Joi.number().integer().min(1).max(60).default(18)
      .messages({
        'number.min': 'Xano rate limit must be at least 1 call per minute',
        'number.max': 'Xano rate limit cannot exceed 60 calls per minute'
      }),
    
    // Xero Configuration
    xero_client_id: Joi.string().min(1).required()
      .messages({
        'string.min': 'Xero Client ID cannot be empty',
        'any.required': 'Xero Client ID is required'
      }),
    
    xero_client_secret: Joi.string().min(1).required()
      .messages({
        'string.min': 'Xero Client Secret cannot be empty',
        'any.required': 'Xero Client Secret is required'
      }),
    
    xero_tenant_id: Joi.string().min(1).required()
      .messages({
        'string.min': 'Xero Tenant ID cannot be empty',
        'any.required': 'Xero Tenant ID is required'
      }),
    
    // Sync Configuration
    sync_schedule: Joi.string().pattern(/^(\*|([0-5]?\d)) (\*|([01]?\d|2[0-3])) (\*|([0-2]?\d|3[01])) (\*|([0]?\d|1[0-2])) (\*|[0-6])$/)
      .default('0 2 * * 1')
      .messages({
        'string.pattern.base': 'Sync schedule must be a valid cron expression'
      }),
    
    sync_days_back: Joi.number().integer().min(1).max(30).default(7)
      .messages({
        'number.min': 'Sync days back must be at least 1 day',
        'number.max': 'Sync days back cannot exceed 30 days'
      }),
    
    batch_size: Joi.number().integer().min(1).max(50).default(10)
      .messages({
        'number.min': 'Batch size must be at least 1',
        'number.max': 'Batch size cannot exceed 50'
      }),
    
    // Safety Configuration
    dry_run_mode: Joi.boolean().default(true)
      .messages({
        'boolean.base': 'Dry run mode must be true or false'
      }),
    
    test_mode: Joi.boolean().default(true)
      .messages({
        'boolean.base': 'Test mode must be true or false'
      }),
    
    sync_to_xero: Joi.boolean().default(false)
      .messages({
        'boolean.base': 'Sync to Xero must be true or false'
      }),
    
    // Logging Configuration
    log_level: Joi.string().valid('debug', 'info', 'warn', 'error').default('info')
      .messages({
        'any.only': 'Log level must be one of: debug, info, warn, error'
      })
  }).custom((value, helpers) => {
    // Custom validation: Either category group ID or name must be provided
    if (!value.business_category_group_id && !value.business_category_group_name) {
      return helpers.error('custom.categoryGroup');
    }
    return value;
  }).messages({
    'custom.categoryGroup': 'Either business_category_group_id or business_category_group_name must be provided'
  });

  /**
   * Validate configuration object
   * @param {Object} config - Configuration object to validate
   * @returns {Object} - Validation result with error details or validated config
   */
  static validate(config) {
    const { error, value } = this.schema.validate(config, {
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
        config: null
      };
    }

    return {
      isValid: true,
      errors: [],
      config: value
    };
  }

  /**
   * Load configuration from Home Assistant options.json
   * @returns {Object} - Configuration object
   */
  static loadFromHomeAssistant() {
    try {
      const fs = require('fs');
      const optionsPath = '/data/options.json';
      
      if (fs.existsSync(optionsPath)) {
        const options = JSON.parse(fs.readFileSync(optionsPath, 'utf8'));
        console.log('Loading configuration from Home Assistant options.json');
        console.log('Raw options from file:', JSON.stringify(options, null, 2));
        return this.parseHomeAssistantOptions(options);
      }
    } catch (error) {
      console.log('Failed to load from options.json, falling back to environment variables:', error.message);
    }
    
    return null;
  }

  /**
   * Parse Home Assistant options into configuration format
   * @param {Object} options - Raw options from Home Assistant
   * @returns {Object} - Parsed configuration object
   */
  static parseHomeAssistantOptions(options) {
    const config = {
      actual_budget_url: options.actual_budget_url,
      actual_budget_password: options.actual_budget_password,
      business_category_group_id: options.business_category_group_id || '',
      business_category_group_name: options.business_category_group_name,
      xano_api_url: options.xano_api_url,
      xano_api_key: options.xano_api_key,
      xano_rate_limit: parseInt(options.xano_rate_limit) || 18,
      xero_client_id: options.xero_client_id,
      xero_client_secret: options.xero_client_secret,
      xero_tenant_id: options.xero_tenant_id,
      sync_schedule: options.sync_schedule || '0 2 * * 1',
      sync_days_back: parseInt(options.sync_days_back) || 7,
      batch_size: parseInt(options.batch_size) || 10,
      dry_run_mode: options.dry_run_mode !== false, // Default to true for safety
      test_mode: options.test_mode !== false, // Default to true for safety
      sync_to_xero: options.sync_to_xero === true, // Default to false for safety
      log_level: options.log_level || 'info'
    };
    
    // Debug: Log configuration values (without sensitive data)
    console.log('Parsed HA config:', {
      actual_budget_url: config.actual_budget_url,
      actual_budget_password: config.actual_budget_password ? `[${config.actual_budget_password.length} chars]` : 'EMPTY',
      business_category_group_name: config.business_category_group_name,
      xano_api_url: config.xano_api_url ? 'SET' : 'EMPTY',
      xano_api_key: config.xano_api_key ? `[${config.xano_api_key.length} chars]` : 'EMPTY',
      dry_run_mode: config.dry_run_mode,
      test_mode: config.test_mode,
      sync_to_xero: config.sync_to_xero
    });
    
    return config;
  }

  /**
   * Load configuration from environment variables
   * @returns {Object} - Configuration object
   */
  static loadFromEnvironment() {
    return {
      actual_budget_url: process.env.ACTUAL_BUDGET_URL,
      actual_budget_password: process.env.ACTUAL_BUDGET_PASSWORD,
      business_category_group_id: process.env.BUSINESS_CATEGORY_GROUP_ID || '',
      business_category_group_name: process.env.BUSINESS_CATEGORY_GROUP_NAME,
      xano_api_url: process.env.XANO_API_URL,
      xano_api_key: process.env.XANO_API_KEY,
      xano_rate_limit: parseInt(process.env.XANO_RATE_LIMIT) || 18,
      xero_client_id: process.env.XERO_CLIENT_ID,
      xero_client_secret: process.env.XERO_CLIENT_SECRET,
      xero_tenant_id: process.env.XERO_TENANT_ID,
      sync_schedule: process.env.SYNC_SCHEDULE || '0 2 * * 1',
      sync_days_back: parseInt(process.env.SYNC_DAYS_BACK) || 7,
      batch_size: parseInt(process.env.BATCH_SIZE) || 10,
      log_level: process.env.LOG_LEVEL || 'info'
    };
  }

  /**
   * Get validated configuration
   * @returns {Object} - Validated configuration object
   * @throws {Error} - If configuration is invalid
   */
  static getValidatedConfig() {
    // Try to load from Home Assistant options first
    let config = this.loadFromHomeAssistant();
    
    if (!config) {
      console.log('Loading configuration from environment variables...');
      
      // Debug: Show all environment variables
      console.log('All environment variables:');
      Object.keys(process.env).forEach(key => {
        if (key.includes('ACTUAL') || key.includes('XANO') || key.includes('XERO')) {
          console.log(`${key}: ${process.env[key]}`);
        }
      });
      
      config = this.loadFromEnvironment();
    }
    
    // Debug: log what we found
    console.log('Config loaded:', {
      actual_budget_url: config.actual_budget_url ? 'SET' : 'MISSING',
      actual_budget_password: config.actual_budget_password ? 'SET' : 'MISSING',
      xero_client_id: config.xero_client_id ? 'SET' : 'MISSING'
    });
    
    // Debug: log the full config structure
    console.log('Full config object:', JSON.stringify(config, null, 2));
    
    if (!config) {
      throw new Error('Configuration object is null or undefined');
    }
    
    console.log('Starting validation...');
    const validation = this.validate(config);
    console.log('Validation result:', { isValid: validation.isValid, errorCount: validation.errors.length });

    if (!validation.isValid) {
      const errorMessages = validation.errors.map(err => `${err.field}: ${err.message}`);
      console.log('Validation errors:', errorMessages);
      throw new Error(`Configuration validation failed:\n${errorMessages.join('\n')}`);
    }

    console.log('Validation successful, returning config');
    return validation.config;
  }


  /**
   * Validate API credentials format (without testing connections)
   * @param {Object} config - Configuration object
   * @returns {Object} - Validation result for API credentials
   */
  static validateApiCredentials(config) {
    const errors = [];
    const warnings = [];

    // Validate Actual Budget credentials
    if (config.actual_budget_url) {
      try {
        const url = new URL(config.actual_budget_url);
        if (!['http:', 'https:'].includes(url.protocol)) {
          errors.push('Actual Budget URL must use HTTP or HTTPS protocol');
        }
      } catch (e) {
        errors.push('Actual Budget URL is not a valid URL');
      }
    }

    if (config.actual_budget_password && config.actual_budget_password.length < 4) {
      warnings.push('Actual Budget password is very short, ensure it is correct');
    }

    // Validate Xano credentials
    if (config.xano_api_url) {
      try {
        const url = new URL(config.xano_api_url);
        if (url.protocol !== 'https:') {
          warnings.push('Xano API URL should use HTTPS for security');
        }
        if (!url.hostname.includes('xano')) {
          warnings.push('Xano API URL does not appear to be a Xano endpoint');
        }
      } catch (e) {
        errors.push('Xano API URL is not a valid URL');
      }
    }

    if (config.xano_api_key && config.xano_api_key.length < 20) {
      warnings.push('Xano API key appears to be too short, ensure it is correct');
    }

    // Validate Xero credentials
    if (config.xero_client_id && !/^[a-f0-9-]{36}$/i.test(config.xero_client_id)) {
      warnings.push('Xero Client ID does not match expected UUID format');
    }

    if (config.xero_client_secret && config.xero_client_secret.length < 20) {
      warnings.push('Xero Client Secret appears to be too short, ensure it is correct');
    }

    if (config.xero_tenant_id && !/^[a-f0-9-]{36}$/i.test(config.xero_tenant_id)) {
      warnings.push('Xero Tenant ID does not match expected UUID format');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get configuration summary for logging/display
   * @param {Object} config - Configuration object
   * @returns {Object} - Configuration summary (without sensitive data)
   */
  static getConfigSummary(config) {
    return {
      actual_budget_url: config.actual_budget_url,
      business_category_group_id: config.business_category_group_id || 'Not set',
      business_category_group_name: config.business_category_group_name,
      xano_api_url: config.xano_api_url,
      xano_rate_limit: config.xano_rate_limit,
      xero_client_id: config.xero_client_id ? `${config.xero_client_id.substring(0, 8)}...` : 'Not set',
      xero_tenant_id: config.xero_tenant_id ? `${config.xero_tenant_id.substring(0, 8)}...` : 'Not set',
      sync_schedule: config.sync_schedule,
      sync_days_back: config.sync_days_back,
      batch_size: config.batch_size,
      log_level: config.log_level,
      // Sensitive fields are masked
      actual_budget_password: config.actual_budget_password ? '[SET]' : '[NOT SET]',
      xano_api_key: config.xano_api_key ? '[SET]' : '[NOT SET]',
      xero_client_secret: config.xero_client_secret ? '[SET]' : '[NOT SET]'
    };
  }

  /**
   * Parse Home Assistant options into config format
   * @param {Object} options - Home Assistant add-on options
   * @returns {Object} - Configuration object
   */
  static parseHomeAssistantOptions(options) {
    return {
      actual_budget_url: options.actual_budget_url,
      actual_budget_password: options.actual_budget_password,
      business_category_group_id: options.business_category_group_id || '',
      business_category_group_name: options.business_category_group_name,
      xano_api_url: options.xano_api_url,
      xano_api_key: options.xano_api_key,
      xano_rate_limit: options.xano_rate_limit || 18,
      xero_client_id: options.xero_client_id,
      xero_client_secret: options.xero_client_secret,
      xero_tenant_id: options.xero_tenant_id,
      sync_schedule: options.sync_schedule || '0 2 * * 1',
      sync_days_back: options.sync_days_back || 7,
      batch_size: options.batch_size || 10,
      log_level: options.log_level || 'info'
    };
  }

  /**
   * Validate category group configuration
   * @param {Object} config - Configuration object
   * @returns {Object} - Category group validation result
   */
  static validateCategoryGroup(config) {
    const errors = [];
    const warnings = [];

    // Check if either ID or name is provided
    if (!config.business_category_group_id && !config.business_category_group_name) {
      errors.push('Either business_category_group_id or business_category_group_name must be provided');
    }

    // If both are provided, warn about precedence
    if (config.business_category_group_id && config.business_category_group_name) {
      warnings.push('Both category group ID and name provided - ID will take precedence');
    }

    // Validate ID format if provided
    if (config.business_category_group_id && config.business_category_group_id.trim()) {
      if (!/^[a-zA-Z0-9-_]+$/.test(config.business_category_group_id)) {
        warnings.push('Category group ID contains unusual characters');
      }
    }

    // Validate name if provided
    if (config.business_category_group_name && config.business_category_group_name.trim()) {
      if (config.business_category_group_name.length < 2) {
        errors.push('Category group name must be at least 2 characters long');
      }
      if (config.business_category_group_name.length > 50) {
        warnings.push('Category group name is very long, ensure it is correct');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      useId: !!(config.business_category_group_id && config.business_category_group_id.trim()),
      useName: !!(config.business_category_group_name && config.business_category_group_name.trim())
    };
  }

  /**
   * Perform comprehensive configuration validation
   * @param {Object} config - Configuration object
   * @returns {Object} - Comprehensive validation result
   */
  static validateComprehensive(config) {
    // Basic schema validation
    const schemaValidation = this.validate(config);
    if (!schemaValidation.isValid) {
      return schemaValidation;
    }

    // Additional validations
    const apiValidation = this.validateApiCredentials(config);
    const categoryValidation = this.validateCategoryGroup(config);

    const allErrors = [
      ...apiValidation.errors,
      ...categoryValidation.errors
    ];

    const allWarnings = [
      ...apiValidation.warnings,
      ...categoryValidation.warnings
    ];

    return {
      isValid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
      config: schemaValidation.config,
      categoryGroupStrategy: {
        useId: categoryValidation.useId,
        useName: categoryValidation.useName
      }
    };
  }
}

module.exports = ConfigValidator;
