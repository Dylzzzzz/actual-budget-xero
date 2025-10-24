#!/bin/bash
set -e

echo "Starting Actual-Xero Sync application..."

# Change to app directory
cd /app

# Start the Node.js application
exec node index.js
