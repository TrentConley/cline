# Build Fix Guide - Resolving Module Not Found Errors

## 🔴 The Problem

When building on a different machine, you're getting these errors:
1. `Cannot find module '@shared/proto/common'`
2. Errors with `services/grpc-client`
3. `Parameter 'error' has 'any' type`

## 🟢 The Solution

### Step 1: Generate Protocol Buffer Files (REQUIRED)

The proto files are missing because they're generated files that aren't committed to git. Run this command first:

```bash
npm run protos
```

This will generate:
- All the `src/shared/proto/*.ts` files
- gRPC client files
- Other required generated code

### Step 2: Install All Dependencies

Make sure all dependencies are installed for both the main project and webview:

```bash
npm run install:all
```

### Step 3: Fix TypeScript 'any' Type Errors

If you're getting strict type errors for `catch (error)`, you have two options:

#### Option A: Quick Fix (Temporary)
Add this to `tsconfig.json` under `compilerOptions`:
```json
{
  "compilerOptions": {
    "useUnknownInCatchVariables": false,
    "strict": false  // or just disable this temporarily
  }
}
```

#### Option B: Proper Fix (Recommended)
Update your AuthService.ts catch blocks to explicitly type the error:

```typescript
// Change from:
} catch (error) {
  console.error("Error:", error)
}

// To:
} catch (error: any) {
  console.error("Error:", error)
}

// Or better:
} catch (error) {
  console.error("Error:", error instanceof Error ? error.message : String(error))
}
```

### Step 4: Full Build Process

Run these commands in order:

```bash
# 1. Clean any old build artifacts
npm run clean

# 2. Generate proto files
npm run protos

# 3. Install all dependencies
npm run install:all

# 4. Build the webview
npm run build:webview

# 5. Build and package the extension
npm run package

# 6. Create the VSIX file
npx vsce package
```

## 📋 Complete Build Script

Save this as `build-fresh.sh` and run it:

```bash
#!/bin/bash
echo "🧹 Cleaning old build artifacts..."
npm run clean

echo "🔧 Generating protocol buffer files..."
npm run protos

echo "📦 Installing all dependencies..."
npm run install:all

echo "🎨 Building webview UI..."
npm run build:webview

echo "🏗️ Building extension..."
npm run package

echo "📦 Creating VSIX package..."
npx vsce package

echo "✅ Build complete!"
```

Make it executable: `chmod +x build-fresh.sh`
Then run: `./build-fresh.sh`

## 🔍 Troubleshooting

### If proto generation fails:
```bash
# Check if buf is installed
npm ls @bufbuild/buf

# Reinstall if needed
npm install --save-dev @bufbuild/buf
```

### If TypeScript paths still don't resolve:
1. Make sure `baseUrl` is set in tsconfig.json:
   ```json
   {
     "compilerOptions": {
       "baseUrl": ".",
       "paths": {
         "@shared/*": ["src/shared/*"]
       }
     }
   }
   ```

2. Delete and regenerate:
   ```bash
   rm -rf src/generated src/shared/proto
   npm run protos
   ```

### If webview build fails:
```bash
cd webview-ui
npm install
npm run build
cd ..
```

## 🎯 Quick Checklist

Before building on a new machine, ensure:
- [ ] Node.js version 18+ is installed
- [ ] Run `npm run protos` to generate proto files
- [ ] Run `npm run install:all` to install all dependencies
- [ ] TypeScript strict mode is configured appropriately
- [ ] All generated files exist in `src/shared/proto/` and `src/generated/`

## 💡 Pro Tip

Add this to your `.gitignore` if not already there:
```
src/generated/
src/shared/proto/*.ts
```

But also add a `.gitkeep` file in empty directories so the structure is preserved.

## 🚀 One-Liner for Fresh Build

```bash
npm run clean && npm run protos && npm run install:all && npm run build:webview && npm run package && npx vsce package
```

This should resolve all the module not found errors! 