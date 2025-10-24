#!/bin/bash

# Actual Budget API Startup Script
# This ensures the API server starts reliably after any restart

set -e

echo "Starting Actual Budget API setup..."

# Change to the persistent directory
cd /config/actual-budget-api

# Check if Node.js is installed, install if not
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    apk add --no-cache nodejs npm
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
fi

# Set memory limit for Pi
export NODE_OPTIONS="--max-old-space-size=3072"

# Start the server
echo "Starting Actual Budget API server..."
node index.js