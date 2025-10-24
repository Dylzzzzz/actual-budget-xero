# Configuration Examples

This document provides various configuration examples for different deployment scenarios and use cases.

## Basic Configurations

### Minimal Configuration

For a simple setup with default settings:

```yaml
# Required fields only
actual_budget_url: "http://192.168.1.100:5006"
actual_budget_password: "your-password"
business_category_group_name: "Business Expenses"
xano_api_url: "https://your-workspace.xano.io/api:v1"
xano_api_key: "your-api-key"
xero_client_id: "your-client-id"
xero_client_secret: "your-client-secret"
xero_tenant_id: "your-tenant-id"
```

### Complete Configuration

For full control over all settings:

```yaml
# Actual Budget Configuration
actual_budget_url: "http://192.168.1.100:5006"
actual_budget_password: "your-secure-password"
business_category_group_id: "550e8400-e29b-41d4-a716-446655440000"
business_category_group_name: "Business Expenses"

# Xano Configuration
xano_api_url: "https://your-workspace.xano.io/api:v1"
xano_api_key: "your-xano-api-key"
xano_rate_limit: 18

# Xero Configuration
xero_client_id: "your-xero-client-id"
xero_client_secret: "your-xero-client-secret"
xero_tenant_id: "your-xero-tenant-id"

# Sync Configuration
sync_schedule: "0 2 * * 1"  # Monday 2 AM
sync_days_back: 7
batch_size: 10

# Logging Configuration
log_level: "info"
```

## Environment-Specific Configurations

### Development Environment

For testing and development:

```yaml
# Development settings
actual_budget_url: "http://localhost:5006"
actual_budget_password: "dev-password"
business_category_group_name: "Test Business"

# Xano sandbox
xano_api_url: "https://dev-workspace.xano.io/api:v1"
xano_api_key: "dev-api-key"
xano_rate_limit: 10  # Conservative for testing

# Xero sandbox
xero_client_id: "dev-client-id"
xero_client_secret: "dev-client-secret"
xero_tenant_id: "dev-tenant-id"

# Frequent sync for testing
sync_schedule: "*/15 * * * *"  # Every 15 minutes
sync_days_back: 1
batch_size: 5

# Debug logging
log_level: "debug"
```

### Production Environment

For live deployment:

```yaml
# Production Actual Budget
actual_budget_url: "https://budget.yourdomain.com"
actual_budget_password: "!vault actual_budget_password"
business_category_group_name: "Business Expenses"

# Production Xano
xano_api_url: "https://prod-workspace.xano.io/api:v1"
xano_api_key: "!vault xano_api_key"
xano_rate_limit: 25  # Higher limit for paid plan

# Production Xero
xero_client_id: "!vault xero_client_id"
xero_client_secret: "!vault xero_client_secret"
xero_tenant_id: "!vault xero_tenant_id"

# Weekly sync
sync_schedule: "0 3 * * 1"  # Monday 3 AM
sync_days_back: 14  # Two weeks lookback
batch_size: 20

# Production logging
log_level: "warn"
```

## Use Case Specific Configurations

### High Volume Setup

For businesses with many transactions:

```yaml
# Standard connection settings
actual_budget_url: "http://192.168.1.100:5006"
actual_budget_password: "your-password"
business_category_group_name: "Business Expenses"
xano_api_url: "https://your-workspace.xano.io/api:v1"
xano_api_key: "your-api-key"
xero_client_id: "your-client-id"
xero_client_secret: "your-client-secret"
xero_tenant_id: "your-tenant-id"

# Optimized for high volume
xano_rate_limit: 30        # Paid plan with higher limits
batch_size: 25             # Larger batches
sync_days_back: 3          # Shorter lookback to reduce load
sync_schedule: "0 1 * * *" # Daily sync at 1 AM

# Minimal logging to reduce overhead
log_level: "error"
```

### Low Volume Setup

For small businesses with few transactions:

```yaml
# Standard connection settings
actual_budget_url: "http://192.168.1.100:5006"
actual_budget_password: "your-password"
business_category_group_name: "Business Expenses"
xano_api_url: "https://your-workspace.xano.io/api:v1"
xano_api_key: "your-api-key"
xero_client_id: "your-client-id"
xero_client_secret: "your-client-secret"
xero_tenant_id: "your-tenant-id"

# Conservative settings for free plans
xano_rate_limit: 12        # Well under free plan limit
batch_size: 5              # Small batches
sync_days_back: 30         # Longer lookback for infrequent transactions
sync_schedule: "0 2 * * 0" # Weekly sync on Sunday

# Detailed logging for troubleshooting
log_level: "info"
```

### Multiple Category Groups

For businesses with separate category groups:

```yaml
# Primary business expenses
actual_budget_url: "http://192.168.1.100:5006"
actual_budget_password: "your-password"
business_category_group_name: "Operating Expenses"

# Alternative: Use ID for specific group
# business_category_group_id: "550e8400-e29b-41d4-a716-446655440000"

xano_api_url: "https://your-workspace.xano.io/api:v1"
xano_api_key: "your-api-key"
xero_client_id: "your-client-id"
xero_client_secret: "your-client-secret"
xero_tenant_id: "your-tenant-id"

# Standard sync settings
sync_schedule: "0 2 * * 1"
sync_days_back: 7
batch_size: 10
log_level: "info"
```

## Network Configurations

### Docker Network Setup

When Actual Budget runs in Docker:

```yaml
# Use Docker service name or container IP
actual_budget_url: "http://actual-budget:5006"
# Or container IP if service name doesn't resolve
# actual_budget_url: "http://172.17.0.2:5006"

actual_budget_password: "your-password"
business_category_group_name: "Business Expenses"

# External services use public URLs
xano_api_url: "https://your-workspace.xano.io/api:v1"
xano_api_key: "your-api-key"
xero_client_id: "your-client-id"
xero_client_secret: "your-client-secret"
xero_tenant_id: "your-tenant-id"
```

### Remote Actual Budget

When Actual Budget is on a different server:

```yaml
# Remote server with HTTPS
actual_budget_url: "https://budget.yourdomain.com"
actual_budget_password: "your-password"
business_category_group_name: "Business Expenses"

# Or remote server with custom port
# actual_budget_url: "http://192.168.1.50:8080"

xano_api_url: "https://your-workspace.xano.io/api:v1"
xano_api_key: "your-api-key"
xero_client_id: "your-client-id"
xero_client_secret: "your-client-secret"
xero_tenant_id: "your-tenant-id"
```

### VPN/Proxy Setup

When using VPN or proxy:

```yaml
# Actual Budget through VPN
actual_budget_url: "http://10.0.0.100:5006"
actual_budget_password: "your-password"
business_category_group_name: "Business Expenses"

# External APIs through proxy (if needed)
xano_api_url: "https://your-workspace.xano.io/api:v1"
xano_api_key: "your-api-key"
xero_client_id: "your-client-id"
xero_client_secret: "your-client-secret"
xero_tenant_id: "your-tenant-id"

# Longer timeouts for VPN latency
sync_days_back: 7
batch_size: 5  # Smaller batches for slower connections
```

## Security Configurations

### Using Home Assistant Secrets

Store sensitive data in `secrets.yaml`:

```yaml
# In configuration
actual_budget_url: "http://192.168.1.100:5006"
actual_budget_password: !secret actual_budget_password
business_category_group_name: "Business Expenses"
xano_api_url: "https://your-workspace.xano.io/api:v1"
xano_api_key: !secret xano_api_key
xero_client_id: !secret xero_client_id
xero_client_secret: !secret xero_client_secret
xero_tenant_id: !secret xero_tenant_id
```

```yaml
# In secrets.yaml
actual_budget_password: "your-actual-password"
xano_api_key: "your-xano-api-key"
xero_client_id: "your-xero-client-id"
xero_client_secret: "your-xero-client-secret"
xero_tenant_id: "your-xero-tenant-id"
```

### Environment Variables

For containerized deployments:

```yaml
# Use environment variable references
actual_budget_url: "${ACTUAL_BUDGET_URL}"
actual_budget_password: "${ACTUAL_BUDGET_PASSWORD}"
business_category_group_name: "${BUSINESS_CATEGORY_GROUP}"
xano_api_url: "${XANO_API_URL}"
xano_api_key: "${XANO_API_KEY}"
xero_client_id: "${XERO_CLIENT_ID}"
xero_client_secret: "${XERO_CLIENT_SECRET}"
xero_tenant_id: "${XERO_TENANT_ID}"
```

## Performance Tuning Configurations

### Xano Free Plan Optimization

```yaml
# Connection settings
actual_budget_url: "http://192.168.1.100:5006"
actual_budget_password: "your-password"
business_category_group_name: "Business Expenses"
xano_api_url: "https://your-workspace.xano.io/api:v1"
xano_api_key: "your-api-key"
xero_client_id: "your-client-id"
xero_client_secret: "your-client-secret"
xero_tenant_id: "your-tenant-id"

# Optimized for free plan limits (~20 calls/minute)
xano_rate_limit: 15        # Conservative limit
batch_size: 8              # Moderate batch size
sync_days_back: 5          # Shorter lookback
sync_schedule: "0 3 * * 1" # Weekly to reduce API usage

log_level: "warn"          # Reduce log volume
```

### Xano Paid Plan Optimization

```yaml
# Connection settings
actual_budget_url: "http://192.168.1.100:5006"
actual_budget_password: "your-password"
business_category_group_name: "Business Expenses"
xano_api_url: "https://your-workspace.xano.io/api:v1"
xano_api_key: "your-api-key"
xero_client_id: "your-client-id"
xero_client_secret: "your-client-secret"
xero_tenant_id: "your-tenant-id"

# Optimized for paid plan (higher limits)
xano_rate_limit: 40        # Higher limit
batch_size: 30             # Larger batches
sync_days_back: 14         # Longer lookback
sync_schedule: "0 2 * * *" # Daily sync

log_level: "info"
```

## Debugging Configurations

### Maximum Debugging

For troubleshooting issues:

```yaml
# Standard connection settings
actual_budget_url: "http://192.168.1.100:5006"
actual_budget_password: "your-password"
business_category_group_name: "Business Expenses"
xano_api_url: "https://your-workspace.xano.io/api:v1"
xano_api_key: "your-api-key"
xero_client_id: "your-client-id"
xero_client_secret: "your-client-secret"
xero_tenant_id: "your-tenant-id"

# Debug-friendly settings
xano_rate_limit: 5         # Very slow for detailed logging
batch_size: 1              # Process one at a time
sync_days_back: 1          # Minimal data set
sync_schedule: "0 */6 * * *" # Every 6 hours for testing

# Maximum logging
log_level: "debug"
```

### Performance Testing

For load testing and performance analysis:

```yaml
# Standard connection settings
actual_budget_url: "http://192.168.1.100:5006"
actual_budget_password: "your-password"
business_category_group_name: "Business Expenses"
xano_api_url: "https://your-workspace.xano.io/api:v1"
xano_api_key: "your-api-key"
xero_client_id: "your-client-id"
xero_client_secret: "your-client-secret"
xero_tenant_id: "your-tenant-id"

# Performance testing settings
xano_rate_limit: 60        # Maximum rate
batch_size: 50             # Large batches
sync_days_back: 30         # Large dataset
sync_schedule: "*/30 * * * *" # Frequent sync for testing

# Minimal logging for performance
log_level: "error"
```

## Validation

### Configuration Validation Checklist

Before deploying, verify:

- [ ] All required fields are filled
- [ ] URLs are accessible from Home Assistant
- [ ] API credentials are valid and have proper permissions
- [ ] Category group exists and contains transactions
- [ ] Rate limits are appropriate for your Xano plan
- [ ] Sync schedule fits your business needs
- [ ] Log level is appropriate for your environment

### Testing Configuration

Use this minimal config for initial testing:

```yaml
actual_budget_url: "http://192.168.1.100:5006"
actual_budget_password: "test-password"
business_category_group_name: "Test Category"
xano_api_url: "https://test-workspace.xano.io/api:v1"
xano_api_key: "test-api-key"
xero_client_id: "test-client-id"
xero_client_secret: "test-client-secret"
xero_tenant_id: "test-tenant-id"

# Safe testing settings
xano_rate_limit: 5
batch_size: 2
sync_days_back: 1
log_level: "debug"

# Manual sync only (disable automatic)
sync_schedule: ""
```

## Migration Configurations

### Migrating from PocketSmith

When replacing PocketSmith integration:

```yaml
# Your existing Actual Budget setup
actual_budget_url: "http://192.168.1.100:5006"
actual_budget_password: "your-existing-password"

# Use same category group as PocketSmith integration
business_category_group_name: "Business Transactions"

# New Xano backend
xano_api_url: "https://migration-workspace.xano.io/api:v1"
xano_api_key: "migration-api-key"

# Existing Xero credentials
xero_client_id: "your-existing-client-id"
xero_client_secret: "your-existing-client-secret"
xero_tenant_id: "your-existing-tenant-id"

# Conservative settings during migration
xano_rate_limit: 10
batch_size: 5
sync_days_back: 30  # Longer lookback to catch missed transactions
sync_schedule: "0 4 * * *"  # Daily during migration period

log_level: "info"
```