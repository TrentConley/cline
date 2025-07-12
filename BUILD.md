# Building Cline Extension with OIDC OAuth

This document provides the correct steps to build and package the Cline extension with your custom OIDC OAuth configuration.

## Prerequisites

Make sure you have the following installed:
- Node.js (version 18 or higher)
- npm
- Visual Studio Code Extension Manager (`vsce`)

Install vsce if you don't have it:
```bash
npm install -g vsce
```

## Build Steps

### 1. Configure OIDC Authentication

Edit `src/services/auth/AuthService.ts` and configure your OIDC provider in the `authProvidersConfigs` array. See `docs/oidc-oauth-setup.md` for detailed configuration examples.

### 2. Build the Extension

Run the following commands in order:

```bash
# Install dependencies
npm install

# Build the webview
npm run build:webview

# Build the extension
npm run package

# Package as VSIX
npx vsce package
```

### 3. Install the Extension

After successful packaging, you'll have a `.vsix` file (e.g., `claude-dev-3.18.12.vsix`).

Install it in VSCode:
```bash
code --install-extension claude-dev-*.vsix
```

## Quick Build Script

For convenience, you can run all build steps at once:

```bash
npm install && npm run build:webview && npm run package && npx vsce package
```

## Troubleshooting

### Common Build Issues

1. **TypeScript errors**: Run `npm run check-types` to see detailed type errors
2. **Linting errors**: Run `npm run lint` to see and fix linting issues
3. **Missing dependencies**: Run `npm install` to ensure all dependencies are installed
4. **Webview build fails**: Check `webview-ui/` directory and run `cd webview-ui && npm install`

### Build Output

- Extension files are built to `dist/`
- Webview files are built to `webview-ui/build/`
- The final `.vsix` package is created in the root directory

## Development Mode

For development with hot reload:

```bash
# Terminal 1: Watch extension changes
npm run watch:esbuild

# Terminal 2: Watch webview changes
npm run dev:webview
```

Then press `F5` in VSCode to launch the extension in a new Extension Development Host window.

## Distribution

Once you have the `.vsix` file, you can:

1. **Install locally**: `code --install-extension your-extension.vsix`
2. **Distribute to team**: Share the `.vsix` file for manual installation
3. **Enterprise deployment**: Use your organization's extension deployment tools

## Notes

- The extension will use your configured OIDC provider for authentication
- Users will be redirected to your identity provider's login page
- Tokens are stored securely in VSCode's secrets storage
- The extension maintains full Cline functionality with your custom authentication

For detailed OIDC configuration, see `docs/oidc-oauth-setup.md`.
