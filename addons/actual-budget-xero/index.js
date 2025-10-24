const express = require('express');
const api = require('@actual-app/api');
const app = express();
app.use(express.json());

const fs = require('fs');

// Enable garbage collection if available
if (global.gc) {
  console.log('Garbage collection available');
} else {
  console.log('Garbage collection not available - run with --expose-gc flag');
}

// Memory monitoring function
function logMemoryUsage(label) {
  const used = process.memoryUsage();
  console.log(`${label} - Memory: RSS ${(used.rss / 1024 / 1024).toFixed(2)}MB, Heap ${(used.heapUsed / 1024 / 1024).toFixed(2)}MB / ${(used.heapTotal / 1024 / 1024).toFixed(2)}MB`);

  // Trigger GC if heap usage is high
  if (used.heapUsed / used.heapTotal > 0.8 && global.gc) {
    console.log('🧹 Triggering garbage collection...');
    global.gc();
    const afterGC = process.memoryUsage();
    console.log(`After GC - Heap ${(afterGC.heapUsed / 1024 / 1024).toFixed(2)}MB / ${(afterGC.heapTotal / 1024 / 1024).toFixed(2)}MB`);
  }
}
const ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL;
const PASSWORD = process.env.PASSWORD;
const BUDGET_ID = process.env.BUDGET_ID;
const IMPORT_GROUP_ID = process.env.IMPORT_GROUP_ID;

console.log('ACTUAL_SERVER_URL:', ACTUAL_SERVER_URL);
console.log('BUDGET_ID:', BUDGET_ID);
console.log('IMPORT_GROUP_ID:', IMPORT_GROUP_ID);

let actualInitialized = false;
let initializationInProgress = false;
let initializationError = null;

function logMemory(label) {
  logMemoryUsage(label);
}

async function initActual() {
  if (actualInitialized) {
    return;
  }

  if (initializationInProgress) {
    throw new Error('Initialization in progress. Please try again in a few minutes.');
  }

  if (initializationError) {
    throw new Error(`Previous initialization failed: ${initializationError.message}`);
  }

  throw new Error('System not ready. Initialization may still be in progress.');
}

async function performBackgroundInit() {
  if (actualInitialized || initializationInProgress) {
    return;
  }

  initializationInProgress = true;
  initializationError = null;

  try {
    const dataPath = process.env.NODE_ENV === 'pi' ? '/home/homeassistant/actual-data' : './actual-data';
    if (!fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath, { recursive: true });
    }

    console.log('🚀 Starting Actual API initialization...');
    logMemoryUsage('Before API init');

    await api.init({
      serverURL: ACTUAL_SERVER_URL,
      password: PASSWORD,
      dataDir: dataPath,
    });

    console.log('✅ API initialized, downloading budget...');
    logMemoryUsage('After API init');

    // Force garbage collection before heavy operation
    if (global.gc) {
      global.gc();
      logMemoryUsage('After GC before budget download');
    }

    // Add timeout for budget download
    const downloadPromise = api.downloadBudget(BUDGET_ID);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Budget download timeout')), 300000) // 5 minutes
    );

    const budgetResult = await Promise.race([downloadPromise, timeoutPromise]);
    console.log('✅ Budget download completed successfully');
    logMemoryUsage('After budget download');

    // Clean up after initialization
    if (global.gc) {
      global.gc();
      logMemoryUsage('After final GC');
    }

    actualInitialized = true;
    initializationInProgress = false;
    console.log('🎉 Actual API fully initialized and ready!');

  } catch (error) {
    console.error('❌ Failed to initialize Actual API:', error);
    initializationError = error;
    initializationInProgress = false;

    // Clean up memory on error
    if (global.gc) {
      global.gc();
      logMemoryUsage('After error cleanup GC');
    }

    // Retry after 5 minutes
    setTimeout(() => {
      console.log('🔄 Retrying initialization...');
      initializationError = null;
      performBackgroundInit();
    }, 300000);
  }
}

// Create Accounts with 0 starting balance
app.post('/create_account', async (req, res) => {
  try {
    await initActual();
    const { accounts } = req.body;

    if (!Array.isArray(accounts)) {
      return res.status(400).json({ error: "accounts must be an array" });
    }

    const created = [];

    for (const acc of accounts) {
      const accountName = acc.name ? acc.name : "Unnamed";
      const accountType = acc.type ? acc.type : null;
      const offBudget = acc.offbudget ? acc.offbudget : false;

      console.log('Creating account:', accountName, 'Type:', accountType);

      const accountId = await api.createAccount({
        name: accountName,
        type: accountType,
        offbudget: offBudget,
        balance: 0
      });

      created.push({ accountName, accountId });
    }

    res.json({ created });
  } catch (err) {
    console.error('Add accounts error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post('/import', async (req, res) => {
  const startTime = Date.now();
  const { accountId, transactions } = req.body;
  
  console.log(`Import started: ${accountId}, ${transactions?.length || 0} transactions`);
  console.log('Request body:', req.body);

  logMemoryUsage('Start of /import');
  
  const maxRetries = 3;
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      console.log(`Attempt ${attempt + 1}/${maxRetries} - Calling initActual...`);
      await initActual();
      console.log('After initActual');
      logMemoryUsage('After initActual');

      console.log('Processing transactions for import...');
      
      // Process transactions to add cleared status
      const processedTransactions = transactions.map(transaction => {
        const processed = { ...transaction };
        
        // Map PocketSmith status to Actual cleared status
        if (transaction.status) {
          processed.cleared = transaction.status.toLowerCase() === 'posted';
        }
        
        // Ensure required fields
        if (!processed.imported_id) {
          processed.imported_id = transaction.id || `${transaction.date}-${transaction.amount}-${Date.now()}`;
        }
        
        return processed;
      });
      
      console.log(`Calling api.importTransactions with ${processedTransactions.length} processed transactions...`);
      
      // Clean up before heavy operation
      if (global.gc) {
        global.gc();
        logMemoryUsage('Before importTransactions (after GC)');
      }
      
      let result;
      try {
        result = await api.importTransactions(accountId, processedTransactions);
        console.log('importTransactions result:', result);
      } catch (err) {
        console.error('Error in importTransactions:', err);
        throw err;
      }
      
      console.log('After importTransactions');
      logMemoryUsage('After importTransactions');

      // Clean up after operation
      if (global.gc) {
        global.gc();
        logMemoryUsage('After final cleanup GC');
      }

      if (!result) {
        console.error('importTransactions returned undefined!');
        result = { added: 0, updated: 0 };
      }

      const duration = Date.now() - startTime;
      console.log(`Import completed: ${accountId}, ${duration}ms, added: ${result.added || 0}, updated: ${result.updated || 0}`);

      if (result && result.errors && result.errors.length > 0) {
        res.status(400).json({ 
          status: 'error', 
          errors: result.errors,
          duration,
          attempt: attempt + 1
        });
      } else {
        res.json({
          status: 'success',
          added: result ? result.added : 0,
          updated: result ? result.updated : 0,
          duration,
          attempt: attempt + 1,
          processed: processedTransactions.length
        });
      }
      return; // Success, exit retry loop
      
    } catch (err) {
      attempt++;
      console.error(`Import attempt ${attempt} failed: ${accountId}, ${err.message}`);
      
      // Clean up on error
      if (global.gc) {
        global.gc();
        logMemoryUsage('After error cleanup GC');
      }
      
      if (attempt === maxRetries) {
        const duration = Date.now() - startTime;
        console.error(`Import failed after ${maxRetries} attempts: ${accountId}`);
        
        res.status(500).json({ 
          status: 'error', 
          error: err.message, 
          stack: err.stack,
          duration,
          attempts: maxRetries,
          accountId
        });
        return;
      }
      
      // Wait before retry (exponential backoff)
      const waitTime = 1000 * Math.pow(2, attempt - 1);
      console.log(`Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
});

app.post('/add-categories', async (req, res) => {
  try {
    await initActual();
    const { categories } = req.body;
    const created = [];

    for (const cat of categories) {
      const categoryName = cat.categoryName ? cat.categoryName : "Unnamed";
      console.log('Creating category:', categoryName, 'with group_id:', IMPORT_GROUP_ID);
      const categoryId = await api.createCategory({
        name: categoryName,
        group_id: IMPORT_GROUP_ID,
      });
      created.push({ categoryName, categoryId });
    }

    res.json({ created });
  } catch (err) {
    console.error('Add categories error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Actual Budget API Server',
    initialized: actualInitialized,
    initializationInProgress: initializationInProgress,
    timestamp: new Date().toISOString()
  });
});

// Status endpoint
app.get('/status', (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    initialized: actualInitialized,
    initializationInProgress: initializationInProgress,
    hasError: !!initializationError,
    error: initializationError?.message,
    uptime: process.uptime(),
    memory: {
      rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)}MB`,
      heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
      heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
      external: `${(memUsage.external / 1024 / 1024).toFixed(2)}MB`,
      heapUtilization: `${((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(1)}%`
    },
    timestamp: new Date().toISOString()
  });
});

// Health endpoint for monitoring
app.get('/health', (req, res) => {
  const memUsage = process.memoryUsage();
  const isHealthy = actualInitialized && !initializationError;
  
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    initialized: actualInitialized,
    uptime: process.uptime(),
    memory: {
      heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
      heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
      heapUtilization: `${((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(1)}%`
    },
    version: require('./package.json').version,
    timestamp: new Date().toISOString()
  });
});

// Memory cleanup endpoint (for manual cleanup if needed)
app.post('/cleanup', (req, res) => {
  const beforeGC = process.memoryUsage();

  if (global.gc) {
    global.gc();
    const afterGC = process.memoryUsage();

    res.json({
      status: 'success',
      message: 'Garbage collection triggered',
      before: {
        heapUsed: `${(beforeGC.heapUsed / 1024 / 1024).toFixed(2)}MB`,
        heapTotal: `${(beforeGC.heapTotal / 1024 / 1024).toFixed(2)}MB`
      },
      after: {
        heapUsed: `${(afterGC.heapUsed / 1024 / 1024).toFixed(2)}MB`,
        heapTotal: `${(afterGC.heapTotal / 1024 / 1024).toFixed(2)}MB`
      },
      freed: `${((beforeGC.heapUsed - afterGC.heapUsed) / 1024 / 1024).toFixed(2)}MB`
    });
  } else {
    res.json({
      status: 'error',
      message: 'Garbage collection not available'
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Start background initialization after server is running
  console.log('🔄 Starting background initialization...');
  performBackgroundInit();
});

console.log('Current working directory:', process.cwd());