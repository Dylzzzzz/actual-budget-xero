# Troubleshooting Actual Budget Authentication

## Current Issue: "No token received from authentication"

The sync is now working correctly (v1.3.0), but it's failing to authenticate with Actual Budget.

## Quick Fixes:

### 1. Configure Actual Budget Password
In Home Assistant:
1. Go to **Settings** → **Add-ons** → **Actual-Xero Sync**
2. Click **Configuration** tab
3. Set `actual_budget_password` to your Actual Budget server password
4. Click **Save** and **Restart** the add-on

### 2. Check Actual Budget URL
The current URL is `http://localhost:5006`. This might need to be:
- `http://host.docker.internal:5006` (if Actual Budget runs on host)
- `http://192.168.x.x:5006` (your Home Assistant IP)
- `http://actual-budget:5006` (if using Docker container name)

### 3. Test Connection
You can test if Actual Budget is accessible by:
1. SSH into Home Assistant
2. Run: `curl http://localhost:5006/account/login -X POST -H "Content-Type: application/json" -d '{"password":"YOUR_PASSWORD"}'`

## Configuration Required:

```yaml
# In Home Assistant Add-on Configuration
actual_budget_url: "http://YOUR_ACTUAL_BUDGET_URL:5006"
actual_budget_password: "YOUR_ACTUAL_BUDGET_PASSWORD"
business_category_group_name: "Business Expenses"
xano_api_url: "YOUR_XANO_API_URL"
xano_api_key: "YOUR_XANO_API_KEY"
```

## Success Indicators:
Once configured correctly, you should see:
- ✅ "Successfully authenticated with Actual Budget"
- ✅ "Fetched X reconciled transactions"
- ✅ "Stored X new transactions in Xano"

## Next Steps:
1. Configure the missing credentials in Home Assistant
2. Restart the add-on
3. Trigger a sync from the web interface
4. Check logs for successful authentication