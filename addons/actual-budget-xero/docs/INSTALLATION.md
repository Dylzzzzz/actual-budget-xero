# Actual-Xero Sync Installation Guide

This guide provides step-by-step instructions for installing and configuring the Actual-Xero Sync Home Assistant Add-on.

## Prerequisites

Before installing the add-on, ensure you have:

1. **Home Assistant** running (version 2023.1 or later)
2. **Actual Budget** server accessible from Home Assistant
3. **Xano** account with API access
4. **Xero** developer account with API credentials

## Installation Steps

### Step 1: Add the Repository

1. Open Home Assistant
2. Navigate to **Supervisor** → **Add-on Store**
3. Click the **⋮** menu in the top right
4. Select **Repositories**
5. Add this repository URL: `https://github.com/yourusername/actual-xero-sync-addon`
6. Click **Add**

### Step 2: Install the Add-on

1. Find **Actual-Xero Sync** in the add-on store
2. Click on it and select **Install**
3. Wait for the installation to complete

### Step 3: Configure the Add-on

1. Go to the **Configuration** tab
2. Fill in the required configuration (see [Configuration Guide](#configuration-guide))
3. Click **Save**

### Step 4: Start the Add-on

1. Go to the **Info** tab
2. Click **Start**
3. Enable **Start on boot** if desired
4. Enable **Watchdog** for automatic restart on crashes

## Configuration Guide

### Basic Configuration

```yaml
# Actual Budget Configuration
actual_budget_url: "http://192.168.1.100:5006"
actual_budget_password: "your-actual-budget-password"
business_category_group_name: "Business Expenses"

# Xano Configuration  
xano_api_url: "https://your-workspace.xano.io/api:version"
xano_api_key: "your-xano-api-key"

# Xero Configuration
xero_client_id: "your-xero-client-id"
xero_client_secret: "your-xero-client-secret"
xero_tenant_id: "your-xero-tenant-id"
```

### Advanced Configuration

```yaml
# Sync Configuration
sync_schedule: "0 2 * * 1"  # Weekly Monday 2 AM
sync_days_back: 7           # Check last 7 days for new transactions
batch_size: 10              # Process 10 transactions at a time

# Rate Limiting
xano_rate_limit: 18         # API calls per minute (adjust based on your Xano plan)

# Logging
log_level: "info"           # debug, info, warn, error
```

## Configuration Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `actual_budget_url` | Yes | - | URL to your Actual Budget server |
| `actual_budget_password` | Yes | - | Password for Actual Budget |
| `business_category_group_id` | No | - | ID of business category group (alternative to name) |
| `business_category_group_name` | No | "Business Expenses" | Name of business category group |
| `xano_api_url` | Yes | - | Your Xano API endpoint URL |
| `xano_api_key` | Yes | - | Your Xano API key |
| `xano_rate_limit` | No | 18 | API calls per minute limit |
| `xero_client_id` | Yes | - | Xero OAuth client ID |
| `xero_client_secret` | Yes | - | Xero OAuth client secret |
| `xero_tenant_id` | Yes | - | Xero tenant (organization) ID |
| `sync_schedule` | No | "0 2 * * 1" | Cron schedule for automatic sync |
| `sync_days_back` | No | 7 | Days to look back for new reconciled transactions |
| `batch_size` | No | 10 | Number of transactions to process in each batch |
| `log_level` | No | "info" | Logging level (debug, info, warn, error) |

## Getting API Credentials

### Actual Budget

1. Ensure your Actual Budget server is running and accessible
2. Note the URL (typically `http://your-server:5006`)
3. Use your existing Actual Budget password

### Xano

1. Log in to your [Xano workspace](https://xano.io)
2. Go to **Settings** → **API Keys**
3. Create a new API key with full permissions
4. Note your API base URL (format: `https://your-workspace.xano.io/api:version`)

### Xero

1. Go to [Xero Developer Portal](https://developer.xero.com)
2. Create a new app or use existing one
3. Note the **Client ID** and **Client Secret**
4. Get your **Tenant ID**:
   - Use Xero's API explorer or
   - Check the URL when logged into Xero (the UUID in the URL)

## Verification

After installation and configuration:

1. Check the add-on logs for any errors
2. Verify the web interface is accessible at `http://homeassistant:8080`
3. Test the connection to all services using the web interface
4. Run a manual sync to verify everything works

## Troubleshooting

### Common Issues

#### Add-on Won't Start

**Symptoms:** Add-on fails to start or crashes immediately

**Solutions:**
1. Check the logs for specific error messages
2. Verify all required configuration parameters are provided
3. Ensure URLs are accessible from Home Assistant
4. Check API credentials are valid

#### Connection Errors

**Symptoms:** "Connection refused" or "Network timeout" errors

**Solutions:**
1. Verify Actual Budget server is running and accessible
2. Check firewall settings
3. Ensure URLs use correct protocol (http/https)
4. Test connectivity from Home Assistant host

#### Authentication Errors

**Symptoms:** "Unauthorized" or "Invalid credentials" errors

**Solutions:**
1. Verify Actual Budget password is correct
2. Check Xano API key has proper permissions
3. Ensure Xero credentials are valid and app is approved
4. Verify Xero tenant ID is correct

#### Rate Limiting Issues

**Symptoms:** "Rate limit exceeded" errors or slow processing

**Solutions:**
1. Reduce `xano_rate_limit` setting
2. Increase `batch_size` to process more efficiently
3. Check your Xano plan limits
4. Consider upgrading Xano plan for higher limits

### Log Analysis

Enable debug logging to get detailed information:

```yaml
log_level: "debug"
```

Common log patterns:
- `Sync started` - Normal sync initiation
- `Rate limit hit` - API rate limiting in effect
- `Missing mapping` - Category or payee mapping not found
- `Transaction skipped` - Transaction couldn't be processed

### Getting Help

1. Check the [FAQ](FAQ.md)
2. Review the [troubleshooting guide](TROUBLESHOOTING.md)
3. Open an issue on [GitHub](https://github.com/yourusername/actual-xero-sync-addon/issues)
4. Join the [Home Assistant Community](https://community.home-assistant.io)

## Next Steps

After successful installation:

1. [Set up Xano backend](XANO_SETUP.md)
2. [Configure category and payee mappings](MAPPING_GUIDE.md)
3. [Set up Home Assistant automations](AUTOMATION_GUIDE.md)
4. [Monitor sync performance](MONITORING.md)