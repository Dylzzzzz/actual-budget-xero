# Frequently Asked Questions (FAQ)

## General Questions

### What is Actual-Xero Sync?

Actual-Xero Sync is a Home Assistant add-on that automatically synchronizes business transactions from Actual Budget to Xero accounting software via Xano. It eliminates manual data entry by detecting reconciled transactions in Actual Budget and creating corresponding entries in Xero with proper categorization.

### Why do I need Xano as a middleware?

Xano serves several important purposes:
- **Mapping Management**: Stores category and payee mappings between Actual Budget and Xero
- **Duplicate Prevention**: Tracks which transactions have already been synced
- **Status Tracking**: Maintains sync status and error information
- **Rate Limiting**: Helps manage API call limits efficiently
- **Data Transformation**: Handles data format differences between systems

### Is this free to use?

The add-on itself is free and open source. However, you'll need:
- **Xano**: Free tier supports up to 1,000 API calls/month (usually sufficient)
- **Xero**: Standard Xero subscription (if you don't already have one)
- **Actual Budget**: Free and open source

### How secure is my financial data?

- All API credentials are stored securely in Home Assistant
- Communications use HTTPS encryption
- No sensitive data is logged
- The add-on only reads reconciled transactions (not all financial data)
- Xano acts as a secure middleware without exposing credentials

## Installation and Setup

### What are the system requirements?

- **Home Assistant**: Version 2023.1 or later
- **Memory**: 512MB RAM minimum (1GB recommended)
- **Network**: Access to Actual Budget, Xano, and Xero APIs
- **Architecture**: Supports aarch64, amd64, armhf, armv7, i386

### Can I run this without Home Assistant?

The add-on is specifically designed for Home Assistant. However, the core sync logic could potentially be adapted to run as a standalone Node.js application with some modifications.

### Do I need a Xero developer account?

Yes, you need to create a free Xero developer account to get OAuth credentials. This is separate from your regular Xero subscription and doesn't cost extra.

### Can I use this with Xero's sandbox environment?

Yes! You can configure the add-on to use Xero's sandbox for testing. Just use your sandbox tenant ID and ensure your OAuth app is configured for sandbox access.

### How do I get my Actual Budget category group ID?

You can use either the category group ID or name. To find the ID:
1. Open Actual Budget in a browser
2. Go to your budget categories
3. The URL will show the group ID, or use the browser's developer tools to inspect the category group elements

## Configuration and Usage

### What transactions get synced?

Only transactions that are:
- **Reconciled** in Actual Budget
- **In your designated business category group**
- **Within the configured date range** (default: last 7 days)
- **Have valid category and payee mappings** in Xano

### How often does the sync run?

By default, the sync runs weekly on Monday at 2 AM. You can customize this by:
- Changing the `sync_schedule` configuration (uses cron format)
- Running manual syncs through the web interface
- Triggering syncs via Home Assistant automations

### Can I sync historical transactions?

Yes! Adjust the `sync_days_back` setting to look further back in time. However:
- Be mindful of API rate limits
- Large historical syncs may take time
- Ensure your Xano plan can handle the API calls

### What happens if a transaction already exists in Xero?

The system uses unique references (format: "Xano-{ID}") to prevent duplicates. If a transaction with the same reference exists in Xero, it won't be created again.

### How do I handle missing mappings?

When mappings are missing:
1. The transaction is stored in Xano but not sent to Xero
2. You'll see warnings in the logs and web interface
3. Add the missing mappings in Xano
4. Use the "Reprocess Failed Transactions" function to retry

### Can I modify transactions after they're synced?

- **In Actual Budget**: Changes won't automatically sync to Xero
- **In Xero**: You can modify transactions normally
- **In Xano**: Don't modify transaction records directly

## Troubleshooting

### The add-on won't start

**Check these common issues:**

1. **Configuration Errors**
   - Verify all required fields are filled
   - Check URL formats (must include http:// or https://)
   - Ensure API keys are correct

2. **Network Issues**
   - Test if Actual Budget URL is accessible from Home Assistant
   - Verify internet connectivity for Xano and Xero APIs
   - Check firewall settings

3. **Resource Issues**
   - Ensure sufficient memory is available
   - Check Home Assistant logs for resource constraints

### No transactions are being synced

**Possible causes and solutions:**

1. **No Reconciled Transactions**
   - Check if you have reconciled transactions in the date range
   - Verify transactions are in the correct category group

2. **Wrong Category Group**
   - Double-check the category group name/ID
   - Ensure it matches exactly (case-sensitive)

3. **Date Range Issues**
   - Increase `sync_days_back` if transactions are older
   - Check transaction dates in Actual Budget

4. **API Connection Issues**
   - Verify Actual Budget password and URL
   - Test API connectivity manually

### Transactions are stored in Xano but not imported to Xero

**Common causes:**

1. **Missing Mappings**
   - Check category_mappings table in Xano
   - Verify payee_mappings table in Xano
   - Add missing mappings and reprocess

2. **Invalid Xero Credentials**
   - Verify OAuth client ID and secret
   - Check tenant ID is correct
   - Ensure OAuth app is active

3. **Xero API Issues**
   - Check for Xero service outages
   - Verify account permissions in Xero
   - Review Xero API rate limits

### Rate limiting errors

**If you're hitting rate limits:**

1. **Xano Rate Limits**
   - Reduce `xano_rate_limit` setting
   - Upgrade to a paid Xano plan
   - Reduce `batch_size` to process fewer transactions at once

2. **Xero Rate Limits**
   - Reduce sync frequency
   - Process transactions in smaller batches
   - Spread syncs across different times

### Mapping issues

**Common mapping problems:**

1. **Invalid Xero IDs**
   - Verify account IDs exist in Xero
   - Check contact IDs are correct
   - Ensure accounts/contacts are active

2. **Inactive Mappings**
   - Check `is_active` field in Xano mappings
   - Reactivate mappings if needed

3. **Missing Required Fields**
   - Ensure all required mapping fields are filled
   - Verify data types match expectations

## Advanced Configuration

### Can I customize the sync logic?

The add-on is designed to be configurable through settings. For custom logic modifications, you would need to:
- Fork the repository
- Modify the source code
- Build your own version

### How do I set up multiple Xero organizations?

Currently, the add-on supports one Xero tenant at a time. For multiple organizations:
- Run separate add-on instances with different configurations
- Use different Xano workspaces for each organization

### Can I sync to multiple accounting systems?

The current version only supports Xero. Adding support for other accounting systems would require code modifications.

### How do I backup my configuration and mappings?

1. **Configuration**: Export your add-on configuration from Home Assistant
2. **Mappings**: Export data from Xano database tables
3. **Automation**: Document your Home Assistant automations

### Can I run this in a Docker container outside Home Assistant?

While possible, it would require:
- Modifying the configuration system
- Removing Home Assistant-specific integrations
- Handling the web interface differently

## Performance and Scaling

### How many transactions can this handle?

Performance depends on:
- **Xano plan limits**: Free tier ~1,000 API calls/month
- **System resources**: More RAM allows larger batches
- **Network speed**: Affects API call performance

Typical performance:
- **Small business**: 50-200 transactions/month - Free tier sufficient
- **Medium business**: 500+ transactions/month - Paid Xano plan recommended

### How do I optimize performance?

1. **Batch Size**: Increase `batch_size` for faster processing (if resources allow)
2. **Rate Limiting**: Optimize `xano_rate_limit` based on your plan
3. **Sync Frequency**: Reduce frequency if you don't need real-time sync
4. **Date Range**: Minimize `sync_days_back` to reduce API calls

### What happens during high transaction volumes?

The system handles high volumes by:
- Processing transactions in configurable batches
- Implementing rate limiting to prevent API overload
- Providing detailed progress logging
- Allowing resume of interrupted syncs

## Data and Privacy

### What data is stored where?

- **Home Assistant**: Configuration and credentials only
- **Xano**: Transaction data, mappings, and sync status
- **Actual Budget**: Original transaction data (unchanged)
- **Xero**: Imported transaction records

### Can I delete synced data?

- **From Xano**: Yes, but this may cause sync issues
- **From Xero**: Yes, transactions can be deleted normally
- **From Actual Budget**: Original transactions remain unchanged

### How long is data retained?

- **Xano**: According to your Xano plan (typically indefinite)
- **Logs**: Configurable in Home Assistant (default: 30 days)
- **Xero**: According to Xero's data retention policies

### Is my data encrypted?

- **In transit**: All API communications use HTTPS/TLS encryption
- **At rest**: Depends on each service's encryption policies
- **Credentials**: Stored securely in Home Assistant's encrypted storage

## Integration and Automation

### How do I set up notifications for sync failures?

```yaml
automation:
  - alias: "Sync Error Notification"
    trigger:
      platform: state
      entity_id: sensor.actual_xero_sync_status
      to: "error"
    action:
      service: notify.mobile_app
      data:
        message: "Actual-Xero sync failed. Check logs for details."
```

### Can I trigger syncs based on other events?

Yes! You can create automations that trigger syncs when:
- New transactions are added to Actual Budget
- Specific time intervals
- Manual triggers from dashboards
- External webhooks or API calls

### How do I monitor sync performance?

The add-on provides:
- **Web dashboard**: Real-time status and statistics
- **Home Assistant entities**: For use in dashboards and automations
- **Detailed logs**: For troubleshooting and monitoring
- **API endpoints**: For custom monitoring solutions

### Can I integrate with other Home Assistant add-ons?

Yes! The add-on exposes:
- **Entities**: For dashboard display
- **Services**: For automation triggers
- **Events**: For custom integrations

## Support and Community

### How do I report bugs?

1. Check the [troubleshooting guide](TROUBLESHOOTING.md) first
2. Search existing [GitHub issues](https://github.com/user/actual-xero-sync-addon/issues)
3. Create a new issue with:
   - Detailed description
   - Steps to reproduce
   - Log entries
   - Configuration (remove sensitive data)

### How can I contribute?

- **Report bugs** and suggest features
- **Improve documentation** and guides
- **Share configuration examples** and tips
- **Submit code contributions** via pull requests
- **Help other users** in discussions and forums

### Where can I get help?

- 📖 **Documentation**: Check the docs/ folder
- 🐛 **Issues**: GitHub Issues for bugs
- 💬 **Discussions**: GitHub Discussions for questions
- 🏠 **Community**: Home Assistant Community forums
- 📧 **Direct**: Contact maintainers for urgent issues

### How do I stay updated?

- **Watch** the GitHub repository for updates
- **Subscribe** to release notifications
- **Follow** the changelog for new features
- **Join** community discussions for tips and updates

---

## Still Have Questions?

If your question isn't answered here:

1. Check the [full documentation](README.md)
2. Search [GitHub Discussions](https://github.com/user/actual-xero-sync-addon/discussions)
3. Ask in the [Home Assistant Community](https://community.home-assistant.io/)
4. Create a [new issue](https://github.com/user/actual-xero-sync-addon/issues) if you found a bug

We're here to help make your transaction syncing as smooth as possible! 🚀