# Troubleshooting Guide

This guide helps you diagnose and resolve common issues with the Actual-Xero Sync system.

## Quick Diagnostics

### Health Check Steps

1. **Check Add-on Status**
   - Go to Supervisor → Actual-Xero Sync
   - Verify status is "Running"
   - Check "Start on boot" is enabled

2. **Review Logs**
   - Click "Log" tab in add-on
   - Look for recent errors or warnings
   - Enable debug logging if needed

3. **Test Web Interface**
   - Navigate to `http://homeassistant:8080`
   - Verify dashboard loads
   - Check connection status indicators

4. **Verify Configuration**
   - Review all required fields are filled
   - Test API credentials
   - Confirm URLs are accessible

## Common Issues and Solutions

### Installation Issues

#### Add-on Won't Install

**Symptoms:**
- Installation fails or hangs
- "Failed to install" error message

**Causes & Solutions:**

1. **Insufficient Resources**
   ```bash
   # Check available space
   df -h
   # Check memory usage
   free -m
   ```
   - **Solution:** Free up disk space or add more memory

2. **Network Issues**
   - **Solution:** Check internet connection and DNS resolution

3. **Repository Issues**
   - **Solution:** Verify repository URL is correct and accessible

#### Add-on Won't Start

**Symptoms:**
- Add-on status shows "Stopped"
- Crashes immediately after starting

**Common Causes:**

1. **Configuration Errors**
   ```yaml
   # Check for missing required fields
   actual_budget_url: ""  # ❌ Empty required field
   xano_api_key: null     # ❌ Null value
   ```
   - **Solution:** Fill in all required configuration fields

2. **Invalid URLs**
   ```yaml
   # ❌ Invalid formats
   actual_budget_url: "localhost:5006"        # Missing protocol
   xano_api_url: "https://invalid-domain"     # Invalid domain
   ```
   - **Solution:** Use proper URL format with protocol

3. **Port Conflicts**
   - **Solution:** Change the add-on port in configuration

### Connection Issues

#### Cannot Connect to Actual Budget

**Symptoms:**
- "Connection refused" errors
- "Network timeout" messages
- Sync fails at transaction fetch stage

**Diagnostic Steps:**

1. **Test Connectivity**
   ```bash
   # From Home Assistant host
   curl -I http://your-actual-budget-url:5006
   ```

2. **Check Actual Budget Status**
   ```bash
   # Verify Actual Budget is running
   docker ps | grep actual
   # Or check process
   ps aux | grep actual
   ```

3. **Verify Network Access**
   - Ensure Actual Budget allows connections from Home Assistant IP
   - Check firewall rules
   - Verify no VPN/proxy interference

**Solutions:**

1. **Fix URL Configuration**
   ```yaml
   # ✅ Correct format
   actual_budget_url: "http://192.168.1.100:5006"
   # Use IP address if hostname doesn't resolve
   ```

2. **Update Actual Budget Configuration**
   ```bash
   # Allow connections from all IPs (if safe in your network)
   ACTUAL_HOSTNAME=0.0.0.0
   ```

3. **Network Troubleshooting**
   - Check if Home Assistant can reach Actual Budget host
   - Verify port 5006 is open and accessible
   - Test with telnet: `telnet actual-budget-ip 5006`

#### Cannot Connect to Xano

**Symptoms:**
- "Unauthorized" errors
- "Invalid API key" messages
- Rate limit errors

**Diagnostic Steps:**

1. **Test API Key**
   ```bash
   curl -H "Authorization: Bearer YOUR_API_KEY" \
        https://your-workspace.xano.io/api:version/health
   ```

2. **Check API URL Format**
   ```yaml
   # ✅ Correct format
   xano_api_url: "https://workspace-name.xano.io/api:v1"
   ```

**Solutions:**

1. **Regenerate API Key**
   - Go to Xano Settings → API Keys
   - Create new key with full permissions
   - Update configuration

2. **Verify API URL**
   - Check workspace name is correct
   - Ensure API version is specified
   - Test URL in browser (should show API documentation)

3. **Check Rate Limits**
   ```yaml
   # Reduce rate limit for free plans
   xano_rate_limit: 10  # Instead of default 18
   ```

#### Cannot Connect to Xero

**Symptoms:**
- OAuth authentication failures
- "Invalid client" errors
- "Tenant not found" errors

**Diagnostic Steps:**

1. **Verify Xero App Configuration**
   - Check app is approved and active
   - Verify redirect URIs are configured
   - Ensure scopes include required permissions

2. **Test Credentials**
   ```bash
   # Test OAuth flow manually
   curl -X POST https://identity.xero.com/connect/token \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "grant_type=client_credentials&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET"
   ```

**Solutions:**

1. **Update Xero App Settings**
   - Ensure app has "Accounting" scope
   - Add correct redirect URI
   - Verify app is not in development mode (if going live)

2. **Get Correct Tenant ID**
   ```bash
   # Use Xero API to get tenant ID
   curl -H "Authorization: Bearer ACCESS_TOKEN" \
        https://api.xero.com/connections
   ```

3. **Refresh OAuth Tokens**
   - Re-authenticate with Xero
   - Update stored tokens
   - Verify token expiration handling

### Sync Issues

#### Transactions Not Syncing

**Symptoms:**
- Sync completes but no transactions processed
- "No new transactions found" message
- Transactions exist but aren't being picked up

**Diagnostic Steps:**

1. **Check Transaction Status in Actual Budget**
   ```sql
   -- Verify transactions are reconciled
   SELECT * FROM transactions 
   WHERE cleared = 1 AND reconciled = 1 
   AND date >= date('now', '-7 days');
   ```

2. **Verify Category Group Configuration**
   ```yaml
   # Check category group exists and has transactions
   business_category_group_name: "Business Expenses"
   # Or use ID if name doesn't work
   business_category_group_id: "group-uuid-here"
   ```

3. **Check Date Range**
   ```yaml
   # Increase lookback period
   sync_days_back: 14  # Look back 14 days instead of 7
   ```

**Solutions:**

1. **Fix Category Group Configuration**
   - Verify group name matches exactly (case-sensitive)
   - Use group ID instead of name if issues persist
   - Check transactions are in the correct category group

2. **Adjust Sync Parameters**
   ```yaml
   sync_days_back: 30     # Look back further
   batch_size: 5          # Smaller batches for testing
   ```

3. **Manual Transaction Check**
   - Use web interface to trigger manual sync
   - Check logs for specific error messages
   - Verify transaction meets all criteria

#### Mapping Issues

**Symptoms:**
- Transactions skipped due to missing mappings
- "No category mapping found" errors
- "No payee mapping found" errors

**Diagnostic Steps:**

1. **Check Xano Mappings**
   ```bash
   # Test category mapping endpoint
   curl -H "Authorization: Bearer API_KEY" \
        https://your-xano.io/api:v1/category-mappings/CATEGORY_ID
   ```

2. **Verify Mapping Data**
   - Check category_mappings table has entries
   - Verify is_active = true
   - Ensure actual_category_id matches Actual Budget

**Solutions:**

1. **Create Missing Mappings**
   ```sql
   -- Add category mapping
   INSERT INTO category_mappings 
   (actual_category_id, actual_category_name, xero_account_id, is_active)
   VALUES ('cat-id', 'Category Name', 'xero-account-id', true);
   ```

2. **Enable Auto-Mapping**
   - Configure Xero search functions
   - Test auto-resolution features
   - Review and approve suggested mappings

3. **Bulk Import Mappings**
   - Export categories from Actual Budget
   - Create CSV with mappings
   - Import to Xano using bulk operations

#### Rate Limiting Issues

**Symptoms:**
- "Rate limit exceeded" errors
- Slow sync performance
- Timeouts during sync

**Diagnostic Steps:**

1. **Check Current Rate Limit**
   ```yaml
   # Current setting
   xano_rate_limit: 18
   ```

2. **Monitor API Usage**
   - Check Xano dashboard for usage stats
   - Review sync logs for timing information

**Solutions:**

1. **Adjust Rate Limits**
   ```yaml
   # For free Xano plan
   xano_rate_limit: 10
   
   # For paid plans
   xano_rate_limit: 30
   ```

2. **Optimize Batch Processing**
   ```yaml
   batch_size: 20         # Larger batches
   sync_days_back: 3      # Shorter lookback
   ```

3. **Upgrade Xano Plan**
   - Consider paid plan for higher limits
   - Monitor usage patterns
   - Optimize API calls

### Data Issues

#### Duplicate Transactions

**Symptoms:**
- Same transaction appears multiple times in Xero
- Duplicate detection not working
- Transaction references not unique

**Diagnostic Steps:**

1. **Check Xano Transaction Records**
   ```sql
   SELECT actual_transaction_id, COUNT(*) 
   FROM transactions 
   GROUP BY actual_transaction_id 
   HAVING COUNT(*) > 1;
   ```

2. **Verify Xero References**
   ```sql
   SELECT reference, COUNT(*) 
   FROM xero_transactions 
   GROUP BY reference 
   HAVING COUNT(*) > 1;
   ```

**Solutions:**

1. **Clean Up Duplicates**
   ```sql
   -- Remove duplicate Xano records (keep latest)
   DELETE FROM transactions 
   WHERE id NOT IN (
     SELECT MAX(id) 
     FROM transactions 
     GROUP BY actual_transaction_id
   );
   ```

2. **Fix Reference Generation**
   - Ensure Xano ID is used for references
   - Verify reference format: "Xano-{id}"
   - Check Xero doesn't have existing references

#### Incorrect Transaction Data

**Symptoms:**
- Wrong amounts in Xero
- Incorrect dates
- Missing or wrong descriptions

**Diagnostic Steps:**

1. **Compare Source Data**
   ```sql
   -- Check Actual Budget transaction
   SELECT * FROM transactions WHERE id = 'transaction-id';
   
   -- Check Xano stored data
   SELECT * FROM transactions WHERE actual_transaction_id = 'transaction-id';
   ```

2. **Verify Data Transformation**
   - Check amount conversion (positive/negative)
   - Verify date format handling
   - Review description processing

**Solutions:**

1. **Fix Data Transformation**
   - Update sync logic for amount handling
   - Correct date format conversion
   - Improve description processing

2. **Reprocess Transactions**
   ```bash
   # Use reprocessing endpoint
   curl -X POST -H "Authorization: Bearer API_KEY" \
        https://your-xano.io/api:v1/transactions/reprocess
   ```

## Performance Issues

### Slow Sync Performance

**Symptoms:**
- Sync takes very long to complete
- Timeouts during processing
- High resource usage

**Diagnostic Steps:**

1. **Check Resource Usage**
   ```bash
   # Monitor during sync
   top -p $(pgrep -f actual-xero-sync)
   ```

2. **Review Batch Sizes**
   ```yaml
   batch_size: 50  # May be too large
   ```

3. **Analyze API Response Times**
   - Check logs for timing information
   - Monitor network latency
   - Review API endpoint performance

**Solutions:**

1. **Optimize Batch Processing**
   ```yaml
   batch_size: 10         # Smaller batches
   xano_rate_limit: 15    # Conservative rate limit
   ```

2. **Improve Caching**
   - Cache mapping data
   - Reduce redundant API calls
   - Implement smart retry logic

3. **Upgrade Resources**
   - Increase Home Assistant memory
   - Use faster storage
   - Improve network connection

### Memory Issues

**Symptoms:**
- Out of memory errors
- Add-on crashes during large syncs
- System becomes unresponsive

**Solutions:**

1. **Reduce Memory Usage**
   ```yaml
   batch_size: 5          # Very small batches
   sync_days_back: 1      # Minimal lookback
   ```

2. **Implement Streaming**
   - Process transactions one at a time
   - Clear memory between batches
   - Use pagination for large datasets

## Logging and Debugging

### Enable Debug Logging

```yaml
log_level: "debug"
```

### Key Log Messages

| Message | Meaning | Action |
|---------|---------|---------|
| `Sync started` | Normal operation | None |
| `Rate limit hit` | API throttling | Reduce rate limit |
| `Missing mapping` | Mapping not found | Create mapping |
| `Transaction skipped` | Validation failed | Check transaction data |
| `Network timeout` | Connection issue | Check connectivity |
| `Authentication failed` | Invalid credentials | Update credentials |

### Log Analysis Tools

```bash
# Filter for errors
grep -i error /path/to/addon/logs

# Count sync operations
grep "Sync completed" /path/to/addon/logs | wc -l

# Find rate limit issues
grep "429" /path/to/addon/logs
```

## Getting Help

### Before Asking for Help

1. **Collect Information**
   - Add-on version
   - Home Assistant version
   - Configuration (sanitized)
   - Recent logs
   - Error messages

2. **Try Basic Fixes**
   - Restart add-on
   - Check configuration
   - Review logs
   - Test connectivity

3. **Document Steps**
   - What you were trying to do
   - What happened instead
   - Steps to reproduce
   - Any error messages

### Support Channels

1. **GitHub Issues**
   - Bug reports
   - Feature requests
   - Technical questions

2. **Home Assistant Community**
   - General discussion
   - Configuration help
   - User experiences

3. **Documentation**
   - Installation guide
   - Configuration reference
   - API documentation

### Creating Good Bug Reports

Include:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Configuration (remove sensitive data)
- Log excerpts showing the error
- Environment details (HA version, etc.)

Example:
```
**Problem:** Sync fails with "Rate limit exceeded" error

**Steps to Reproduce:**
1. Configure add-on with Xano free plan
2. Set xano_rate_limit to 20
3. Run sync with 50 transactions

**Expected:** Sync completes successfully
**Actual:** Fails after 10 transactions with rate limit error

**Configuration:**
```yaml
xano_rate_limit: 20
batch_size: 10
```

**Logs:**
```
2024-01-15 10:30:15 ERROR Rate limit exceeded: 429 Too Many Requests
```

**Environment:**
- Home Assistant: 2024.1.0
- Add-on version: 1.0.0
- Xano plan: Free
```