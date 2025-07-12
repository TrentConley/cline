# OIDC OAuth Setup Guide for Cline

This guide explains how to configure OpenID Connect (OIDC) OAuth authentication for your company's Cline deployment.

## Overview

Cline now supports OIDC OAuth authentication, allowing you to integrate with your company's identity provider. This implementation follows the OAuth 2.0 Authorization Code flow with PKCE (Proof Key for Code Exchange) for enhanced security.

## Supported OIDC Providers

- Microsoft Azure AD / Entra ID
- Google Workspace
- Okta
- Auth0
- Keycloak
- Any OIDC-compliant identity provider

## Configuration Steps

### 1. Configure Your OIDC Provider

First, register Cline as an application in your OIDC provider:

#### Redirect URIs
Add these redirect URIs to your OIDC application:
```
vscode://saoudrizwan.claude-dev/auth
vscode://saoudrizwan.claude-dev/oidc
```

#### Required Scopes
Ensure your application has access to these scopes:
- `openid` (required)
- `profile` (recommended)
- `email` (recommended)

### 2. Update AuthService Configuration

Edit `src/services/auth/AuthService.ts` and uncomment/configure the OIDC provider section:

```typescript
{
    name: "oidc",
    config: {
        issuer: "https://your-oidc-provider.com",
        clientId: "your-client-id",
        clientSecret: "your-client-secret", // Optional for public clients
        redirectUri: `${vscode.env.uriScheme || "vscode"}://saoudrizwan.claude-dev/auth`,
        scopes: ["openid", "profile", "email"],
        additionalParams: {
            // Add any additional OAuth parameters your provider requires
            // prompt: "select_account",
            // domain_hint: "your-domain.com"
        }
    }
},
```

### 3. Provider-Specific Examples

#### Microsoft Azure AD / Entra ID
```typescript
{
    name: "oidc",
    config: {
        issuer: "https://login.microsoftonline.com/{tenant-id}/v2.0",
        clientId: "your-azure-app-client-id",
        redirectUri: `${vscode.env.uriScheme || "vscode"}://saoudrizwan.claude-dev/auth`,
        scopes: ["openid", "profile", "email"],
        additionalParams: {
            prompt: "select_account"
        }
    }
}
```

#### Google Workspace
```typescript
{
    name: "oidc",
    config: {
        issuer: "https://accounts.google.com",
        clientId: "your-google-client-id.apps.googleusercontent.com",
        redirectUri: `${vscode.env.uriScheme || "vscode"}://saoudrizwan.claude-dev/auth`,
        scopes: ["openid", "profile", "email"],
        additionalParams: {
            hd: "your-domain.com" // Restrict to your domain
        }
    }
}
```

#### Okta
```typescript
{
    name: "oidc",
    config: {
        issuer: "https://your-org.okta.com/oauth2/default",
        clientId: "your-okta-client-id",
        redirectUri: `${vscode.env.uriScheme || "vscode"}://saoudrizwan.claude-dev/auth`,
        scopes: ["openid", "profile", "email"]
    }
}
```

#### Auth0
```typescript
{
    name: "oidc",
    config: {
        issuer: "https://your-tenant.auth0.com",
        clientId: "your-auth0-client-id",
        redirectUri: `${vscode.env.uriScheme || "vscode"}://saoudrizwan.claude-dev/auth`,
        scopes: ["openid", "profile", "email"],
        additionalParams: {
            audience: "your-api-identifier" // If using Auth0 APIs
        }
    }
}
```

#### Keycloak
```typescript
{
    name: "oidc",
    config: {
        issuer: "https://your-keycloak.com/auth/realms/your-realm",
        clientId: "your-keycloak-client-id",
        clientSecret: "your-keycloak-client-secret", // If confidential client
        redirectUri: `${vscode.env.uriScheme || "vscode"}://saoudrizwan.claude-dev/auth`,
        scopes: ["openid", "profile", "email"]
    }
}
```

### 4. Set Default Provider

To make OIDC the default authentication provider, update the AuthService constructor:

```typescript
private constructor(context: vscode.ExtensionContext, config: ServiceConfig, authProvider?: any) {
    const providerName = authProvider || "oidc" // Change from "firebase" to "oidc"
    // ... rest of constructor
}
```

### 5. Environment Variables (Optional)

For dynamic configuration, you can use environment variables:

```typescript
{
    name: "oidc",
    config: {
        issuer: process.env.OIDC_ISSUER || "https://your-default-issuer.com",
        clientId: process.env.OIDC_CLIENT_ID || "your-default-client-id",
        clientSecret: process.env.OIDC_CLIENT_SECRET, // Optional
        redirectUri: `${vscode.env.uriScheme || "vscode"}://saoudrizwan.claude-dev/auth`,
        scopes: ["openid", "profile", "email"]
    }
}
```

## Security Considerations

### 1. Client Types
- **Public Client**: No client secret required (recommended for VSCode extensions)
- **Confidential Client**: Requires client secret (use only if your deployment can secure it)

### 2. PKCE Support
The implementation automatically uses PKCE (Proof Key for Code Exchange) for enhanced security, which is recommended for public clients.

### 3. State Parameter
The implementation includes state parameter validation to prevent CSRF attacks.

### 4. Token Storage
- Access tokens and refresh tokens are stored securely in VSCode's secrets storage
- Tokens are automatically refreshed when they expire
- All tokens are cleared when the user logs out

## Testing Your Configuration

1. Build the extension with your OIDC configuration
2. Install the extension in VSCode
3. Click the account/login button in Cline
4. You should be redirected to your OIDC provider's login page
5. After successful authentication, you should be redirected back to VSCode
6. Verify that user information is displayed correctly in Cline

## Troubleshooting

### Common Issues

1. **Invalid Redirect URI**
   - Ensure the redirect URI in your OIDC provider matches exactly: `vscode://saoudrizwan.claude-dev/auth`

2. **CORS Issues**
   - OIDC discovery and token endpoints must support CORS for the VSCode extension

3. **Token Refresh Failures**
   - Ensure your OIDC provider supports refresh tokens
   - Check that the `offline_access` scope is included if required by your provider

4. **State Mismatch Errors**
   - This can happen if the authentication flow is interrupted
   - Users can choose to continue anyway or restart the authentication process

### Debug Logging

Enable debug logging by checking the VSCode Developer Console:
1. Open VSCode
2. Go to Help > Toggle Developer Tools
3. Check the Console tab for OIDC-related log messages

## Advanced Configuration

### Custom User Mapping

If your OIDC provider returns user information in a different format, you can customize the user mapping in the `OidcAuthProvider.convertUserData()` method:

```typescript
convertUserData(userInfo: OidcUserInfo) {
    return {
        uid: userInfo.sub,
        email: userInfo.email || userInfo.preferred_username,
        displayName: userInfo.name || `${userInfo.given_name} ${userInfo.family_name}`,
        photoUrl: userInfo.picture || userInfo.avatar_url,
    }
}
```

### Custom Logout

If your OIDC provider supports logout endpoints, you can implement custom logout in the `OidcAuthProvider.signOut()` method:

```typescript
async signOut(): Promise<void> {
    try {
        // Clear local state
        this._currentUser = null
        this._tokens = null

        // Call OIDC logout endpoint if available
        if (this._discoveryDocument?.end_session_endpoint && this._tokens?.id_token) {
            const logoutUrl = new URL(this._discoveryDocument.end_session_endpoint)
            logoutUrl.searchParams.set("id_token_hint", this._tokens.id_token)
            logoutUrl.searchParams.set("post_logout_redirect_uri", "vscode://saoudrizwan.claude-dev/logout")
            
            await vscode.env.openExternal(vscode.Uri.parse(logoutUrl.toString()))
        }

        console.log("User signed out successfully from OIDC provider")
    } catch (error) {
        ErrorService.logMessage("OIDC sign-out error", "error")
        ErrorService.logException(error)
        throw error
    }
}
```

## Building and Deployment

After configuring OIDC authentication:

1. Build the extension:
   ```bash
   npm run build
   ```

2. Package the extension:
   ```bash
   npm run package
   ```

3. Install the generated `.vsix` file in your organization's VSCode instances

## Support

For issues specific to OIDC authentication:
1. Check the VSCode Developer Console for error messages
2. Verify your OIDC provider configuration
3. Ensure all required scopes and permissions are granted
4. Test the OIDC endpoints manually using tools like Postman

For general Cline support, refer to the main documentation.
