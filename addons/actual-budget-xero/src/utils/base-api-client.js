const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * BaseApiClient - Foundation class for API clients with comprehensive error handling
 * 
 * Provides common HTTP methods, error handling, and retry logic for API integrations
 */
class BaseApiClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl;
    this.timeout = options.timeout || 30000; // 30 seconds default
    this.defaultHeaders = options.defaultHeaders || {};
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.logger = options.logger || console;
    
    // Request statistics
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retriedRequests: 0
    };
  }

  /**
   * Make HTTP GET request
   * @param {string} path - API endpoint path
   * @param {Object} options - Request options
   * @returns {Promise<Object>} - Response data
   */
  async get(path, options = {}) {
    return this.makeRequest('GET', path, null, options);
  }

  /**
   * Make HTTP POST request
   * @param {string} path - API endpoint path
   * @param {Object} data - Request body data
   * @param {Object} options - Request options
   * @returns {Promise<Object>} - Response data
   */
  async post(path, data, options = {}) {
    return this.makeRequest('POST', path, data, options);
  }

  /**
   * Make HTTP PUT request
   * @param {string} path - API endpoint path
   * @param {Object} data - Request body data
   * @param {Object} options - Request options
   * @returns {Promise<Object>} - Response data
   */
  async put(path, data, options = {}) {
    return this.makeRequest('PUT', path, data, options);
  }

  /**
   * Make HTTP DELETE request
   * @param {string} path - API endpoint path
   * @param {Object} options - Request options
   * @returns {Promise<Object>} - Response data
   */
  async delete(path, options = {}) {
    return this.makeRequest('DELETE', path, null, options);
  }

  /**
   * Make HTTP PATCH request
   * @param {string} path - API endpoint path
   * @param {Object} data - Request body data
   * @param {Object} options - Request options
   * @returns {Promise<Object>} - Response data
   */
  async patch(path, data, options = {}) {
    return this.makeRequest('PATCH', path, data, options);
  }

  /**
   * Make HTTP request with error handling and retry logic
   * @param {string} method - HTTP method
   * @param {string} path - API endpoint path
   * @param {Object} data - Request body data
   * @param {Object} options - Request options
   * @returns {Promise<Object>} - Response data
   */
  async makeRequest(method, path, data = null, options = {}) {
    const url = this.buildUrl(path, options.queryParams);
    const requestOptions = this.buildRequestOptions(method, url, data, options);
    
    let lastError;
    const maxRetries = options.maxRetries !== undefined ? options.maxRetries : this.maxRetries;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        this.stats.totalRequests++;
        
        if (attempt > 1) {
          this.stats.retriedRequests++;
          this.logger.info(`Retrying request (attempt ${attempt}/${maxRetries + 1}): ${method} ${url}`);
        }

        const response = await this.executeRequest(requestOptions, data);
        this.stats.successfulRequests++;
        
        return this.handleResponse(response, requestOptions);
      } catch (error) {
        lastError = error;
        this.stats.failedRequests++;

        // Don't retry on the last attempt or for non-retryable errors
        if (attempt > maxRetries || !this.isRetryableError(error)) {
          break;
        }

        // Wait before retry with exponential backoff
        const delay = this.calculateRetryDelay(attempt);
        this.logger.warn(`Request failed (attempt ${attempt}/${maxRetries + 1}): ${error.message}. Retrying in ${delay}ms`);
        await this.wait(delay);
      }
    }

    // All retries exhausted or non-retryable error
    const apiError = this.createApiError(lastError, requestOptions);
    this.logger.error(`Request failed after ${maxRetries + 1} attempts: ${apiError.message}`);
    throw apiError;
  }

  /**
   * Execute the actual HTTP request
   * @param {Object} requestOptions - HTTP request options
   * @param {Object} data - Request body data
   * @returns {Promise<Object>} - Raw response
   */
  executeRequest(requestOptions, data) {
    return new Promise((resolve, reject) => {
      const protocol = requestOptions.protocol === 'https:' ? https : http;
      
      const req = protocol.request(requestOptions, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            headers: res.headers,
            data: responseData
          });
        });
      });

      // Handle request errors
      req.on('error', (error) => {
        reject(this.createNetworkError(error, requestOptions));
      });

      // Handle timeout
      req.setTimeout(this.timeout, () => {
        req.destroy();
        reject(this.createTimeoutError(requestOptions));
      });

      // Write request body if present
      if (data) {
        const body = typeof data === 'string' ? data : JSON.stringify(data);
        req.write(body);
      }

      req.end();
    });
  }

  /**
   * Handle and parse HTTP response
   * @param {Object} response - Raw HTTP response
   * @param {Object} requestOptions - Original request options
   * @returns {Object} - Parsed response data
   */
  handleResponse(response, requestOptions) {
    const { statusCode, statusMessage, headers, data } = response;

    // Check for HTTP error status codes
    if (statusCode >= 400) {
      throw this.createHttpError(statusCode, statusMessage, data, requestOptions);
    }

    // Parse response data
    let parsedData;
    try {
      // Try to parse as JSON first
      parsedData = data ? JSON.parse(data) : null;
    } catch (parseError) {
      // If JSON parsing fails, return raw data
      parsedData = data;
    }

    return {
      statusCode,
      statusMessage,
      headers,
      data: parsedData
    };
  }

  /**
   * Build complete URL from base URL and path
   * @param {string} path - API endpoint path
   * @param {Object} queryParams - Query parameters
   * @returns {string} - Complete URL
   */
  buildUrl(path, queryParams = {}) {
    let url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    
    // Add query parameters
    const queryString = this.buildQueryString(queryParams);
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString;
    }
    
    return url;
  }

  /**
   * Build query string from parameters object
   * @param {Object} params - Query parameters
   * @returns {string} - Query string
   */
  buildQueryString(params) {
    return Object.entries(params)
      .filter(([key, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
  }

  /**
   * Build HTTP request options
   * @param {string} method - HTTP method
   * @param {string} url - Complete URL
   * @param {Object} data - Request body data
   * @param {Object} options - Additional options
   * @returns {Object} - HTTP request options
   */
  buildRequestOptions(method, url, data, options) {
    const parsedUrl = new URL(url);
    const headers = { ...this.defaultHeaders, ...options.headers };

    // Set content type for requests with body
    if (data && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    // Set content length for requests with body
    if (data) {
      const body = typeof data === 'string' ? data : JSON.stringify(data);
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    return {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method.toUpperCase(),
      headers,
      timeout: options.timeout || this.timeout
    };
  }

  /**
   * Check if error is retryable
   * @param {Error} error - Error object
   * @returns {boolean} - True if retryable
   */
  isRetryableError(error) {
    // Network errors
    if (error.code === 'ECONNRESET' || 
        error.code === 'ENOTFOUND' || 
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'TIMEOUT') {
      return true;
    }

    // HTTP 5xx server errors (but not 4xx client errors)
    if (error.statusCode >= 500 && error.statusCode < 600) {
      return true;
    }

    // Rate limiting errors (429) are retryable
    if (error.statusCode === 429) {
      return true;
    }

    return false;
  }

  /**
   * Calculate retry delay with exponential backoff
   * @param {number} attempt - Current attempt number
   * @returns {number} - Delay in milliseconds
   */
  calculateRetryDelay(attempt) {
    const exponentialDelay = this.retryDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000; // Add up to 1 second of jitter
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
  }

  /**
   * Wait for specified milliseconds
   * @param {number} ms - Milliseconds to wait
   * @returns {Promise} - Resolves after wait time
   */
  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create API error from various error types
   * @param {Error} originalError - Original error
   * @param {Object} requestOptions - Request options for context
   * @returns {Error} - Standardized API error
   */
  createApiError(originalError, requestOptions) {
    const error = new Error(originalError.message);
    error.name = 'ApiError';
    error.originalError = originalError;
    error.request = {
      method: requestOptions.method,
      url: `${requestOptions.protocol}//${requestOptions.hostname}${requestOptions.path}`,
      headers: requestOptions.headers
    };
    
    // Copy relevant properties from original error
    if (originalError.statusCode) error.statusCode = originalError.statusCode;
    if (originalError.code) error.code = originalError.code;
    if (originalError.response) error.response = originalError.response;
    
    return error;
  }

  /**
   * Create HTTP error for status code errors
   * @param {number} statusCode - HTTP status code
   * @param {string} statusMessage - HTTP status message
   * @param {string} responseData - Response body
   * @param {Object} requestOptions - Request options
   * @returns {Error} - HTTP error
   */
  createHttpError(statusCode, statusMessage, responseData, requestOptions) {
    let errorMessage = `HTTP ${statusCode}: ${statusMessage}`;
    
    // Try to extract error message from response
    try {
      const parsedResponse = JSON.parse(responseData);
      if (parsedResponse.error) {
        errorMessage += ` - ${parsedResponse.error}`;
      } else if (parsedResponse.message) {
        errorMessage += ` - ${parsedResponse.message}`;
      }
    } catch (parseError) {
      // If response isn't JSON, include raw response if it's short
      if (responseData && responseData.length < 200) {
        errorMessage += ` - ${responseData}`;
      }
    }

    const error = new Error(errorMessage);
    error.name = 'HttpError';
    error.statusCode = statusCode;
    error.statusMessage = statusMessage;
    error.response = responseData;
    error.request = {
      method: requestOptions.method,
      url: `${requestOptions.protocol}//${requestOptions.hostname}${requestOptions.path}`
    };
    
    return error;
  }

  /**
   * Create network error
   * @param {Error} originalError - Original network error
   * @param {Object} requestOptions - Request options
   * @returns {Error} - Network error
   */
  createNetworkError(originalError, requestOptions) {
    const error = new Error(`Network error: ${originalError.message}`);
    error.name = 'NetworkError';
    error.code = originalError.code;
    error.originalError = originalError;
    error.request = {
      method: requestOptions.method,
      url: `${requestOptions.protocol}//${requestOptions.hostname}${requestOptions.path}`
    };
    
    return error;
  }

  /**
   * Create timeout error
   * @param {Object} requestOptions - Request options
   * @returns {Error} - Timeout error
   */
  createTimeoutError(requestOptions) {
    const error = new Error(`Request timeout after ${this.timeout}ms`);
    error.name = 'TimeoutError';
    error.code = 'TIMEOUT';
    error.timeout = this.timeout;
    error.request = {
      method: requestOptions.method,
      url: `${requestOptions.protocol}//${requestOptions.hostname}${requestOptions.path}`
    };
    
    return error;
  }

  /**
   * Get client statistics
   * @returns {Object} - Request statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset client statistics
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retriedRequests: 0
    };
  }
}

module.exports = BaseApiClient;