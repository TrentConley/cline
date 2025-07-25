import vscode from "vscode"
import crypto from "crypto"
import { EmptyRequest, String } from "../../shared/proto/common"
import { AuthState } from "../../shared/proto/account"
import { StreamingResponseHandler, getRequestRegistry } from "@/core/controller/grpc-handler"
import { OidcAuthProvider, OidcTokenResponse } from "./providers/OidcAuthProvider"
import { Controller } from "@/core/controller"
import { storeSecret, updateGlobalState } from "@/core/storage/state"

const DefaultClineAccountURI = "https://server-production-f0ec.up.railway.app"
// const DefaultClineAccountURI = "https://staging-app.cline.bot/auth"
// const DefaultClineAccountURI = "http://localhost:3000/auth"
let authProviders: any[] = []

type ServiceConfig = {
	URI?: string
	[key: string]: any
}

const availableAuthProviders = {
	oidc: OidcAuthProvider,
	// Add other providers here as needed
}

// TODO: Add logic to handle multiple webviews getting auth updates.

export class AuthService {
	private static instance: AuthService | null = null
	private _config: ServiceConfig
	private _authenticated: boolean = false
	private _user: any = null
	private _provider: any = null
	private readonly _authNonce = crypto.randomBytes(32).toString("hex")
	private _activeAuthStatusUpdateSubscriptions = new Set<[Controller, StreamingResponseHandler]>()
	private _context: vscode.ExtensionContext

	/**
	 * Creates an instance of AuthService.
	 * @param config - Configuration for the service, including the URI for authentication.
	 * @param authProvider - Optional authentication provider to use.
	 * @param controller - Optional reference to the Controller instance.
	 */
	private constructor(context: vscode.ExtensionContext, config: ServiceConfig, authProvider?: any) {
		const providerName = authProvider || "oidc"
		this._config = Object.assign({ URI: DefaultClineAccountURI }, config)

		// Fetch AuthProviders
		// TODO:  Deliver this config from the backend securely
		// ex.  https://app.cline.bot/api/v1/auth/providers

		const authProvidersConfigs = [
			// Only OIDC Provider Configuration - Users must authenticate via OIDC
			{
				name: "oidc",
				config: {
					// IMPORTANT: This MUST match your actual OIDC provider's issuer URL
					// If you're using a different provider than Google, update this URL
					// Examples:
					// - Azure AD: "https://login.microsoftonline.com/{tenant-id}/v2.0"
					// - Okta: "https://your-org.okta.com/oauth2/default"
					// - Auth0: "https://your-tenant.auth0.com"
					// - Custom provider: "https://your-provider.com"
					issuer: "https://server-production-f0ec.up.railway.app", // Railway server proxies SpaceX auth
					clientId: "YOUR_CLINET_ID", // OAuth client ID
					clientSecret: "YOUR_CLIENT_SECRET", // OAuth client secret
					redirectUri: "https://server-production-f0ec.up.railway.app/oauth/oidc/callback", // HTTPS callback URL
					scopes: ["openid", "email", "profile", "offline_access"], // Added offline_access for refresh tokens
				},
			},
		]

		// Merge authProviders with availableAuthProviders
		authProviders = authProvidersConfigs.map((provider) => {
			const providerName = provider.name
			const ProviderClass = availableAuthProviders[providerName as keyof typeof availableAuthProviders]
			if (!ProviderClass) {
				throw new Error(`Auth provider "${providerName}" is not available`)
			}
			return {
				name: providerName,
				config: provider.config,
				provider: new ProviderClass(provider.config as any), // Type assertion for flexibility
			}
		})

		this._setProvider(authProviders.find((authProvider) => authProvider.name === providerName).name)

		this._context = context
	}

	/**
	 * Gets the singleton instance of AuthService.
	 * @param config - Configuration for the service, including the URI for authentication.
	 * @param authProvider - Optional authentication provider to use.
	 * @param controller - Optional reference to the Controller instance.
	 * @returns The singleton instance of AuthService.
	 */
	public static getInstance(context?: vscode.ExtensionContext, config?: ServiceConfig, authProvider?: any): AuthService {
		if (!AuthService.instance) {
			if (!context) {
				console.warn("Extension context was not provided to AuthService.getInstance, using default context")
				context = {} as vscode.ExtensionContext
			}
			AuthService.instance = new AuthService(context, config || {}, authProvider)
		}
		if (context !== undefined) {
			AuthService.instance.context = context
		}
		return AuthService.instance
	}

	set context(context: vscode.ExtensionContext) {
		this._context = context
	}

	get authProvider(): any {
		return this._provider
	}

	set authProvider(providerName: string) {
		this._setProvider(providerName)
	}

	get authNonce(): string {
		return this._authNonce
	}

	async getAuthToken(): Promise<string | null> {
		if (!this._user) {
			return null
		}

		// TODO: This may need to be dependant on the auth provider
		// Return the ID token from the user object
		return this._provider.provider.getAuthToken(this._user)
	}

	/**
	 * Check if the user is currently authenticated
	 * @returns true if authenticated, false otherwise
	 */
	isAuthenticated(): boolean {
		return this._authenticated && this._user !== null
	}

	/**
	 * Get the current user information if authenticated
	 * @returns user object if authenticated, null otherwise
	 */
	getCurrentUser(): any {
		return this.isAuthenticated() ? this._user : null
	}

	private _setProvider(providerName: string): void {
		const providerConfig = authProviders.find((provider) => provider.name === providerName)
		if (!providerConfig) {
			throw new Error(`Auth provider "${providerName}" not found`)
		}

		this._provider = providerConfig
	}

	getInfo(): AuthState {
		let user = null
		if (this._user && this._authenticated) {
			user = this._provider.provider.convertUserData(this._user)
		}

		return AuthState.create({
			user: user,
		})
	}

	async createAuthRequest(): Promise<String> {
		console.log("AuthService: createAuthRequest called")
		console.log("AuthService: Current auth state:", {
			authenticated: this._authenticated,
			hasUser: !!this._user,
			hasProvider: !!this._provider,
			authNonce: this._authNonce,
		})

		if (this._authenticated) {
			console.log("AuthService: User already authenticated, forcing UI update")

			// Get the proper user info
			const userInfo = this._provider.provider.convertUserData
				? this._provider.provider.convertUserData(this._user)
				: this._user

			// Ensure userInfo is properly set in global state
			if (this._user && this._context) {
				console.log("AuthService: Updating userInfo in global state:", userInfo)
				await updateGlobalState(this._context, "userInfo", userInfo)
			}

			// Force webview update after userInfo is set
			const { WebviewProvider } = await import("@/core/webview")
			const visibleWebview = WebviewProvider.getVisibleInstance()
			if (visibleWebview && visibleWebview.controller) {
				console.log("AuthService: Forcing webview state update")
				await visibleWebview.controller.postStateToWebview()
			}

			// Send auth status update (for any auth-specific subscribers)
			await this.sendAuthStatusUpdate()

			return String.create({ value: "Already authenticated" })
		}

		if (!this._provider) {
			console.error("AuthService: Auth provider is not set")
			throw new Error("Auth provider is not set")
		}

		// --- START DEBUGGING MODIFICATION ---
		// Redirect to Railway server which will handle the OAuth flow with Google
		console.log("AuthService: Redirecting to Railway server for OAuth flow")
		console.log("AuthService: Using state nonce:", this._authNonce)

		// Build the URL to your Railway server's /login endpoint
		const serverLoginUrl = `${this._config.URI}/login?state=${encodeURIComponent(this._authNonce)}`

		console.log("AuthService: Opening OAuth URL:", serverLoginUrl)
		await vscode.env.openExternal(vscode.Uri.parse(serverLoginUrl))

		return String.create({ value: serverLoginUrl })
		// --- END DEBUGGING MODIFICATION ---

		/*
		try {
			console.log("AuthService: Generating authorization URL with nonce:", this._authNonce)
			// Generate the authorization URL using the OIDC provider
			const authUrl = await this._provider.provider.getAuthorizationUrl(this._authNonce)

			console.log("AuthService: Generated auth URL:", authUrl)

			// Open the authorization URL in the user's default browser
			console.log("AuthService: Opening external URL in browser")
			await vscode.env.openExternal(vscode.Uri.parse(authUrl))

			console.log("AuthService: Successfully opened auth URL")
			return String.create({ value: authUrl })
		} catch (error) {
			console.error("AuthService: Error creating auth request:", error)
			console.error("AuthService: Error details:", {
				message: error.message,
				stack: error.stack,
				name: error.name,
			})
			throw new Error(`Failed to create auth request: ${error.message}`)
		}
		*/
	}

	async handleDeauth(): Promise<void> {
		console.log("AuthService: handleDeauth called")
		// Use forceLogout for thorough cleanup
		await this.forceLogout()
	}

	async handleAuthCallback(token: string, provider: string): Promise<void> {
		if (!this._provider) {
			throw new Error("Auth provider is not set")
		}

		try {
			this._user = await this._provider.provider.signIn(this._context, token, provider)
			this._authenticated = true

			await this.sendAuthStatusUpdate()
			await this.setupAutoRefreshAuth()
			return this._user
		} catch (error) {
			console.error("Error signing in with custom token:", error)
			throw error
		}
	}

	async handleAuthCallbackWithTokens(tokens: OidcTokenResponse): Promise<void> {
		console.log("AuthService: handleAuthCallbackWithTokens called with tokens:", {
			access_token: tokens.access_token ? "present" : "missing",
			id_token: tokens.id_token ? "present" : "missing",
			refresh_token: tokens.refresh_token ? "present" : "missing",
			token_type: tokens.token_type,
			expires_in: tokens.expires_in,
			scope: tokens.scope,
		})

		// Additional debugging for refresh token issue
		if (!tokens.refresh_token) {
			console.warn("AuthService: MISSING REFRESH TOKEN - This could be caused by:")
			console.warn("1. OIDC provider not configured to return refresh tokens")
			console.warn("2. Missing 'offline_access' scope in OAuth request")
			console.warn("3. Provider requires additional parameters (e.g., access_type=offline)")
			console.warn("4. Client not configured as 'confidential' in OAuth provider")
			console.warn("Current scopes requested:", this._provider?.config?.scopes)
		}

		// Debug token validation
		if (tokens.access_token) {
			try {
				// Try to decode the access token to see what's inside (without verification)
				const [header, payload] = tokens.access_token.split(".")
				if (header && payload) {
					const decodedPayload = JSON.parse(atob(payload))
					console.log("AuthService: Access token payload (decoded):", {
						iss: decodedPayload.iss,
						aud: decodedPayload.aud,
						exp: decodedPayload.exp,
						scope: decodedPayload.scope || decodedPayload.scp,
					})
				}
			} catch (e) {
				console.log("AuthService: Access token is not a JWT or couldn't be decoded")
			}
		}

		if (!this._provider) {
			console.error("AuthService: Auth provider is not set")
			throw new Error("Auth provider is not set")
		}

		try {
			console.log("AuthService: Attempting to sign in with tokens...")
			this._user = await this._provider.provider.signInWithTokens(this._context, tokens)
			this._authenticated = true

			console.log("AuthService: Successfully signed in user:", {
				userId: this._user?.uid || "unknown",
				email: this._user?.email || "unknown",
				name: this._user?.displayName || this._user?.name || "unknown",
			})

			// Ensure userInfo is set in global state
			const userInfo = this._provider.provider.convertUserData
				? this._provider.provider.convertUserData(this._user)
				: this._user
			console.log("AuthService: Setting userInfo in global state after OAuth callback:", userInfo)
			await updateGlobalState(this._context, "userInfo", userInfo)

			console.log("AuthService: Sending auth status update...")
			await this.sendAuthStatusUpdate()

			console.log("AuthService: Setting up auto-refresh...")
			await this.setupAutoRefreshAuth()

			console.log("AuthService: OAuth callback handling completed successfully")
			return this._user
		} catch (error) {
			console.error("AuthService: Error signing in with tokens:", error)
			console.error("AuthService: Error details:", {
				message: error.message,
				stack: error.stack,
				name: error.name,
			})
			throw error
		}
	}

	/**
	 * Clear the authentication token from the extension's storage.
	 * This is typically called when the user logs out.
	 */
	async clearAuthToken(): Promise<void> {
		console.log("AuthService: Clearing authentication token and state")
		try {
			await storeSecret(this._context, "clineAccountId", undefined)
			// Also clear the provider's tokens if available
			if (this._provider && this._provider.provider && this._provider.provider.signOut) {
				await this._provider.provider.signOut()
			}
			console.log("AuthService: Successfully cleared authentication data")
		} catch (error) {
			console.error("AuthService: Error clearing auth token:", error)
			// Continue anyway - we want to clear the local state
		}

		// Always reset local state regardless of errors
		this._authenticated = false
		this._user = null
	}

	/**
	 * Restores the authentication token from the extension's storage.
	 * This is typically called when the extension is activated.
	 */
	async restoreAuthToken(): Promise<void> {
		if (!this._provider || !this._provider.provider) {
			console.warn("Auth provider is not set, skipping token restoration")
			this._authenticated = false
			this._user = null
			return
		}

		try {
			this._user = await this._provider.provider.restoreAuthCredential(this._context)
			if (this._user) {
				console.log("AuthService: Successfully restored auth token for user:", {
					email: this._user?.email || "unknown",
					name: this._user?.displayName || this._user?.name || "unknown",
				})
				this._authenticated = true

				// Ensure userInfo is set in global state when auth is restored
				const userInfo = this._provider.provider.convertUserData
					? this._provider.provider.convertUserData(this._user)
					: this._user
				console.log("AuthService: Setting userInfo in global state after restore:", userInfo)
				await updateGlobalState(this._context, "userInfo", userInfo)

				await this.sendAuthStatusUpdate()
				await this.setupAutoRefreshAuth()
			} else {
				console.warn("No user found after restoring auth token")
				this._authenticated = false
				this._user = null
				// Clear any invalid stored credentials
				await this.clearAuthToken()
			}
		} catch (error) {
			console.error("Error restoring auth token:", error)
			this._authenticated = false
			this._user = null
			// Clear any corrupted stored credentials
			await this.clearAuthToken()
			// Don't rethrow - just continue with unauthenticated state
		}
	}

	/**
	 * Refreshes the authentication status and sends an update to all subscribers.
	 */
	async refreshAuth(): Promise<void> {
		if (!this._user) {
			console.warn("No user is authenticated, skipping auth refresh")
			return
		}

		await this._provider.provider.refreshAuthToken()
		this.sendAuthStatusUpdate()
	}

	private async setupAutoRefreshAuth(): Promise<void> {
		try {
			// For OIDC provider, we need to check if we have token expiration info
			if (this._provider && this._provider.provider && this._provider.provider.getTokenExpirationTime) {
				const expirationTime = await this._provider.provider.getTokenExpirationTime(this._context)
				if (expirationTime) {
					// Calculate timeout to refresh 5 minutes before expiration
					const now = Date.now()
					const timeUntilExpiration = expirationTime - now
					const refreshTimeout = Math.max(timeUntilExpiration - 5 * 60 * 1000, 0) // 5 minutes before expiration

					if (refreshTimeout > 0) {
						setTimeout(() => this._autoRefreshAuth(), refreshTimeout)
						console.log(`Auth token will be refreshed in ${Math.round(refreshTimeout / 1000 / 60)} minutes`)
						return
					} else {
						// Token is already expired or about to expire, refresh immediately
						console.log("Token is expired or about to expire, refreshing immediately")
						await this._autoRefreshAuth()
						return
					}
				}
			}

			// Fallback for providers that don't have standard token expiration
			console.warn("Unable to determine token expiration time, using default refresh interval")
			const defaultRefreshInterval = 50 * 60 * 1000 // 50 minutes in milliseconds
			setTimeout(() => this._autoRefreshAuth(), defaultRefreshInterval)
		} catch (error) {
			console.error("Error setting up auto-refresh:", error)
		}
	}

	private async _autoRefreshAuth(): Promise<void> {
		if (!this._user) {
			console.warn("No user is authenticated, skipping auth refresh")
			return
		}
		await this.refreshAuth()
		await this.setupAutoRefreshAuth() // Reschedule the next auto-refresh
	}

	/**
	 * Force logout - clears all authentication state and credentials.
	 * Useful for debugging or when authentication state is corrupted.
	 */
	async forceLogout(): Promise<void> {
		console.log("AuthService: Force logout initiated")

		// Clear authentication state FIRST
		this._authenticated = false
		this._user = null

		// Clear stored credentials
		await this.clearAuthToken()

		// Clear userInfo from global state
		if (this._context) {
			await updateGlobalState(this._context, "userInfo", undefined)
			// Also clear the API provider to ensure UI shows sign-in
			await updateGlobalState(this._context, "apiProvider", undefined)
		}

		// Send auth status update to notify UI
		await this.sendAuthStatusUpdate()

		// Clear any active subscriptions
		this._activeAuthStatusUpdateSubscriptions.clear()

		// Force webview update to ensure UI reflects logout
		try {
			const { WebviewProvider } = await import("@/core/webview")
			const visibleWebview = WebviewProvider.getVisibleInstance()
			if (visibleWebview && visibleWebview.controller) {
				console.log("AuthService: Forcing webview state update after logout")
				await visibleWebview.controller.postStateToWebview()
			}
		} catch (error) {
			console.error("AuthService: Error updating webview after logout:", error)
		}

		console.log("AuthService: Force logout completed")
	}

	/**
	 * Subscribe to authStatusUpdate events
	 * @param controller The controller instance
	 * @param request The empty request
	 * @param responseStream The streaming response handler
	 * @param requestId The ID of the request (passed by the gRPC handler)
	 */
	async subscribeToAuthStatusUpdate(
		controller: Controller,
		request: EmptyRequest,
		responseStream: StreamingResponseHandler,
		requestId?: string,
	): Promise<void> {
		console.log("Subscribing to authStatusUpdate")

		// Add this subscription to the active subscriptions
		this._activeAuthStatusUpdateSubscriptions.add([controller, responseStream])
		// Register cleanup when the connection is closed
		const cleanup = () => {
			this._activeAuthStatusUpdateSubscriptions.delete([controller, responseStream])
		}
		// Register the cleanup function with the request registry if we have a requestId
		if (requestId) {
			getRequestRegistry().registerRequest(requestId, cleanup, { type: "authStatusUpdate_subscription" }, responseStream)
		}

		// Send the current authentication status immediately
		try {
			await this.sendAuthStatusUpdate()
		} catch (error) {
			console.error("Error sending initial auth status:", error)
			// Remove the subscription if there was an error
			this._activeAuthStatusUpdateSubscriptions.delete([controller, responseStream])
		}
	}

	/**
	 * Send an authStatusUpdate event to all active subscribers
	 */
	async sendAuthStatusUpdate(): Promise<void> {
		console.log("AuthService: sendAuthStatusUpdate called")
		console.log("AuthService: Current auth state:", {
			authenticated: this._authenticated,
			hasUser: !!this._user,
			subscriberCount: this._activeAuthStatusUpdateSubscriptions.size,
		})

		// Send the event to all active subscribers
		const promises = Array.from(this._activeAuthStatusUpdateSubscriptions).map(async ([controller, responseStream]) => {
			try {
				const authInfo: AuthState = this.getInfo()
				console.log("AuthService: Sending auth info to subscriber:", {
					hasUser: !!authInfo.user,
					userId: authInfo.user?.uid || "unknown",
					email: authInfo.user?.email || "unknown",
				})

				await responseStream(
					authInfo,
					false, // Not the last message
				)

				// Update the state in the webview
				if (controller) {
					console.log("AuthService: Posting state to webview")
					await controller.postStateToWebview()
				}
			} catch (error) {
				console.error("AuthService: Error sending authStatusUpdate event:", error)
				console.error("AuthService: Error details:", {
					message: error.message,
					stack: error.stack,
					name: error.name,
				})
				// Remove the subscription if there was an error
				this._activeAuthStatusUpdateSubscriptions.delete([controller, responseStream])
			}
		})

		await Promise.all(promises)
		console.log("AuthService: Completed sending auth status updates to all subscribers")
	}
}
