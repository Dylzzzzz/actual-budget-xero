# Quick Start Guide

Get your Actual-Xero Sync add-on up and running in 15 minutes! This guide walks you through the essential setup steps to start syncing your business transactions automatically.

## Prerequisites Checklist

Before you begin, make sure you have:

- [ ] **Home Assistant** running (version 2023.1 or later)
- [ ] **Actual Budget** server accessible from Home Assistant
- [ ] **Xano account** (free tier is sufficient to start)
- [ ] **Xero developer account** with an OAuth app configured
- [ ] **Business category group** set up in Actual Budget

## Step 1: Install the Add-on (5 minutes)

### Option A: From Add-on Store (Recommended)

1. **Add Repository**
   - Go to **Supervisor** → **Add-on Store** in Home Assistant
   - Click the menu (⋮) in the top right corner
   - Select **Repositories**
   - Add: `https://github.com/user/actual-xero-sync-addon`

2. **Install Add-on**
   - Find "Actual-Xero Sync" in the add-on store
   - Click **Install**
   - Wait for installation to complete

### Option B: Manual Installation

```bash
cd /addons
git clone https://github.com/user/actual-xero-sync-addon actual-xero-sync
```

Then restart Home Assistant and install from the local add-ons section.

## Step 2: Set Up Xano Backend (10 minutes)

### Create Xano Account

1. Go to [xano.io](https://xano.io) and create a free account
2. Create a new workspace: "Actual-Xero-Sync"
3. Note your workspace URL (e.g., `https://x123456.xano.io`)

### Create Database Tables

Use this AI prompt in Xano's AI assistant:

```
Create three database tables for a transaction sync system:

1. TRANSACTIONS table with fields:
   - id (auto-increment primary key)
   - actual_transaction_id (unique text, required)
   - transaction_date (date, required)
   - created_date (timestamp, auto-set)
   - amount (decimal 10,2, required)
   - description (long text)
   - actual_category_id (text)
   - actual_payee_id (text)
   - xero_account_id (text)
   - xero_contact_id (text)
   - xero_transaction_id (text)
   - xero_imported_date (timestamp, nullable)
   - status (enum: pending, mapped, imported, failed, default pending)
   - error_message (long text)

2. CATEGORY_MAPPINGS table with fields:
   - id (auto-increment primary key)
   - actual_category_id (unique text, required)
   - actual_category_name (text, required)
   - xero_account_id (text)
   - xero_account_name (text)
   - xero_account_code (text, max 10 chars)
   - is_active (boolean, default true)
   - created_date (timestamp, auto-set)
   - updated_date (timestamp, auto-update)

3. PAYEE_MAPPINGS table with fields:
   - id (auto-increment primary key)
   - actual_payee_id (unique text, required)
   - actual_payee_name (text, required)
   - xero_contact_id (text)
   - xero_contact_name (text)
   - is_active (boolean, default true)
   - created_date (timestamp, auto-set)
   - updated_date (timestamp, auto-update)

Add appropriate indexes for performance on lookup fields.
```

### Create API Endpoints

Create these endpoints using Xano's AI assistant:

**1. Store Transaction (POST /transactions)**
```
Create a POST endpoint that:
1. Accepts transaction data with actual_transaction_id, transaction_date, amount, description, actual_category_id, actual_payee_id
2. Checks if actual_transaction_id already exists
3. If exists, return existing record
4. If not exists, insert new record with status 'pending'
5. Return the created/existing transaction record
```

**2. Get Category Mapping (GET /category-mappings/{actual_category_id})**
```
Create a GET endpoint that:
1. Accepts actual_category_id as path parameter
2. Returns mapping with xero_account_id, xero_account_name, xero_account_code
3. Returns null if no mapping found
4. Only returns active mappings
```

**3. Get Payee Mapping (GET /payee-mappings/{actual_payee_id})**
```
Create a GET endpoint that:
1. Accepts actual_payee_id as path parameter
2. Returns mapping with xero_contact_id, xero_contact_name
3. Returns null if no mapping found
4. Only returns active mappings
```

### Get Your API Credentials

1. Go to **Settings** → **API** in your Xano workspace
2. Copy your **API Base URL** (e.g., `https://x123456.xano.io/api:v1`)
3. Generate and copy your **API Key**

## Step 3: Configure Xero OAuth App (5 minutes)

### Create Xero App

1. Go to [developer.xero.com](https://developer.xero.com)
2. Sign in with your Xero account
3. Click **New App** → **Web App**
4. Fill in app details:
   - **App Name**: "Actual-Xero Sync"
   - **Company URL**: Your website or `http://localhost`
   - **Redirect URI**: `http://localhost:8080/auth/callback`

### Get OAuth Credentials

1. Copy your **Client ID**
2. Generate and copy your **Client Secret**
3. Note your **Tenant ID** (found in Xero organization settings)

## Step 4: Configure the Add-on (3 minutes)

### Basic Configuration

Go to the add-on **Configuration** tab and fill in:

```yaml
# Actual Budget Settings
actual_budget_url: "http://192.168.1.100:5006"  # Your Actual Budget URL
actual_budget_password: "your-actual-password"
business_category_group_name: "Business Expenses"  # Your business category group

# Xano Settings
xano_api_url: "https://x123456.xano.io/api:v1"  # From Step 2
xano_api_key: "your-xano-api-key"               # From Step 2
xano_rate_limit: 18  # Conservative for free plan

# Xero Settings
xero_client_id: "your-xero-client-id"           # From Step 3
xero_client_secret: "your-xero-client-secret"   # From Step 3
xero_tenant_id: "your-xero-tenant-id"           # From Step 3

# Sync Settings (Optional)
sync_schedule: "0 2 * * 1"  # Weekly Monday 2 AM
sync_days_back: 7           # Check last 7 days
batch_size: 10              # Process 10 transactions at a time
log_level: "info"           # Logging level
```

### Save and Start

1. Click **Save** to save your configuration
2. Go to the **Info** tab
3. Click **Start** to start the add-on
4. Check the **Log** tab for any startup errors

## Step 5: First Sync Test (2 minutes)

### Access Web Interface

1. Open `http://your-home-assistant-ip:8080` in your browser
2. You should see the Actual-Xero Sync dashboard

### Run Manual Sync

1. Click **Manual Sync** button in the web interface
2. Watch the logs for sync progress
3. Check for any error messages

### Expected First Run Results

On your first sync, you'll likely see:
- ✅ Transactions fetched from Actual Budget
- ✅ Transactions stored in Xano
- ⚠️ Missing category mappings (expected)
- ⚠️ Missing payee mappings (expected)
- ❌ No transactions imported to Xero (expected)

This is normal! You need to set up mappings first.

## Step 6: Set Up Initial Mappings (10 minutes)

### Access Xano Database

1. Go to your Xano workspace
2. Navigate to **Database** → **category_mappings**
3. You should see your Actual Budget categories listed

### Map Categories to Xero Accounts

For each category you want to sync:

1. **Find Xero Account ID**:
   - Go to Xero → **Accounting** → **Chart of Accounts**
   - Find the account you want to map to
   - Note the account code and name

2. **Update Xano Mapping**:
   - Edit the category mapping record
   - Fill in `xero_account_id`, `xero_account_name`, `xero_account_code`
   - Save the record

### Map Payees to Xero Contacts

1. Go to **Database** → **payee_mappings** in Xano
2. For each payee:
   - Find or create the contact in Xero
   - Update the mapping with `xero_contact_id` and `xero_contact_name`

### Quick Mapping Tip

Start with your most common categories and payees. You can add more mappings over time as new transactions come in.

## Step 7: Test Complete Workflow (5 minutes)

### Run Sync Again

1. Go back to the web interface
2. Click **Manual Sync** again
3. This time you should see:
   - ✅ Transactions fetched
   - ✅ Transactions stored
   - ✅ Mappings resolved
   - ✅ Transactions imported to Xero

### Verify in Xero

1. Go to Xero → **Accounting** → **Bank Transactions**
2. Look for transactions with references like "Xano-123"
3. Verify the amounts, dates, and accounts are correct

### Check Actual Budget

1. Go to your Actual Budget
2. Check the transaction notes
3. You should see tags like "#xano" and "#xero" added

## Troubleshooting Common Issues

### Add-on Won't Start

**Check logs for:**
- Configuration validation errors
- Network connectivity issues
- Invalid API credentials

**Solutions:**
- Verify all URLs are accessible from Home Assistant
- Double-check API keys and credentials
- Ensure Actual Budget password is correct

### No Transactions Found

**Possible causes:**
- No reconciled transactions in the date range
- Wrong category group name/ID
- Actual Budget connection issues

**Solutions:**
- Check if you have reconciled business transactions
- Verify category group name matches exactly
- Test Actual Budget URL in a browser

### Mapping Errors

**Common issues:**
- Missing category or payee mappings
- Invalid Xero account/contact IDs
- Inactive mappings

**Solutions:**
- Check Xano database for missing mappings
- Verify Xero IDs are correct and active
- Use the reprocess function after adding mappings

### Xero Import Failures

**Check for:**
- Invalid Xero credentials
- Missing required transaction fields
- Xero API rate limits

**Solutions:**
- Verify OAuth credentials and tenant ID
- Check transaction data completeness
- Reduce batch size if hitting rate limits

## Next Steps

### Set Up Automation

Add this to your Home Assistant automations:

```yaml
automation:
  - alias: "Weekly Transaction Sync"
    trigger:
      platform: time
      at: "02:00:00"
    condition:
      condition: time
      weekday:
        - mon
    action:
      service: actual_xero_sync.run_sync
```

### Monitor Performance

- Check the web dashboard regularly
- Set up notifications for sync failures
- Review logs for any recurring issues

### Expand Mappings

- Add mappings for new categories and payees as they appear
- Use the reprocess function to handle previously skipped transactions
- Consider bulk mapping import for large datasets

## Getting Help

### Documentation

- 📖 [Full Installation Guide](INSTALLATION.md)
- 🔧 [Xano Setup Details](XANO_SETUP.md)
- ⚙️ [Configuration Examples](CONFIGURATION_EXAMPLES.md)
- 🔍 [Troubleshooting Guide](TROUBLESHOOTING.md)

### Support Channels

- 🐛 [GitHub Issues](https://github.com/user/actual-xero-sync-addon/issues)
- 💬 [GitHub Discussions](https://github.com/user/actual-xero-sync-addon/discussions)
- 🏠 [Home Assistant Community](https://community.home-assistant.io/)

### Community

- Share your configuration examples
- Report bugs and suggest improvements
- Help other users with setup questions

---

**Congratulations!** 🎉 You now have automated business transaction syncing between Actual Budget and Xero. The system will continue to sync your reconciled transactions automatically according to your schedule.