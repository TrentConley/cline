#!/bin/bash
# -----------------------------------------------------------------------------
# Build Extension - Script for building and packaging the VSCode extension.
#
# This script does the following:
# 1. Builds the webview UI.
# 2. Compiles the extension TypeScript code.
# 3. Packages everything into a single .vsix file for installation.
#
# It assumes all dependencies are already installed.
# Run './install-fresh.sh' first if you are on a new machine.
# -----------------------------------------------------------------------------

# Exit immediately if a command exits with a non-zero status.
set -e

# --- 1. Build and Package the Extension Code ---
# The `package` script in package.json handles building the webview and the extension.
echo "🏗️ Building the extension (includes webview)..."
npm run package

# --- 2. Create the VSIX file ---
echo "📦 Creating the final .vsix package..."
npx vsce package

echo ""
echo "✅ Build complete! The .vsix file has been created in the root directory." 