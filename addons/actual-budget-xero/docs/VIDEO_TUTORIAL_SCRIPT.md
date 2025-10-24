# Video Tutorial Script

This document provides scripts for creating video tutorials for the Actual-Xero Sync add-on. Use these scripts to create consistent, helpful video content for users.

## Tutorial 1: Complete Setup Guide (15-20 minutes)

### Introduction (1 minute)

**Script:**
"Welcome to the Actual-Xero Sync setup tutorial. In this video, I'll show you how to automatically sync your business transactions from Actual Budget to Xero using Home Assistant. By the end of this tutorial, you'll have a fully automated system that eliminates manual data entry for your business accounting.

What we'll cover:
- Installing the Home Assistant add-on
- Setting up the Xano backend
- Configuring Xero OAuth
- Running your first sync
- Setting up category and payee mappings

Let's get started!"

**Screen:** Show the final working dashboard with successful sync results

### Prerequisites Check (2 minutes)

**Script:**
"Before we begin, make sure you have these prerequisites ready:

First, you need Home Assistant running - version 2023.1 or later. I'm using version [current version] here.

Second, you need Actual Budget running and accessible. I have mine running on this local server at port 5006. Make sure you have at least one business category group set up with some reconciled transactions.

Third, you'll need a Xano account - the free tier works great to start with.

Finally, you'll need a Xero account and developer access to create an OAuth app.

If you don't have any of these set up yet, pause the video and get those ready first."

**Screen:** Show each prerequisite system running

### Installing the Add-on (3 minutes)

**Script:**
"Let's start by installing the add-on in Home Assistant.

Go to Supervisor, then Add-on Store. Click the menu button in the top right corner and select Repositories.

Add this repository URL: [show URL on screen]

Now search for 'Actual-Xero Sync' in the add-on store. Click on it and then click Install.

This will take a few minutes to download and install. While that's happening, let's set up our Xano backend."

**Screen:** Show the complete installation process in Home Assistant

### Setting Up Xano (5 minutes)

**Script:**
"Now let's set up our Xano backend. Go to xano.io and create a free account if you don't have one.

Create a new workspace called 'Actual-Xero-Sync'.

Now we need to create our database tables. Xano has an AI assistant that makes this really easy. I'll use this prompt to create all three tables we need:

[Show the AI prompt on screen and paste it]

Watch as Xano creates our three tables: transactions, category_mappings, and payee_mappings. This is where we'll store our sync data and mappings.

Next, we need to create API endpoints. I'll use the AI assistant again to create our endpoints:

[Show creating each endpoint with AI prompts]

Now let's get our API credentials. Go to Settings, then API. Copy your API base URL - mine is [show URL]. Generate an API key and copy that too. We'll need these for our add-on configuration."

**Screen:** Show the complete Xano setup process

### Configuring Xero OAuth (3 minutes)

**Script:**
"Now let's set up Xero OAuth. Go to developer.xero.com and sign in with your Xero account.

Click 'New App' and select 'Web App'. Fill in the details:
- App Name: 'Actual-Xero Sync'
- Company URL: You can use your website or just localhost
- Redirect URI: 'http://localhost:8080/auth/callback'

Click Create App. Now copy your Client ID and generate a Client Secret. Copy that too.

You'll also need your Tenant ID. Go to your Xero organization settings to find this. It's usually shown in the URL or organization details.

Keep these credentials handy - we'll need them in the next step."

**Screen:** Show the complete Xero OAuth app creation process

### Configuring the Add-on (4 minutes)

**Script:**
"Now let's configure our add-on. Go back to Home Assistant and open the Actual-Xero Sync add-on.

Click on the Configuration tab. Here's where we'll enter all our settings:

For Actual Budget:
- URL: This is your Actual Budget server URL
- Password: Your Actual Budget password
- Category Group: The name of your business category group

For Xano:
- API URL: The URL we copied from Xano
- API Key: The key we generated
- Rate Limit: I'll set this to 18 for the free plan

For Xero:
- Client ID: From our OAuth app
- Client Secret: From our OAuth app  
- Tenant ID: From your Xero organization

I'll leave the sync settings at their defaults for now.

Click Save to save the configuration."

**Screen:** Show filling in the complete configuration

### First Sync Test (2 minutes)

**Script:**
"Now let's start the add-on and run our first sync. Click on the Info tab and click Start.

Let's check the logs to see if it starts successfully. Great! No errors.

Now let's access the web interface. Open a new tab and go to your Home Assistant IP address on port 8080.

Here's our dashboard! Let's run a manual sync to see what happens. Click the Manual Sync button.

Watch the logs as it processes. As expected, we get some transactions from Actual Budget, they're stored in Xano, but we have missing mappings. This is normal for the first run - we need to set up our category and payee mappings."

**Screen:** Show the first sync process and results

### Setting Up Mappings (3 minutes)

**Script:**
"Let's set up our mappings in Xano. Go back to your Xano workspace and click on Database.

Look at the category_mappings table. You can see all your Actual Budget categories are here, but they don't have Xero account IDs yet.

Let's map a few categories. For 'Office Supplies', I'll find the corresponding account in Xero. In Xero, go to Accounting, then Chart of Accounts. I'll use 'Office Expenses' which has account code 449.

Back in Xano, I'll edit the Office Supplies mapping and add the Xero account ID, name, and code.

Let's do the same for payee mappings. In the payee_mappings table, I can see my payees. For 'Office Depot', I'll create or find the contact in Xero and add the contact ID to the mapping.

You don't need to map everything at once - start with your most common categories and payees."

**Screen:** Show the mapping process in both Xano and Xero

### Testing Complete Workflow (2 minutes)

**Script:**
"Now let's test the complete workflow. Go back to the add-on web interface and run another manual sync.

This time, watch what happens. We fetch transactions, store them in Xano, resolve the mappings we just created, and successfully import transactions to Xero!

Let's verify in Xero. Go to Bank Transactions and look for transactions with references starting with 'Xano-'. Perfect! Our transactions are here with the correct amounts, dates, and categories.

Let's also check Actual Budget. Look at the transaction notes - you can see the sync tags have been added: '#xano' and '#xero'. This helps you track which transactions have been synced."

**Screen:** Show the successful sync and verification in both systems

### Setting Up Automation (1 minute)

**Script:**
"Finally, let's set up automatic syncing. In Home Assistant, go to Configuration, then Automations. Create a new automation with a time trigger - I'll set it for Monday at 2 AM.

For the action, use the service 'actual_xero_sync.run_sync'. Save the automation.

Now your transactions will sync automatically every week!"

**Screen:** Show creating the automation in Home Assistant

### Conclusion (1 minute)

**Script:**
"Congratulations! You now have fully automated business transaction syncing between Actual Budget and Xero. 

Key points to remember:
- Add new category and payee mappings as needed
- Use the reprocess function for previously skipped transactions
- Monitor the dashboard for any sync issues
- Check the documentation for advanced configuration options

Thanks for watching! If you have questions, check the documentation or ask in the GitHub discussions. Happy syncing!"

**Screen:** Show the final working dashboard

---

## Tutorial 2: Troubleshooting Common Issues (10 minutes)

### Introduction (30 seconds)

**Script:**
"In this video, I'll walk you through the most common issues you might encounter with Actual-Xero Sync and how to solve them. These are real problems that users have reported, so this should help you get unstuck quickly."

### Issue 1: Add-on Won't Start (2 minutes)

**Script:**
"The most common issue is the add-on not starting. Let's look at the logs to see what's happening.

Here I can see a configuration error - it says 'Invalid URL format'. This usually means you forgot the 'http://' or 'https://' prefix on your URLs.

Let me fix the Actual Budget URL... there we go. Now let's restart the add-on.

Another common cause is wrong API credentials. If you see authentication errors, double-check your API keys and passwords. Make sure there are no extra spaces or characters."

**Screen:** Show log errors and fixing configuration issues

### Issue 2: No Transactions Found (2 minutes)

**Script:**
"If the sync runs but finds no transactions, there are a few things to check.

First, make sure you have reconciled transactions in your business category group. In Actual Budget, I can see I have reconciled transactions here.

Second, check your category group name. It needs to match exactly - it's case sensitive. I had 'business expenses' but it should be 'Business Expenses' with capital letters.

Third, check your date range. If your transactions are older than 7 days, increase the 'sync_days_back' setting."

**Screen:** Show checking transactions in Actual Budget and fixing configuration

### Issue 3: Missing Mappings (2 minutes)

**Script:**
"If transactions are stored in Xano but not imported to Xero, you probably have missing mappings.

Go to your Xano database and check the category_mappings and payee_mappings tables. Look for entries where the Xero IDs are empty.

Here I can see 'Travel Expenses' doesn't have a Xero account ID. Let me add that mapping.

After adding mappings, use the 'Reprocess Failed Transactions' button to retry the previously skipped transactions."

**Screen:** Show finding and fixing missing mappings

### Issue 4: Rate Limiting Errors (1.5 minutes)

**Script:**
"If you see rate limiting errors, you're making too many API calls too quickly.

For Xano, reduce the 'xano_rate_limit' setting. I'll change it from 20 to 15.

You can also reduce the 'batch_size' to process fewer transactions at once.

If you're on Xano's free plan and hitting the monthly limit, consider upgrading or reducing sync frequency."

**Screen:** Show rate limiting errors and configuration changes

### Issue 5: Xero Authentication Problems (1.5 minutes)

**Script:**
"Xero authentication issues usually mean your OAuth credentials are wrong or expired.

Check that your Client ID and Client Secret are correct. Make sure your Tenant ID matches your Xero organization.

Also verify that your OAuth app is still active in the Xero developer console. Sometimes apps get deactivated if not used regularly."

**Screen:** Show checking Xero credentials and OAuth app status

### Issue 6: Data Sync Inconsistencies (30 seconds)

**Script:**
"If you see data inconsistencies, check the transaction details in all three systems. Make sure the amounts, dates, and descriptions match what you expect.

Sometimes currency formatting or date formats can cause issues. Check your Xero organization settings to ensure they match your Actual Budget setup."

**Screen:** Show comparing transaction data across systems

### Conclusion (30 seconds)

**Script:**
"Those are the most common issues and their solutions. Remember to always check the logs first - they usually tell you exactly what's wrong. If you're still stuck, check the troubleshooting guide or ask for help in the GitHub discussions."

---

## Tutorial 3: Advanced Configuration (8 minutes)

### Introduction (30 seconds)

**Script:**
"In this video, I'll show you advanced configuration options and tips for power users. We'll cover custom sync schedules, bulk mapping management, performance optimization, and integration with Home Assistant automations."

### Custom Sync Schedules (2 minutes)

**Script:**
"The default sync schedule is weekly, but you can customize this with cron expressions.

For daily syncing at 3 AM: '0 3 * * *'
For twice weekly (Monday and Thursday): '0 2 * * 1,4'  
For monthly on the 1st: '0 2 1 * *'

You can also create multiple automations in Home Assistant for different sync triggers - maybe a quick sync after business hours and a full sync weekly."

**Screen:** Show different cron configurations and Home Assistant automations

### Performance Optimization (2 minutes)

**Script:**
"For better performance, you can tune several settings.

Increase 'batch_size' if you have sufficient memory and want faster processing. I'll change it from 10 to 25.

Adjust 'xano_rate_limit' based on your plan. Paid plans can handle higher rates.

Use 'sync_days_back' strategically - smaller values mean fewer API calls but might miss transactions.

Monitor your resource usage in Home Assistant to find the optimal settings for your system."

**Screen:** Show performance settings and monitoring

### Bulk Mapping Management (2 minutes)

**Script:**
"For large numbers of mappings, you can use Xano's bulk import features.

Export your existing mappings to CSV, edit them in a spreadsheet, then import them back. This is much faster than editing individual records.

You can also use Xano's API directly to programmatically create mappings if you have a lot of data to process."

**Screen:** Show CSV export/import process in Xano

### Advanced Home Assistant Integration (2 minutes)

**Script:**
"The add-on creates several entities in Home Assistant that you can use in dashboards and automations.

Create a dashboard card showing sync status, last run time, and transaction counts.

Set up notifications for sync failures or when new mappings are needed.

Use the sync service in complex automations - maybe trigger a sync when you mark transactions as reconciled in Actual Budget."

**Screen:** Show Home Assistant dashboard and automation examples

### Monitoring and Alerting (1 minute)

**Script:**
"Set up comprehensive monitoring to catch issues early.

Monitor the web dashboard regularly for sync health.

Create Home Assistant automations that alert you to failures.

Use the detailed logs to track performance trends and identify optimization opportunities."

**Screen:** Show monitoring setup and alert configurations

### Conclusion (30 seconds)

**Script:**
"These advanced features help you get the most out of your sync setup. Start with the basics and gradually add these optimizations as your needs grow. Check the documentation for even more configuration options!"

---

## Tutorial 4: Migration and Backup (5 minutes)

### Introduction (30 seconds)

**Script:**
"In this short tutorial, I'll show you how to backup your configuration and migrate to a new Home Assistant instance. This is important for protecting your setup and mappings."

### Backing Up Configuration (2 minutes)

**Script:**
"First, let's backup the add-on configuration. In Home Assistant, go to the add-on configuration and copy all settings to a secure file.

Next, backup your Xano data. In your Xano workspace, go to each table and export the data to CSV files. This includes your mappings and transaction history.

Also backup any Home Assistant automations that use the sync service."

**Screen:** Show backup process for each component

### Restoring Configuration (2 minutes)

**Script:**
"To restore on a new system, first install the add-on, then paste your saved configuration.

Import your Xano data using the CSV files you exported.

Recreate your Home Assistant automations.

Test the sync to make sure everything works correctly."

**Screen:** Show restoration process

### Migration Tips (30 seconds)

**Script:**
"When migrating, test thoroughly before decommissioning your old system. Keep backups for at least a month after migration. Consider this a good time to clean up old mappings and optimize your configuration."

---

## Production Notes for Video Creators

### Equipment Recommendations

- **Screen Recording**: OBS Studio or similar
- **Audio**: Clear microphone, quiet environment
- **Resolution**: 1080p minimum for readability
- **Frame Rate**: 30fps is sufficient

### Editing Guidelines

- **Pace**: Speak clearly, not too fast
- **Pauses**: Allow time for viewers to follow along
- **Highlights**: Use cursor highlights or zoom for important details
- **Chapters**: Add video chapters for easy navigation

### Publishing Checklist

- [ ] Test all steps shown in the video
- [ ] Verify all URLs and commands are correct
- [ ] Add closed captions for accessibility
- [ ] Include links to documentation in description
- [ ] Add timestamps in video description
- [ ] Test video on different devices/screen sizes

### Community Guidelines

- Encourage questions and feedback in comments
- Respond to common questions with pinned comments
- Update video descriptions when software versions change
- Create follow-up videos for frequently asked questions

---

These scripts provide a foundation for creating comprehensive video tutorials. Adapt the content based on your audience and platform requirements.