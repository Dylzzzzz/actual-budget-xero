/**
 * XanoRateLimiter - Manages API request rate limiting for Xano API
 * 
 * Implements request queuing and exponential backoff to handle Xano's
 * rate limits (~20 API calls per minute on free plan)
 */
class XanoRateLimiter {
  constructor(options = {}) {
    this.requestQueue = [];
    this.isProcessing = false;
    this.requestsPerMinute = options.requestsPerMinute || 18; // Conservative limit
    this.requestInterval = 60000 / this.requestsPerMinute; // Time between requests in ms
    this.maxRetries = options.maxRetries || 3;
    this.baseBackoffMs = options.baseBackoffMs || 1000;
    
    // Statistics tracking
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitHits: 0,
      averageWaitTime: 0
    };
  }

  /**
   * Add a request to the queue and process it
   * @param {Function} apiCall - Function that makes the API call
   * @returns {Promise} - Resolves with API response or rejects with error
   */
  async makeRequest(apiCall) {
    return new Promise((resolve, reject) => {
      const requestItem = {
        apiCall,
        resolve,
        reject,
        timestamp: Date.now()
      };
      
      this.requestQueue.push(requestItem);
      this.processQueue();
    });
  }

  /**
   * Process the request queue with rate limiting
   */
  async processQueue() {
    if (this.isProcessing || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.requestQueue.length > 0) {
      const requestItem = this.requestQueue.shift();
      const startTime = Date.now();

      try {
        const result = await this.executeWithRetry(requestItem.apiCall);
        this.stats.successfulRequests++;
        this.updateAverageWaitTime(startTime, requestItem.timestamp);
        requestItem.resolve(result);
      } catch (error) {
        this.stats.failedRequests++;
        requestItem.reject(error);
      }

      this.stats.totalRequests++;

      // Wait between requests to respect rate limits
      if (this.requestQueue.length > 0) {
        await this.wait(this.requestInterval);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Execute API call with retry logic and exponential backoff
   * @param {Function} apiCall - Function that makes the API call
   * @returns {Promise} - API response
   */
  async executeWithRetry(apiCall) {
    let lastError;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await apiCall();
      } catch (error) {
        lastError = error;

        // Handle rate limit errors (HTTP 429)
        if (this.isRateLimitError(error)) {
          this.stats.rateLimitHits++;
          const backoffTime = this.calculateBackoffTime(attempt);
          
          console.warn(`Rate limit hit (attempt ${attempt}/${this.maxRetries}). Waiting ${backoffTime}ms before retry.`);
          await this.wait(backoffTime);
          continue;
        }

        // Handle other retryable errors (network issues, 5xx errors)
        if (this.isRetryableError(error) && attempt < this.maxRetries) {
          const backoffTime = this.calculateBackoffTime(attempt);
          
          console.warn(`Retryable error (attempt ${attempt}/${this.maxRetries}): ${error.message}. Waiting ${backoffTime}ms before retry.`);
          await this.wait(backoffTime);
          continue;
        }

        // Non-retryable error or max retries exceeded
        break;
      }
    }

    throw new Error(`Max retries (${this.maxRetries}) exceeded. Last error: ${lastError.message}`);
  }

  /**
   * Check if error is a rate limit error
   * @param {Error} error - Error object
   * @returns {boolean} - True if rate limit error
   */
  isRateLimitError(error) {
    return error.status === 429 || 
           error.code === 'RATE_LIMITED' ||
           (error.message && error.message.toLowerCase().includes('rate limit'));
  }

  /**
   * Check if error is retryable (network issues, server errors)
   * @param {Error} error - Error object
   * @returns {boolean} - True if retryable
   */
  isRetryableError(error) {
    // Network errors
    if (error.code === 'ECONNRESET' || 
        error.code === 'ENOTFOUND' || 
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT') {
      return true;
    }

    // HTTP 5xx server errors
    if (error.status >= 500 && error.status < 600) {
      return true;
    }

    return false;
  }

  /**
   * Calculate exponential backoff time
   * @param {number} attempt - Current attempt number
   * @returns {number} - Backoff time in milliseconds
   */
  calculateBackoffTime(attempt) {
    // Exponential backoff: baseBackoffMs * 2^(attempt-1) + jitter
    const exponentialBackoff = this.baseBackoffMs * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000; // Add up to 1 second of jitter
    return Math.min(exponentialBackoff + jitter, 30000); // Cap at 30 seconds
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
   * Update average wait time statistics
   * @param {number} startTime - Request start time
   * @param {number} queueTime - Time request was queued
   */
  updateAverageWaitTime(startTime, queueTime) {
    const waitTime = startTime - queueTime;
    const totalRequests = this.stats.successfulRequests + this.stats.failedRequests;
    
    if (totalRequests === 1) {
      this.stats.averageWaitTime = waitTime;
    } else {
      this.stats.averageWaitTime = (this.stats.averageWaitTime * (totalRequests - 1) + waitTime) / totalRequests;
    }
  }

  /**
   * Get current queue status and statistics
   * @returns {Object} - Queue status and stats
   */
  getStatus() {
    return {
      queueLength: this.requestQueue.length,
      isProcessing: this.isProcessing,
      requestsPerMinute: this.requestsPerMinute,
      requestInterval: this.requestInterval,
      stats: { ...this.stats }
    };
  }

  /**
   * Update rate limiting configuration
   * @param {Object} options - New configuration options
   */
  updateConfig(options) {
    if (options.requestsPerMinute) {
      this.requestsPerMinute = options.requestsPerMinute;
      this.requestInterval = 60000 / this.requestsPerMinute;
    }
    
    if (options.maxRetries) {
      this.maxRetries = options.maxRetries;
    }
    
    if (options.baseBackoffMs) {
      this.baseBackoffMs = options.baseBackoffMs;
    }
  }

  /**
   * Clear the request queue (useful for shutdown)
   */
  clearQueue() {
    const remainingRequests = this.requestQueue.length;
    
    // Reject all pending requests
    this.requestQueue.forEach(item => {
      item.reject(new Error('Request queue cleared'));
    });
    
    this.requestQueue = [];
    return remainingRequests;
  }
}

module.exports = XanoRateLimiter;