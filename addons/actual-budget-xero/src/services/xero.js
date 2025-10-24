const BaseApiClient = require('../utils/base-api-client');
const { AuthorizationCode } = require('simple-oauth2');
const crypto = require('crypto');

/**
 * XeroClient - API client for Xero with OAuth 2.0 authentication
 * 
 * Handles OAuth flow, transaction creation, account/contact search and creation,
 * with comprehensive error handling and Xero-specific formatting
 */
class XeroClient extends BaseApiClient {
  constructor(options = {}) {
    const { clientId, clientSecret, tenantId, redirectUri, ...baseOptions } = options;
    
    // Initialize base client with Xero API defaults
    super({
      baseUrl: 'https://api.xero.com/api.xro/2.0',
      timeout: 60000, // Xero can be slow
      defaultHeaders: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      ...baseOptions
    });

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.tenantId = tenantId;
    this.redirectUri = redirectUri || 'http://localhost:8080/callback';
    
    // OAuth 2.0 configuration
    this.oauthConfig = {
      client: {
        id: this.clientId,
        secret: this.clientSecret
      },
      auth: {
        tokenHost: 'https://identity.xero.com',
        tokenPath: '/connect/token',
        authorizePath: '/connect/authorize'
      }
    };

    this.oauth2Client = new AuthorizationCode(this.oauthConfig);
    this.accessToken = null;
    this.tokenExpiresAt = null;

    // Xero-specific statistics
    this.xeroStats = {
      transactionsCreated: 0,
      accountsSearched: 0,
      contactsSearched: 0,
      accountsCreated: 0,
      contactsCreated: 0,
      tokenRefreshes: 0
    };
  }

  /**
   * Generate OAuth 2.0 authorization URL
   * @param {string} state - State parameter for security
   * @returns {string} - Authorization URL
   */
  getAuthorizationUrl(state = null) {
    const authState = state || crypto.randomBytes(16).toString('hex');
    
    const authorizationUri = this.oauth2Client.authorizeURL({
      redirect_uri: this.redirectUri,
      scope: 'accounting.transactions accounting.contacts accounting.settings',
      state: authState
    });

    this.logger.info(`Generated Xero authorization URL with state: ${authState}`);
    return { url: authorizationUri, state: authState };
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code from callback
   * @param {string} state - State parameter for verification
   * @returns {Promise<Object>} - Token information
   */
  async exchangeCodeForToken(code, state) {
    try {
      const tokenParams = {
        code,
        redirect_uri: this.redirectUri,
        scope: 'accounting.transactions accounting.contacts accounting.settings'
      };

      const accessToken = await this.oauth2Client.getToken(tokenParams);
      
      this.accessToken = accessToken.token;
      this.tokenExpiresAt = new Date(Date.now() + (this.accessToken.expires_in * 1000));
      
      this.logger.info(`Successfully obtained Xero access token, expires at: ${this.tokenExpiresAt.toISOString()}`);
      
      return {
        access_token: this.accessToken.access_token,
        refresh_token: this.accessToken.refresh_token,
        expires_at: this.tokenExpiresAt,
        scope: this.accessToken.scope
      };
    } catch (error) {
      this.logger.error(`Failed to exchange code for token: ${error.message}`);
      throw this.createXeroError('TOKEN_EXCHANGE_FAILED', error, { code, state });
    }
  }

  /**
   * Set access token directly (for stored tokens)
   * @param {Object} tokenData - Token data
   * @param {string} tokenData.access_token - Access token
   * @param {string} tokenData.refresh_token - Refresh token
   * @param {Date|string} tokenData.expires_at - Token expiration
   */
  setAccessToken(tokenData) {
    this.accessToken = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: Math.floor((new Date(tokenData.expires_at) - Date.now()) / 1000)
    };
    
    this.tokenExpiresAt = new Date(tokenData.expires_at);
    this.logger.info(`Set Xero access token, expires at: ${this.tokenExpiresAt.toISOString()}`);
  }

  /**
   * Refresh access token using refresh token
   * @returns {Promise<Object>} - New token information
   */
  async refreshAccessToken() {
    if (!this.accessToken?.refresh_token) {
      throw this.createXeroError('NO_REFRESH_TOKEN', new Error('No refresh token available'));
    }

    try {
      const refreshParams = {
        refresh_token: this.accessToken.refresh_token
      };

      const newAccessToken = await this.oauth2Client.getToken(refreshParams);
      
      this.accessToken = newAccessToken.token;
      this.tokenExpiresAt = new Date(Date.now() + (this.accessToken.expires_in * 1000));
      this.xeroStats.tokenRefreshes++;
      
      this.logger.info(`Successfully refreshed Xero access token, expires at: ${this.tokenExpiresAt.toISOString()}`);
      
      return {
        access_token: this.accessToken.access_token,
        refresh_token: this.accessToken.refresh_token,
        expires_at: this.tokenExpiresAt,
        scope: this.accessToken.scope
      };
    } catch (error) {
      this.logger.error(`Failed to refresh access token: ${error.message}`);
      throw this.createXeroError('TOKEN_REFRESH_FAILED', error);
    }
  }

  /**
   * Ensure valid access token, refreshing if necessary
   * @returns {Promise<void>}
   */
  async ensureValidToken() {
    if (!this.accessToken) {
      throw this.createXeroError('NO_ACCESS_TOKEN', new Error('No access token available. Please authenticate first.'));
    }

    // Check if token is expired or will expire in the next 5 minutes
    const expirationBuffer = 5 * 60 * 1000; // 5 minutes in milliseconds
    const now = Date.now();
    
    if (this.tokenExpiresAt && (this.tokenExpiresAt.getTime() - now) < expirationBuffer) {
      this.logger.info('Access token is expired or expiring soon, refreshing...');
      await this.refreshAccessToken();
    }
  }

  /**
   * Override makeRequest to handle OAuth authentication
   * @param {string} method - HTTP method
   * @param {string} path - API endpoint path
   * @param {Object} data - Request body data
   * @param {Object} options - Request options
   * @returns {Promise<Object>} - Response data
   */
  async makeRequest(method, path, data = null, options = {}) {
    await this.ensureValidToken();
    
    // Add OAuth token and tenant ID to headers
    const authHeaders = {
      'Authorization': `Bearer ${this.accessToken.access_token}`,
      'Xero-tenant-id': this.tenantId,
      ...options.headers
    };

    return super.makeRequest(method, path, data, { ...options, headers: authHeaders });
  }

  /**
   * Create transaction in Xero
   * @param {Object} transactionData - Transaction data from Xano
   * @param {string} transactionData.xano_id - Xano transaction ID for reference
   * @param {number} transactionData.amount - Transaction amount
   * @param {string} transactionData.description - Transaction description
   * @param {string} transactionData.transaction_date - Transaction date (YYYY-MM-DD)
   * @param {string} transactionData.xero_account_id - Xero account ID
   * @param {string} transactionData.xero_contact_id - Xero contact ID
   * @returns {Promise<Object>} - Created transaction with Xero ID
   */
  async createTransaction(transactionData) {
    const xeroTransaction = this.formatTransactionForXero(transactionData);
    
    try {
      const result = await this.put('/BankTransactions', {
        BankTransactions: [xeroTransaction]
      });

      this.xeroStats.transactionsCreated++;
      
      const createdTransaction = result.data.BankTransactions[0];
      this.logger.info(`Created Xero transaction: ${createdTransaction.BankTransactionID} (Reference: ${xeroTransaction.Reference})`);
      
      return {
        xero_transaction_id: createdTransaction.BankTransactionID,
        xero_reference: createdTransaction.Reference,
        xero_status: createdTransaction.Status,
        xero_total: createdTransaction.Total,
        xero_date: createdTransaction.Date
      };
    } catch (error) {
      this.logger.error(`Failed to create Xero transaction for Xano ID ${transactionData.xano_id}: ${error.message}`);
      throw this.createXeroError('TRANSACTION_CREATE_FAILED', error, { transactionData });
    }
  }

  /**
   * Search for accounts in Xero by name
   * @param {string} accountName - Account name to search for
   * @param {Object} options - Search options
   * @param {boolean} options.exactMatch - Whether to search for exact matches only
   * @param {number} options.limit - Maximum number of results
   * @returns {Promise<Object[]>} - Array of matching accounts
   */
  async searchAccounts(accountName, options = {}) {
    if (!accountName || typeof accountName !== 'string') {
      return [];
    }

    const searchName = accountName.trim();
    if (searchName.length === 0) {
      return [];
    }

    try {
      // Use Xero's where parameter for filtering
      const whereClause = options.exactMatch 
        ? `Name="${searchName.replace(/"/g, '\\"')}"` 
        : `Name.Contains("${searchName.replace(/"/g, '\\"')}")`;
      
      const queryParams = {
        where: whereClause
      };

      const result = await this.get('/Accounts', { queryParams });
      
      this.xeroStats.accountsSearched++;
      
      const accounts = result.data.Accounts || [];
      const limitedAccounts = options.limit ? accounts.slice(0, options.limit) : accounts;
      
      this.logger.debug(`Found ${limitedAccounts.length} accounts matching "${searchName}"`);
      
      return limitedAccounts.map(account => ({
        xero_account_id: account.AccountID,
        name: account.Name,
        code: account.Code,
        type: account.Type,
        status: account.Status,
        description: account.Description
      }));
    } catch (error) {
      this.logger.error(`Failed to search accounts for "${accountName}": ${error.message}`);
      throw this.createXeroError('ACCOUNT_SEARCH_FAILED', error, { accountName, options });
    }
  }

  /**
   * Search for contacts in Xero by name
   * @param {string} contactName - Contact name to search for
   * @param {Object} options - Search options
   * @param {boolean} options.exactMatch - Whether to search for exact matches only
   * @param {number} options.limit - Maximum number of results
   * @returns {Promise<Object[]>} - Array of matching contacts
   */
  async searchContacts(contactName, options = {}) {
    if (!contactName || typeof contactName !== 'string') {
      return [];
    }

    const searchName = contactName.trim();
    if (searchName.length === 0) {
      return [];
    }

    try {
      // Use Xero's where parameter for filtering
      const whereClause = options.exactMatch 
        ? `Name="${searchName.replace(/"/g, '\\"')}"` 
        : `Name.Contains("${searchName.replace(/"/g, '\\"')}")`;
      
      const queryParams = {
        where: whereClause
      };

      const result = await this.get('/Contacts', { queryParams });
      
      this.xeroStats.contactsSearched++;
      
      const contacts = result.data.Contacts || [];
      const limitedContacts = options.limit ? contacts.slice(0, options.limit) : contacts;
      
      this.logger.debug(`Found ${limitedContacts.length} contacts matching "${searchName}"`);
      
      return limitedContacts.map(contact => ({
        xero_contact_id: contact.ContactID,
        name: contact.Name,
        email: contact.EmailAddress,
        status: contact.ContactStatus,
        is_supplier: contact.IsSupplier,
        is_customer: contact.IsCustomer
      }));
    } catch (error) {
      this.logger.error(`Failed to search contacts for "${contactName}": ${error.message}`);
      throw this.createXeroError('CONTACT_SEARCH_FAILED', error, { contactName, options });
    }
  }

  /**
   * Create new account in Xero
   * @param {Object} accountData - Account data
   * @param {string} accountData.name - Account name
   * @param {string} accountData.code - Account code (optional, will be auto-generated)
   * @param {string} accountData.type - Account type (EXPENSE, REVENUE, etc.)
   * @param {string} accountData.description - Account description (optional)
   * @returns {Promise<Object>} - Created account
   */
  async createAccount(accountData) {
    const xeroAccount = {
      Name: accountData.name,
      Type: accountData.type || 'EXPENSE',
      Code: accountData.code || undefined, // Let Xero auto-generate if not provided
      Description: accountData.description || undefined
    };

    try {
      const result = await this.put('/Accounts', {
        Accounts: [xeroAccount]
      });

      this.xeroStats.accountsCreated++;
      
      const createdAccount = result.data.Accounts[0];
      this.logger.info(`Created Xero account: ${createdAccount.Name} (${createdAccount.Code})`);
      
      return {
        xero_account_id: createdAccount.AccountID,
        name: createdAccount.Name,
        code: createdAccount.Code,
        type: createdAccount.Type,
        status: createdAccount.Status,
        description: createdAccount.Description
      };
    } catch (error) {
      this.logger.error(`Failed to create Xero account "${accountData.name}": ${error.message}`);
      throw this.createXeroError('ACCOUNT_CREATE_FAILED', error, { accountData });
    }
  }

  /**
   * Create new contact in Xero
   * @param {Object} contactData - Contact data
   * @param {string} contactData.name - Contact name
   * @param {string} contactData.email - Contact email (optional)
   * @param {boolean} contactData.is_supplier - Whether contact is a supplier
   * @param {boolean} contactData.is_customer - Whether contact is a customer
   * @returns {Promise<Object>} - Created contact
   */
  async createContact(contactData) {
    const xeroContact = {
      Name: contactData.name,
      EmailAddress: contactData.email || undefined,
      IsSupplier: contactData.is_supplier !== undefined ? contactData.is_supplier : true,
      IsCustomer: contactData.is_customer !== undefined ? contactData.is_customer : false
    };

    try {
      const result = await this.put('/Contacts', {
        Contacts: [xeroContact]
      });

      this.xeroStats.contactsCreated++;
      
      const createdContact = result.data.Contacts[0];
      this.logger.info(`Created Xero contact: ${createdContact.Name}`);
      
      return {
        xero_contact_id: createdContact.ContactID,
        name: createdContact.Name,
        email: createdContact.EmailAddress,
        status: createdContact.ContactStatus,
        is_supplier: createdContact.IsSupplier,
        is_customer: createdContact.IsCustomer
      };
    } catch (error) {
      this.logger.error(`Failed to create Xero contact "${contactData.name}": ${error.message}`);
      throw this.createXeroError('CONTACT_CREATE_FAILED', error, { contactData });
    }
  }

  /**
   * Format transaction data for Xero API
   * @param {Object} transactionData - Transaction data from Xano
   * @returns {Object} - Xero-formatted transaction
   */
  formatTransactionForXero(transactionData) {
    // Generate reference using Xano ID
    const reference = `Xano-${transactionData.xano_id}`;
    
    // Format date for Xero (YYYY-MM-DD)
    const transactionDate = new Date(transactionData.transaction_date).toISOString().split('T')[0];
    
    // Determine transaction type based on amount
    const isSpend = transactionData.amount < 0;
    const absoluteAmount = Math.abs(transactionData.amount);
    
    return {
      Type: isSpend ? 'SPEND' : 'RECEIVE',
      Contact: {
        ContactID: transactionData.xero_contact_id
      },
      LineItems: [{
        Description: transactionData.description || 'Imported from Actual Budget',
        Quantity: 1,
        UnitAmount: absoluteAmount,
        AccountCode: transactionData.xero_account_code || undefined,
        AccountID: transactionData.xero_account_id
      }],
      Date: transactionDate,
      Reference: reference,
      Status: 'AUTHORISED' // Automatically authorize the transaction
    };
  }

  /**
   * Get organization information (useful for validation)
   * @returns {Promise<Object>} - Organization details
   */
  async getOrganization() {
    try {
      const result = await this.get('/Organisation');
      const org = result.data.Organisations[0];
      
      return {
        name: org.Name,
        legal_name: org.LegalName,
        country_code: org.CountryCode,
        currency_code: org.BaseCurrency,
        organisation_id: org.OrganisationID,
        short_code: org.ShortCode
      };
    } catch (error) {
      this.logger.error(`Failed to get organization info: ${error.message}`);
      throw this.createXeroError('ORGANIZATION_INFO_FAILED', error);
    }
  }

  /**
   * Validate connection and permissions
   * @returns {Promise<Object>} - Connection status and permissions
   */
  async validateConnection() {
    try {
      await this.ensureValidToken();
      
      // Test basic API access
      const org = await this.getOrganization();
      
      // Test permissions by attempting to read accounts (minimal operation)
      await this.get('/Accounts', { queryParams: { page: 1 } });
      
      this.logger.info(`Successfully validated Xero connection for: ${org.name}`);
      
      return {
        connected: true,
        organization: org,
        token_expires_at: this.tokenExpiresAt,
        permissions: ['accounting.transactions', 'accounting.contacts', 'accounting.settings']
      };
    } catch (error) {
      this.logger.error(`Xero connection validation failed: ${error.message}`);
      return {
        connected: false,
        error: error.message,
        token_expires_at: this.tokenExpiresAt
      };
    }
  }

  /**
   * Create Xero-specific error with context
   * @param {string} code - Error code
   * @param {Error} originalError - Original error
   * @param {Object} context - Additional context
   * @returns {Error} - Xero error
   */
  createXeroError(code, originalError, context = {}) {
    const error = new Error(`Xero API Error [${code}]: ${originalError.message}`);
    error.name = 'XeroError';
    error.code = code;
    error.originalError = originalError;
    error.context = context;
    
    // Copy relevant properties from original error
    if (originalError.statusCode) error.statusCode = originalError.statusCode;
    if (originalError.response) error.response = originalError.response;
    
    return error;
  }

  /**
   * Get comprehensive client status including OAuth token info
   * @returns {Object} - Client status and statistics
   */
  getStatus() {
    return {
      client: this.getStats(),
      oauth: {
        hasToken: !!this.accessToken,
        tokenExpiresAt: this.tokenExpiresAt,
        tenantId: this.tenantId
      },
      xero: { ...this.xeroStats }
    };
  }

  /**
   * Find or create account with fuzzy matching
   * @param {string} accountName - Account name to find or create
   * @param {Object} options - Search and creation options
   * @param {string} options.type - Account type for creation (default: 'EXPENSE')
   * @param {number} options.matchThreshold - Fuzzy match threshold (0-1, default: 0.8)
   * @param {boolean} options.autoCreate - Whether to auto-create if not found
   * @returns {Promise<Object>} - Found or created account
   */
  async findOrCreateAccount(accountName, options = {}) {
    if (!accountName || typeof accountName !== 'string') {
      throw this.createXeroError('INVALID_ACCOUNT_NAME', new Error('Account name is required'));
    }

    const cleanName = accountName.trim();
    const matchThreshold = options.matchThreshold || 0.8;
    const autoCreate = options.autoCreate !== false; // Default to true

    try {
      // First try exact match
      let accounts = await this.searchAccounts(cleanName, { exactMatch: true, limit: 1 });
      
      if (accounts.length > 0) {
        this.logger.debug(`Found exact account match for "${cleanName}": ${accounts[0].name}`);
        return accounts[0];
      }

      // Try fuzzy search
      accounts = await this.searchAccounts(cleanName, { exactMatch: false, limit: 10 });
      
      if (accounts.length > 0) {
        // Find best fuzzy match
        const bestMatch = this.findBestFuzzyMatch(cleanName, accounts, matchThreshold);
        
        if (bestMatch) {
          this.logger.info(`Found fuzzy account match for "${cleanName}": ${bestMatch.match.name} (score: ${bestMatch.score.toFixed(2)})`);
          return bestMatch.match;
        }
      }

      // No good match found, create new account if allowed
      if (autoCreate) {
        this.logger.info(`No account match found for "${cleanName}", creating new account`);
        
        const newAccount = await this.createAccount({
          name: cleanName,
          type: options.type || 'EXPENSE',
          description: `Auto-created from Actual Budget sync`
        });
        
        return newAccount;
      } else {
        this.logger.warn(`No account match found for "${cleanName}" and auto-create is disabled`);
        return null;
      }
    } catch (error) {
      this.logger.error(`Failed to find or create account "${cleanName}": ${error.message}`);
      throw this.createXeroError('FIND_OR_CREATE_ACCOUNT_FAILED', error, { accountName, options });
    }
  }

  /**
   * Find or create contact with fuzzy matching
   * @param {string} contactName - Contact name to find or create
   * @param {Object} options - Search and creation options
   * @param {boolean} options.isSupplier - Whether contact is a supplier (default: true)
   * @param {boolean} options.isCustomer - Whether contact is a customer (default: false)
   * @param {number} options.matchThreshold - Fuzzy match threshold (0-1, default: 0.8)
   * @param {boolean} options.autoCreate - Whether to auto-create if not found
   * @returns {Promise<Object>} - Found or created contact
   */
  async findOrCreateContact(contactName, options = {}) {
    if (!contactName || typeof contactName !== 'string') {
      throw this.createXeroError('INVALID_CONTACT_NAME', new Error('Contact name is required'));
    }

    const cleanName = contactName.trim();
    const matchThreshold = options.matchThreshold || 0.8;
    const autoCreate = options.autoCreate !== false; // Default to true

    try {
      // First try exact match
      let contacts = await this.searchContacts(cleanName, { exactMatch: true, limit: 1 });
      
      if (contacts.length > 0) {
        this.logger.debug(`Found exact contact match for "${cleanName}": ${contacts[0].name}`);
        return contacts[0];
      }

      // Try fuzzy search
      contacts = await this.searchContacts(cleanName, { exactMatch: false, limit: 10 });
      
      if (contacts.length > 0) {
        // Find best fuzzy match
        const bestMatch = this.findBestFuzzyMatch(cleanName, contacts, matchThreshold);
        
        if (bestMatch) {
          this.logger.info(`Found fuzzy contact match for "${cleanName}": ${bestMatch.match.name} (score: ${bestMatch.score.toFixed(2)})`);
          return bestMatch.match;
        }
      }

      // No good match found, create new contact if allowed
      if (autoCreate) {
        this.logger.info(`No contact match found for "${cleanName}", creating new contact`);
        
        const newContact = await this.createContact({
          name: cleanName,
          is_supplier: options.isSupplier !== false, // Default to true
          is_customer: options.isCustomer || false
        });
        
        return newContact;
      } else {
        this.logger.warn(`No contact match found for "${cleanName}" and auto-create is disabled`);
        return null;
      }
    } catch (error) {
      this.logger.error(`Failed to find or create contact "${cleanName}": ${error.message}`);
      throw this.createXeroError('FIND_OR_CREATE_CONTACT_FAILED', error, { contactName, options });
    }
  }

  /**
   * Batch resolve mappings for categories and payees
   * @param {Object[]} categoryMappings - Array of category mappings to resolve
   * @param {Object[]} payeeMappings - Array of payee mappings to resolve
   * @param {Object} options - Resolution options
   * @param {boolean} options.autoCreate - Whether to auto-create missing entities
   * @param {number} options.matchThreshold - Fuzzy match threshold
   * @returns {Promise<Object>} - Resolution results
   */
  async batchResolveMappings(categoryMappings = [], payeeMappings = [], options = {}) {
    const results = {
      categories: {
        resolved: [],
        failed: [],
        created: []
      },
      payees: {
        resolved: [],
        failed: [],
        created: []
      }
    };

    // Process category mappings
    for (const categoryMapping of categoryMappings) {
      try {
        if (!categoryMapping.xero_account_id && categoryMapping.actual_category_name) {
          const account = await this.findOrCreateAccount(categoryMapping.actual_category_name, {
            type: 'EXPENSE',
            autoCreate: options.autoCreate !== false,
            matchThreshold: options.matchThreshold
          });

          if (account) {
            const resolvedMapping = {
              ...categoryMapping,
              xero_account_id: account.xero_account_id,
              xero_account_name: account.name,
              xero_account_code: account.code
            };

            results.categories.resolved.push(resolvedMapping);
            
            // Track if this was a newly created account
            if (account.status === 'ACTIVE' && !categoryMapping.xero_account_id) {
              results.categories.created.push(account);
            }
          } else {
            results.categories.failed.push({
              mapping: categoryMapping,
              error: 'No match found and auto-create disabled'
            });
          }
        } else {
          // Already has mapping, just pass through
          results.categories.resolved.push(categoryMapping);
        }
      } catch (error) {
        this.logger.error(`Failed to resolve category mapping for "${categoryMapping.actual_category_name}": ${error.message}`);
        results.categories.failed.push({
          mapping: categoryMapping,
          error: error.message
        });
      }
    }

    // Process payee mappings
    for (const payeeMapping of payeeMappings) {
      try {
        if (!payeeMapping.xero_contact_id && payeeMapping.actual_payee_name) {
          const contact = await this.findOrCreateContact(payeeMapping.actual_payee_name, {
            isSupplier: true,
            isCustomer: false,
            autoCreate: options.autoCreate !== false,
            matchThreshold: options.matchThreshold
          });

          if (contact) {
            const resolvedMapping = {
              ...payeeMapping,
              xero_contact_id: contact.xero_contact_id,
              xero_contact_name: contact.name
            };

            results.payees.resolved.push(resolvedMapping);
            
            // Track if this was a newly created contact
            if (contact.status === 'ACTIVE' && !payeeMapping.xero_contact_id) {
              results.payees.created.push(contact);
            }
          } else {
            results.payees.failed.push({
              mapping: payeeMapping,
              error: 'No match found and auto-create disabled'
            });
          }
        } else {
          // Already has mapping, just pass through
          results.payees.resolved.push(payeeMapping);
        }
      } catch (error) {
        this.logger.error(`Failed to resolve payee mapping for "${payeeMapping.actual_payee_name}": ${error.message}`);
        results.payees.failed.push({
          mapping: payeeMapping,
          error: error.message
        });
      }
    }

    this.logger.info(`Batch mapping resolution complete: ${results.categories.resolved.length} categories, ${results.payees.resolved.length} payees resolved`);
    
    return results;
  }

  /**
   * Update Xano mappings with resolved Xero IDs
   * @param {Object} xanoClient - Xano client instance
   * @param {Object} resolvedMappings - Resolved mappings from batchResolveMappings
   * @returns {Promise<Object>} - Update results
   */
  async updateXanoMappings(xanoClient, resolvedMappings) {
    if (!xanoClient) {
      throw this.createXeroError('NO_XANO_CLIENT', new Error('Xano client is required'));
    }

    const results = {
      categories: {
        updated: [],
        failed: []
      },
      payees: {
        updated: [],
        failed: []
      }
    };

    try {
      // Update category mappings
      if (resolvedMappings.categories.resolved.length > 0) {
        const categoryUpdates = resolvedMappings.categories.resolved
          .filter(mapping => mapping.xero_account_id) // Only update mappings with Xero IDs
          .map(mapping => ({
            actual_category_id: mapping.actual_category_id,
            actual_category_name: mapping.actual_category_name,
            xero_account_id: mapping.xero_account_id,
            xero_account_name: mapping.xero_account_name,
            xero_account_code: mapping.xero_account_code,
            is_active: true
          }));

        if (categoryUpdates.length > 0) {
          const categoryResult = await xanoClient.bulkUpsertCategoryMappings(categoryUpdates);
          results.categories.updated = categoryResult.created.concat(categoryResult.updated);
          results.categories.failed = categoryResult.errors;
        }
      }

      // Update payee mappings
      if (resolvedMappings.payees.resolved.length > 0) {
        const payeeUpdates = resolvedMappings.payees.resolved
          .filter(mapping => mapping.xero_contact_id) // Only update mappings with Xero IDs
          .map(mapping => ({
            actual_payee_id: mapping.actual_payee_id,
            actual_payee_name: mapping.actual_payee_name,
            xero_contact_id: mapping.xero_contact_id,
            xero_contact_name: mapping.xero_contact_name,
            is_active: true
          }));

        if (payeeUpdates.length > 0) {
          const payeeResult = await xanoClient.bulkUpsertPayeeMappings(payeeUpdates);
          results.payees.updated = payeeResult.created.concat(payeeResult.updated);
          results.payees.failed = payeeResult.errors;
        }
      }

      this.logger.info(`Updated Xano mappings: ${results.categories.updated.length} categories, ${results.payees.updated.length} payees`);
      
      return results;
    } catch (error) {
      this.logger.error(`Failed to update Xano mappings: ${error.message}`);
      throw this.createXeroError('XANO_MAPPING_UPDATE_FAILED', error, { resolvedMappings });
    }
  }

  /**
   * Find best fuzzy match from a list of candidates
   * @param {string} searchTerm - Term to match against
   * @param {Object[]} candidates - Array of candidates with 'name' property
   * @param {number} threshold - Minimum similarity score (0-1)
   * @returns {Object|null} - Best match with score, or null if no good match
   */
  findBestFuzzyMatch(searchTerm, candidates, threshold = 0.8) {
    if (!searchTerm || !candidates || candidates.length === 0) {
      return null;
    }

    const searchLower = searchTerm.toLowerCase().trim();
    let bestMatch = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      if (!candidate.name) continue;
      
      const candidateLower = candidate.name.toLowerCase().trim();
      const score = this.calculateSimilarity(searchLower, candidateLower);
      
      if (score > bestScore && score >= threshold) {
        bestScore = score;
        bestMatch = candidate;
      }
    }

    return bestMatch ? { match: bestMatch, score: bestScore } : null;
  }

  /**
   * Calculate similarity between two strings using Levenshtein distance
   * @param {string} str1 - First string
   * @param {string} str2 - Second string
   * @returns {number} - Similarity score (0-1, where 1 is identical)
   */
  calculateSimilarity(str1, str2) {
    if (str1 === str2) return 1;
    if (str1.length === 0 || str2.length === 0) return 0;

    // Check for substring matches (higher weight)
    if (str1.includes(str2) || str2.includes(str1)) {
      const longer = str1.length > str2.length ? str1 : str2;
      const shorter = str1.length > str2.length ? str2 : str1;
      return 0.8 + (0.2 * (shorter.length / longer.length));
    }

    // Calculate Levenshtein distance
    const matrix = [];
    const len1 = str1.length;
    const len2 = str2.length;

    // Initialize matrix
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,     // deletion
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    const distance = matrix[len1][len2];
    const maxLength = Math.max(len1, len2);
    
    return 1 - (distance / maxLength);
  }

  /**
   * Validate and sanitize account name for Xero
   * @param {string} accountName - Raw account name
   * @returns {string} - Sanitized account name
   */
  sanitizeAccountName(accountName) {
    if (!accountName || typeof accountName !== 'string') {
      return 'Unnamed Account';
    }

    // Remove or replace invalid characters
    let sanitized = accountName
      .trim()
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/\s+/g, ' ') // Normalize whitespace
      .substring(0, 150); // Xero account name limit

    // Ensure it's not empty after sanitization
    if (sanitized.length === 0) {
      sanitized = 'Unnamed Account';
    }

    return sanitized;
  }

  /**
   * Validate and sanitize contact name for Xero
   * @param {string} contactName - Raw contact name
   * @returns {string} - Sanitized contact name
   */
  sanitizeContactName(contactName) {
    if (!contactName || typeof contactName !== 'string') {
      return 'Unnamed Contact';
    }

    // Remove or replace invalid characters
    let sanitized = contactName
      .trim()
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/\s+/g, ' ') // Normalize whitespace
      .substring(0, 255); // Xero contact name limit

    // Ensure it's not empty after sanitization
    if (sanitized.length === 0) {
      sanitized = 'Unnamed Contact';
    }

    return sanitized;
  }

  /**
   * Reset all statistics
   */
  resetStats() {
    super.resetStats();
    this.xeroStats = {
      transactionsCreated: 0,
      accountsSearched: 0,
      contactsSearched: 0,
      accountsCreated: 0,
      contactsCreated: 0,
      tokenRefreshes: 0
    };
  }
}

module.exports = XeroClient;