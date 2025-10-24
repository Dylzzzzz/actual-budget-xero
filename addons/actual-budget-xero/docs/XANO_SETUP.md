# Xano Backend Setup Guide

This comprehensive guide provides step-by-step instructions for setting up the Xano backend required for the Actual-Xero Sync system, following Xano's actual interface and workflow.

## Overview

Xano serves as the middleware layer that:
- Stores transaction data from Actual Budget
- Manages category and payee mappings between Actual Budget and Xero
- Provides secure API endpoints for the sync process
- Handles business logic, data validation, and duplicate prevention
- Enables auto-resolution of missing mappings

## Prerequisites

1. **Xano Account**: Sign up at [xano.io](https://xano.io) - Free tier is sufficient to start
2. **Basic Understanding**: Familiarity with databases and APIs (helpful but not required)
3. **Time Required**: Approximately 30-45 minutes for complete setup

## Step 1: Create Your Xano Workspace

### 1.1 Sign Up and Create Workspace

1. Go to [xano.io](https://xano.io) and click **"Start Building for Free"**
2. Create your account using email or Google/GitHub
3. Once logged in, click **"Create New Workspace"**
4. Name your workspace: `Actual-Xero-Sync`
5. Select your preferred region (choose closest to your Home Assistant)
6. Click **"Create Workspace"**

### 1.2 Workspace Overview

You'll see the main Xano dashboard with these sections:
- **Database**: Where we'll create our tables
- **API**: Where we'll build our endpoints
- **Functions**: For custom business logic
- **Settings**: For API keys and configuration

## Step 2: Create Database Tables

We need three tables to manage the sync process. We'll create them manually for better understanding.

### 2.1 Create Transactions Table

1. **Navigate to Database**
   - Click **"Database"** in the left sidebar
   - Click **"Add Table"** button

2. **Configure Table Settings**
   - **Table Name**: `transactions`
   - **Description**: `Stores transaction data from Actual Budget with sync status`
   - Click **"Create Table"**

3. **Add Fields** (Xano automatically creates an `id` field)
   
   **Field 1: actual_transaction_id**
   - Click **"Add Field"**
   - **Field Name**: `actual_transaction_id`
   - **Field Type**: `Text`
   - **Settings**: 
     - Check ✅ **Required**
     - Check ✅ **Unique**
   - Click **"Save Field"**

   **Field 2: transaction_date**
   - Click **"Add Field"**
   - **Field Name**: `transaction_date`
   - **Field Type**: `Date`
   - **Settings**: Check ✅ **Required**
   - Click **"Save Field"**

   **Field 3: created_date**
   - Click **"Add Field"**
   - **Field Name**: `created_date`
   - **Field Type**: `Timestamp`
   - **Settings**: Check ✅ **Auto set on create**
   - Click **"Save Field"**

   **Field 4: amount**
   - Click **"Add Field"**
   - **Field Name**: `amount`
   - **Field Type**: `Float`
   - **Settings**: Check ✅ **Required**
   - Click **"Save Field"**

   **Field 5: description**
   - Click **"Add Field"**
   - **Field Name**: `description`
   - **Field Type**: `Long Text`
   - **Settings**: Leave unchecked (optional)
   - Click **"Save Field"**

   **Field 6: actual_category_id**
   - Click **"Add Field"**
   - **Field Name**: `actual_category_id`
   - **Field Type**: `Text`
   - **Settings**: Leave unchecked (optional)
   - Click **"Save Field"**

   **Field 7: actual_payee_id**
   - Click **"Add Field"**
   - **Field Name**: `actual_payee_id`
   - **Field Type**: `Text`
   - **Settings**: Leave unchecked (optional)
   - Click **"Save Field"**

   **Field 8: xero_account_id**
   - Click **"Add Field"**
   - **Field Name**: `xero_account_id`
   - **Field Type**: `Text`
   - **Settings**: Leave unchecked (optional)
   - Click **"Save Field"**

   **Field 9: xero_contact_id**
   - Click **"Add Field"**
   - **Field Name**: `xero_contact_id`
   - **Field Type**: `Text`
   - **Settings**: Leave unchecked (optional)
   - Click **"Save Field"**

   **Field 10: xero_transaction_id**
   - Click **"Add Field"**
   - **Field Name**: `xero_transaction_id`
   - **Field Type**: `Text`
   - **Settings**: Leave unchecked (optional)
   - Click **"Save Field"**

   **Field 11: xero_imported_date**
   - Click **"Add Field"**
   - **Field Name**: `xero_imported_date`
   - **Field Type**: `Timestamp`
   - **Settings**: Leave unchecked (optional)
   - Click **"Save Field"**

   **Field 12: status**
   - Click **"Add Field"**
   - **Field Name**: `status`
   - **Field Type**: `Enum`
   - **Enum Values**: 
     - `pending`
     - `mapped`
     - `imported`
     - `failed`
   - **Default Value**: `pending`
   - Click **"Save Field"**

   **Field 13: error_message**
   - Click **"Add Field"**
   - **Field Name**: `error_message`
   - **Field Type**: `Long Text`
   - **Settings**: Leave unchecked (optional)
   - Click **"Save Field"**

### 2.2 Create Category Mappings Table

1. **Create New Table**
   - Click **"Add Table"** button
   - **Table Name**: `category_mappings`
   - **Description**: `Maps Actual Budget categories to Xero accounts`
   - Click **"Create Table"**

2. **Add Fields**

   **Field 1: actual_category_id**
   - Click **"Add Field"**
   - **Field Name**: `actual_category_id`
   - **Field Type**: `Text`
   - **Settings**: 
     - Check ✅ **Required**
     - Check ✅ **Unique**
   - Click **"Save Field"**

   **Field 2: actual_category_name**
   - Click **"Add Field"**
   - **Field Name**: `actual_category_name`
   - **Field Type**: `Text`
   - **Settings**: Check ✅ **Required**
   - Click **"Save Field"**

   **Field 3: xero_account_id**
   - Click **"Add Field"**
   - **Field Name**: `xero_account_id`
   - **Field Type**: `Text`
   - **Settings**: Leave unchecked (optional)
   - Click **"Save Field"**

   **Field 4: xero_account_name**
   - Click **"Add Field"**
   - **Field Name**: `xero_account_name`
   - **Field Type**: `Text`
   - **Settings**: Leave unchecked (optional)
   - Click **"Save Field"**

   **Field 5: xero_account_code**
   - Click **"Add Field"**
   - **Field Name**: `xero_account_code`
   - **Field Type**: `Text`
   - **Settings**: Leave unchecked (optional)
   - Click **"Save Field"**

   **Field 6: is_active**
   - Click **"Add Field"**
   - **Field Name**: `is_active`
   - **Field Type**: `Boolean`
   - **Default Value**: `true`
   - Click **"Save Field"**

   **Field 7: created_date**
   - Click **"Add Field"**
   - **Field Name**: `created_date`
   - **Field Type**: `Timestamp`
   - **Settings**: Check ✅ **Auto set on create**
   - Click **"Save Field"**

   **Field 8: updated_date**
   - Click **"Add Field"**
   - **Field Name**: `updated_date`
   - **Field Type**: `Timestamp`
   - **Settings**: 
     - Check ✅ **Auto set on create**
     - Check ✅ **Auto set on update**
   - Click **"Save Field"**

### 2.3 Create Payee Mappings Table

1. **Create New Table**
   - Click **"Add Table"** button
   - **Table Name**: `payee_mappings`
   - **Description**: `Maps Actual Budget payees to Xero contacts`
   - Click **"Create Table"**

2. **Add Fields** (following the same pattern as category_mappings)

   **Field 1: actual_payee_id**
   - **Field Name**: `actual_payee_id`
   - **Field Type**: `Text`
   - **Settings**: Required ✅, Unique ✅

   **Field 2: actual_payee_name**
   - **Field Name**: `actual_payee_name`
   - **Field Type**: `Text`
   - **Settings**: Required ✅

   **Field 3: xero_contact_id**
   - **Field Name**: `xero_contact_id`
   - **Field Type**: `Text`
   - **Settings**: Optional

   **Field 4: xero_contact_name**
   - **Field Name**: `xero_contact_name`
   - **Field Type**: `Text`
   - **Settings**: Optional

   **Field 5: is_active**
   - **Field Name**: `is_active`
   - **Field Type**: `Boolean`
   - **Default Value**: `true`

   **Field 6: created_date**
   - **Field Name**: `created_date`
   - **Field Type**: `Timestamp`
   - **Settings**: Auto set on create ✅

   **Field 7: updated_date**
   - **Field Name**: `updated_date`
   - **Field Type**: `Timestamp`
   - **Settings**: Auto set on create ✅, Auto set on update ✅

## Step 3: Create API Endpoints

Now we'll create the API endpoints that the Home Assistant add-on will use.

### 3.1 Store Transaction Endpoint (POST /transactions)

1. **Navigate to API**
   - Click **"API"** in the left sidebar
   - Click **"Add API Group"**
   - **Group Name**: `Transactions`
   - Click **"Create Group"**

2. **Create Endpoint**
   - Click **"Add Endpoint"** in the Transactions group
   - **Method**: `POST`
   - **Endpoint Path**: `/transactions`
   - **Description**: `Store or retrieve transaction from Actual Budget`
   - Click **"Create Endpoint"**

3. **Configure Function**
   - Click on the newly created endpoint
   - In the **Function Stack**, click **"Add Function"**
   - Select **"Custom Code"**
   - **Function Name**: `store_transaction`

4. **Add Function Code**
   ```javascript
   // Get input data from request body
   const {
     actual_transaction_id,
     transaction_date,
     amount,
     description,
     actual_category_id,
     actual_payee_id
   } = inputs.body;

   // Validate required fields
   if (!actual_transaction_id || !transaction_date || amount === undefined) {
     return {
       statusCode: 400,
       body: { error: 'Missing required fields: actual_transaction_id, transaction_date, amount' }
     };
   }

   // Check if transaction already exists
   const existing = await xano.db.transactions.getFirst({
     filter: {
       actual_transaction_id: {
         equals: actual_transaction_id
       }
     }
   });

   if (existing) {
     return {
       statusCode: 200,
       body: existing
     };
   }

   // Create new transaction
   try {
     const transaction = await xano.db.transactions.create({
       actual_transaction_id,
       transaction_date,
       amount: parseFloat(amount),
       description: description || '',
       actual_category_id: actual_category_id || null,
       actual_payee_id: actual_payee_id || null,
       status: 'pending'
     });

     return {
       statusCode: 201,
       body: transaction
     };
   } catch (error) {
     return {
       statusCode: 500,
       body: { error: 'Failed to create transaction', details: error.message }
     };
   }
   ```

5. **Save Function**
   - Click **"Save"** to save the function
   - Click **"Save Endpoint"** to save the endpoint

### 3.2 Get Category Mapping Endpoint (GET /category-mappings/{actual_category_id})

1. **Create New API Group**
   - Click **"Add API Group"**
   - **Group Name**: `Mappings`
   - Click **"Create Group"**

2. **Create Endpoint**
   - Click **"Add Endpoint"** in the Mappings group
   - **Method**: `GET`
   - **Endpoint Path**: `/category-mappings/{actual_category_id}`
   - **Description**: `Get category mapping by Actual Budget category ID`
   - Click **"Create Endpoint"**

3. **Configure Path Parameter**
   - In the endpoint settings, you'll see **Path Parameters**
   - Xano automatically detects `actual_category_id` from the path
   - **Parameter Type**: `Text`

4. **Add Function Code**
   ```javascript
   const { actual_category_id } = inputs.params;

   if (!actual_category_id) {
     return {
       statusCode: 400,
       body: { error: 'Missing actual_category_id parameter' }
     };
   }

   try {
     const mapping = await xano.db.category_mappings.getFirst({
       filter: {
         actual_category_id: {
           equals: actual_category_id
         },
         is_active: {
           equals: true
         }
       }
     });

     if (!mapping) {
       return {
         statusCode: 404,
         body: { error: 'Category mapping not found' }
       };
     }

     return {
       statusCode: 200,
       body: mapping
     };
   } catch (error) {
     return {
       statusCode: 500,
       body: { error: 'Database error', details: error.message }
     };
   }
   ```

### 3.3 Get Payee Mapping Endpoint (GET /payee-mappings/{actual_payee_id})

1. **Create Endpoint**
   - In the Mappings group, click **"Add Endpoint"**
   - **Method**: `GET`
   - **Endpoint Path**: `/payee-mappings/{actual_payee_id}`
   - **Description**: `Get payee mapping by Actual Budget payee ID`

2. **Add Function Code**
   ```javascript
   const { actual_payee_id } = inputs.params;

   if (!actual_payee_id) {
     return {
       statusCode: 400,
       body: { error: 'Missing actual_payee_id parameter' }
     };
   }

   try {
     const mapping = await xano.db.payee_mappings.getFirst({
       filter: {
         actual_payee_id: {
           equals: actual_payee_id
         },
         is_active: {
           equals: true
         }
       }
     });

     if (!mapping) {
       return {
         statusCode: 404,
         body: { error: 'Payee mapping not found' }
       };
     }

     return {
       statusCode: 200,
       body: mapping
     };
   } catch (error) {
     return {
       statusCode: 500,
       body: { error: 'Database error', details: error.message }
     };
   }
   ```

### 3.4 Batch Get Mappings Endpoint (POST /mappings/batch)

1. **Create Endpoint**
   - In the Mappings group, click **"Add Endpoint"**
   - **Method**: `POST`
   - **Endpoint Path**: `/mappings/batch`
   - **Description**: `Get multiple category and payee mappings in one request`

2. **Add Function Code**
   ```javascript
   const { category_ids = [], payee_ids = [] } = inputs.body;

   try {
     // Get category mappings
     let categoryMappings = [];
     if (category_ids.length > 0) {
       categoryMappings = await xano.db.category_mappings.getMany({
         filter: {
           actual_category_id: {
             is_in: category_ids
           },
           is_active: {
             equals: true
           }
         }
       });
     }

     // Get payee mappings
     let payeeMappings = [];
     if (payee_ids.length > 0) {
       payeeMappings = await xano.db.payee_mappings.getMany({
         filter: {
           actual_payee_id: {
             is_in: payee_ids
           },
           is_active: {
             equals: true
           }
         }
       });
     }

     // Convert to maps for easier lookup
     const categories = {};
     categoryMappings.forEach(mapping => {
       categories[mapping.actual_category_id] = mapping;
     });

     const payees = {};
     payeeMappings.forEach(mapping => {
       payees[mapping.actual_payee_id] = mapping;
     });

     return {
       statusCode: 200,
       body: {
         categories,
         payees
       }
     };
   } catch (error) {
     return {
       statusCode: 500,
       body: { error: 'Database error', details: error.message }
     };
   }
   ```

### 3.5 Update Transaction Status Endpoint (PUT /transactions/{id}/status)

1. **Create Endpoint**
   - In the Transactions group, click **"Add Endpoint"**
   - **Method**: `PUT`
   - **Endpoint Path**: `/transactions/{id}/status`
   - **Description**: `Update transaction status and Xero details`

2. **Add Function Code**
   ```javascript
   const { id } = inputs.params;
   const {
     status,
     xero_account_id,
     xero_contact_id,
     xero_transaction_id,
     error_message
   } = inputs.body;

   if (!id || !status) {
     return {
       statusCode: 400,
       body: { error: 'Missing required fields: id, status' }
     };
   }

   try {
     // Check if transaction exists
     const existing = await xano.db.transactions.getFirst({
       filter: {
         id: {
           equals: parseInt(id)
         }
       }
     });

     if (!existing) {
       return {
         statusCode: 404,
         body: { error: 'Transaction not found' }
       };
     }

     // Prepare update data
     const updateData = { status };
     
     if (xero_account_id) updateData.xero_account_id = xero_account_id;
     if (xero_contact_id) updateData.xero_contact_id = xero_contact_id;
     if (xero_transaction_id) {
       updateData.xero_transaction_id = xero_transaction_id;
       updateData.xero_imported_date = new Date().toISOString();
     }
     if (error_message) updateData.error_message = error_message;

     // Update transaction
     const updated = await xano.db.transactions.update(existing.id, updateData);

     return {
       statusCode: 200,
       body: updated
     };
   } catch (error) {
     return {
       statusCode: 500,
       body: { error: 'Failed to update transaction', details: error.message }
     };
   }
   ```

### 3.6 Get Pending Transactions Endpoint (GET /transactions/pending)

1. **Create Endpoint**
   - In the Transactions group, click **"Add Endpoint"**
   - **Method**: `GET`
   - **Endpoint Path**: `/transactions/pending`
   - **Description**: `Get transactions that need processing`

2. **Add Function Code**
   ```javascript
   try {
     const pendingTransactions = await xano.db.transactions.getMany({
       filter: {
         status: {
           is_in: ['pending', 'failed']
         }
       },
       sort: [
         {
           field: 'created_date',
           direction: 'desc'
         }
       ]
     });

     return {
       statusCode: 200,
       body: {
         transactions: pendingTransactions,
         count: pendingTransactions.length
       }
     };
   } catch (error) {
     return {
       statusCode: 500,
       body: { error: 'Database error', details: error.message }
     };
   }
   ```

## Step 4: Configure API Settings

### 4.1 Generate API Key

1. **Navigate to Settings**
   - Click **"Settings"** in the left sidebar
   - Click **"API Keys"** tab

2. **Create API Key**
   - Click **"Generate New Key"**
   - **Key Name**: `Home Assistant Sync`
   - **Permissions**: Select **"Full Access"** (or customize as needed)
   - Click **"Generate Key"**

3. **Copy API Key**
   - Copy the generated API key immediately
   - Store it securely - you'll need it for Home Assistant configuration
   - **Important**: You won't be able to see this key again

### 4.2 Configure CORS (if needed)

1. **CORS Settings**
   - In Settings, click **"CORS"** tab
   - **Allowed Origins**: Add your Home Assistant URL (e.g., `http://192.168.1.100:8123`)
   - **Allowed Methods**: `GET, POST, PUT, DELETE, OPTIONS`
   - **Allowed Headers**: `Content-Type, Authorization, X-API-Key`
   - Click **"Save CORS Settings"**

### 4.3 Get Your API Base URL

1. **Find Your API URL**
   - Go to **API** section
   - Look for your **Base URL** at the top (e.g., `https://x123456.xano.io/api:v1`)
   - Copy this URL - you'll need it for Home Assistant configuration

## Step 5: Test Your Setup

### 5.1 Test Endpoints in Xano

1. **Use Built-in Tester**
   - Go to any endpoint you created
   - Click **"Test"** button
   - Fill in test data
   - Click **"Run Test"**

2. **Test Store Transaction**
   - Endpoint: `POST /transactions`
   - Test Body:
   ```json
   {
     "actual_transaction_id": "test-tx-001",
     "transaction_date": "2024-01-15",
     "amount": 25.99,
     "description": "Test Office Supplies",
     "actual_category_id": "cat-office-supplies",
     "actual_payee_id": "payee-office-depot"
   }
   ```

3. **Verify Database**
   - Go to **Database** → **transactions**
   - You should see your test transaction
   - Status should be "pending"

### 5.2 Add Sample Mappings

1. **Add Category Mapping**
   - Go to **Database** → **category_mappings**
   - Click **"Add Record"**
   - Fill in:
     - `actual_category_id`: `cat-office-supplies`
     - `actual_category_name`: `Office Supplies`
     - `is_active`: `true`
   - Click **"Save"**

2. **Add Payee Mapping**
   - Go to **Database** → **payee_mappings**
   - Click **"Add Record"**
   - Fill in:
     - `actual_payee_id`: `payee-office-depot`
     - `actual_payee_name`: `Office Depot`
     - `is_active`: `true`
   - Click **"Save"**

3. **Test Mapping Endpoints**
   - Test `GET /category-mappings/cat-office-supplies`
   - Test `GET /payee-mappings/payee-office-depot`
   - Both should return your sample data

## Step 6: Optimize Performance

### 6.1 Add Database Indexes

1. **Navigate to Database**
   - Go to each table
   - Click **"Indexes"** tab

2. **Add Indexes for Transactions Table**
   - Index on `actual_transaction_id` (should already exist due to unique constraint)
   - Index on `status`
   - Index on `created_date`

3. **Add Indexes for Mapping Tables**
   - Index on `actual_category_id` (category_mappings)
   - Index on `actual_payee_id` (payee_mappings)
   - Index on `is_active` (both tables)

### 6.2 Monitor Usage

1. **Check Usage Dashboard**
   - Go to **Settings** → **Usage**
   - Monitor API calls and database operations
   - Set up alerts if approaching limits

## Troubleshooting

### Common Issues and Solutions

**Issue: "Function failed to execute"**
- Check function syntax in the code editor
- Verify all variable names match exactly
- Look for missing semicolons or brackets

**Issue: "Database connection error"**
- Verify table names are spelled correctly
- Check that fields exist in the database
- Ensure proper field types are used

**Issue: "API key authentication failed"**
- Verify API key was copied correctly
- Check that API key has proper permissions
- Ensure API key hasn't expired

**Issue: "CORS errors from Home Assistant"**
- Add your Home Assistant URL to CORS settings
- Include all necessary headers
- Verify the URL format is correct

### Testing Tips

1. **Use Xano's Built-in Tester**
   - Test each endpoint individually
   - Verify responses match expected format
   - Check error handling with invalid data

2. **Monitor Logs**
   - Check function execution logs
   - Look for database query errors
   - Monitor API call patterns

3. **Start Simple**
   - Test with minimal data first
   - Add complexity gradually
   - Verify each step before proceeding

## Next Steps

After completing the Xano setup:

1. **Configure Home Assistant Add-on**
   - Use your API Base URL and API Key
   - Test the connection from Home Assistant
   - Run your first sync

2. **Set Up Mappings**
   - Add your actual business categories
   - Map to corresponding Xero accounts
   - Add common payees and contacts

3. **Monitor and Maintain**
   - Check sync logs regularly
   - Add new mappings as needed
   - Monitor API usage and performance

## Summary

You now have a complete Xano backend with:
- ✅ Three database tables for transaction and mapping data
- ✅ Six API endpoints for all sync operations
- ✅ Proper authentication and security settings
- ✅ Performance optimizations and indexes
- ✅ Error handling and validation

Your Xano workspace is ready to serve as the middleware for your Actual-Xero sync system!