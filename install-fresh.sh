#!/bin/bash
# -----------------------------------------------------------------------------
# Install Fresh - Script for setting up the project on a new machine.
#
# This script does the following:
# 1. Cleans the entire repository of any untracked or build files.
# 2. Installs dependencies precisely using 'npm ci' for reproducibility.
# 3. Generates all required Protocol Buffer files.
# -----------------------------------------------------------------------------

# Exit immediately if a command exits with a non-zero status.
set -e

# --- 1. Clean the project directory ---
echo "🧹 Cleaning project directory..."
npm run clean

# --- 2. Install all dependencies ---
echo "📦 Installing root dependencies from lockfile..."
npm ci

echo "📦 Installing webview UI dependencies from lockfile..."
(cd webview-ui && npm ci)

# --- 3. Generate Protocol Buffer files ---
echo "🔧 Generating required Protocol Buffer files..."
npm run protos

echo ""
echo "✅ Fresh installation complete! You are now ready to build the extension." 