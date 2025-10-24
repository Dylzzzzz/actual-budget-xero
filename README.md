# Actual Budget Sync Add-on

Home Assistant add-on for syncing business transactions from Actual Budget to Xero via Xano.

## Features

- 🔄 **Automated Sync**: Sync business transactions from Actual Budget to Xero
- 🏠 **Home Assistant Integration**: Native Home Assistant add-on with web interface
- 📊 **Xano Integration**: Uses Xano as middleware for data processing
- 🎯 **Category Filtering**: Only syncs specified business category groups
- 📅 **Scheduled Sync**: Configurable sync schedule (default: weekly)
- 🌐 **Web Interface**: Monitor sync status and trigger manual syncs

## Installation

1. **Add Repository**: Add this repository to Home Assistant
   ```
   https://github.com/Dylzzzzz/actual-budget-addon
   ```

2. **Install Add-on**: Find "Actual-Xero Sync" in the add-on store and install

3. **Configure**: Set up your credentials in the add-on configuration:
   - Actual Budget server URL and password
   - Business category group details
   - Xano API URL and key
   - Xero client credentials

4. **Start**: Start the add-on and access the web interface

## Configuration

All configuration is done through the Home Assistant add-on interface:

- **Actual Budget**: Server URL, password, and business category group
- **Xano**: API URL, API key, and rate limiting
- **Xero**: Client ID, client secret, and tenant ID
- **Sync Settings**: Schedule, lookback days, and batch size

## Usage

- **Web Interface**: Access via the add-on's web UI to monitor status
- **Manual Sync**: Trigger syncs manually through the web interface
- **Scheduled Sync**: Automatic syncs run according to your schedule
- **Home Assistant**: Monitor through Home Assistant entities and automations

## Support

This add-on syncs business transactions from Actual Budget to Xero accounting software using Xano as a middleware platform for data processing and transformation.