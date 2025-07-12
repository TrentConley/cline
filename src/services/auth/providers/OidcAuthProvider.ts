import { getSecret, storeSecret } from "@/core/storage/state"
import { ErrorService } from "@/services/error/ErrorService"
import { ExtensionContext } from "vscode"
import axios from "axios"
import * as crypto from "crypto"

export interface OidcConfig {
	issuer: string
	clientId: string
	clientSecret?: string
	redirectUri: string
	scopes?: string[]
	additionalParams?: Record<string, string>
}

export interface OidcTokenResponse {
	access_token: string
	id_token: string
	refresh_token?: string
	token_type: string
	expires_in: number
	scope?: string
}

export interface OidcUserInfo {
	sub: string
	name?: string
	email?: string
	picture?: string
	preferred_username?: string
	given_name?: string
	family_name?: string
	[key: string]: any
}

export interface OidcDiscoveryDocument {
	authorization_endpoint: string
	token_endpoint: string
	userinfo_endpoint: string
	jwks_uri: string
	issuer: string
	scopes_supported: string[]
	response_types_supported: string[]
	grant_types_supported: string[]
	end_session_endpoint?: string
}

export class OidcAuthProvider {
	private _config: OidcConfig
	private _discoveryDocument: OidcDiscoveryDocument | null = null
	private _currentUser: OidcUserInfo | null = null
	private _tokens: OidcTokenResponse | null = null

	constructor(config: OidcConfig) {
		this._config = {
			scopes: ["openid", "profile", "email"],
			...config,
		}
	}

	get config(): OidcConfig {
		return this._config
	}

	set config(value: OidcConfig) {
		this._config = value
		this._discoveryDocument = null // Reset discovery document when config changes
	}

	/**
	 * Discovers OIDC endpoints from the issuer's well-known configuration
	 */
	private async discoverEndpoints(): Promise<OidcDiscoveryDocument> {
		if (this._discoveryDocument) {
			return this._discoveryDocument
		}

		try {
			const wellKnownUrl = `${this._config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`
			const response = await axios.get<OidcDiscoveryDocument>(wellKnownUrl, {
				timeout: 10000,
			})

			this._discoveryDocument = response.data
			return this._discoveryDocument
		} catch (error) {
			ErrorService.logMessage("OIDC discovery failed", "error")
			ErrorService.logException(error)
			throw new Error(`Failed to discover OIDC endpoints: ${error.message}`)
		}
	}

	/**
	 * Generates the authorization URL for the OAuth flow
	 */
	async getAuthorizationUrl(state: string): Promise<string> {
		const discovery = await this.discoverEndpoints()

		const params = new URLSearchParams({
			response_type: "code",
			client_id: this._config.clientId,
			redirect_uri: this._config.redirectUri,
			scope: this._config.scopes?.join(" ") || "openid profile email",
			state: state,
			...this._config.additionalParams,
		})

		return `${discovery.authorization_endpoint}?${params.toString()}`
	}

	/**
	 * Exchanges authorization code for tokens
	 */
	async exchangeCodeForTokens(code: string): Promise<OidcTokenResponse> {
		const discovery = await this.discoverEndpoints()

		try {
			const tokenData = new URLSearchParams({
				grant_type: "authorization_code",
				code: code,
				redirect_uri: this._config.redirectUri,
				client_id: this._config.clientId,
			})

			// Add client secret if provided (for confidential clients)
			if (this._config.clientSecret) {
				tokenData.append("client_secret", this._config.clientSecret)
			}

			const response = await axios.post<OidcTokenResponse>(discovery.token_endpoint, tokenData, {
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				timeout: 10000,
			})

			this._tokens = response.data
			return response.data
		} catch (error) {
			ErrorService.logMessage("OIDC token exchange failed", "error")
			ErrorService.logException(error)
			throw new Error(`Failed to exchange code for tokens: ${error.response?.data?.error_description || error.message}`)
		}
	}

	/**
	 * Fetches user information using the access token
	 */
	async getUserInfo(accessToken: string): Promise<OidcUserInfo> {
		const discovery = await this.discoverEndpoints()

		try {
			const response = await axios.get<OidcUserInfo>(discovery.userinfo_endpoint, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
				timeout: 10000,
			})

			this._currentUser = response.data
			return response.data
		} catch (error) {
			ErrorService.logMessage("OIDC userinfo fetch failed", "error")
			ErrorService.logException(error)
			throw new Error(`Failed to fetch user info: ${error.response?.data?.error_description || error.message}`)
		}
	}

	/**
	 * Gets the current authentication token
	 */
	async getAuthToken(): Promise<string | null> {
		if (!this._tokens) {
			return null
		}
		return this._tokens.access_token
	}

	/**
	 * Gets the current ID token
	 */
	async getIdToken(): Promise<string | null> {
		if (!this._tokens) {
			return null
		}
		return this._tokens.id_token
	}

	/**
	 * Gets the refresh token
	 */
	async getRefreshToken(): Promise<string | null> {
		if (!this._tokens) {
			return null
		}
		return this._tokens.refresh_token || null
	}

	/**
	 * Refreshes the authentication token using the refresh token
	 */
	async refreshAuthToken(): Promise<string | null> {
		if (!this._tokens?.refresh_token) {
			throw new Error("No refresh token available")
		}

		const discovery = await this.discoverEndpoints()

		try {
			const tokenData = new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: this._tokens.refresh_token,
				client_id: this._config.clientId,
			})

			if (this._config.clientSecret) {
				tokenData.append("client_secret", this._config.clientSecret)
			}

			const response = await axios.post<OidcTokenResponse>(discovery.token_endpoint, tokenData, {
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				timeout: 10000,
			})

			// Update stored tokens
			this._tokens = {
				...this._tokens,
				...response.data,
			}

			return response.data.access_token
		} catch (error) {
			ErrorService.logMessage("OIDC token refresh failed", "error")
			ErrorService.logException(error)
			throw new Error(`Failed to refresh token: ${error.response?.data?.error_description || error.message}`)
		}
	}

	/**
	 * Converts OIDC user info to the standard user format
	 */
	convertUserData(userInfo: OidcUserInfo) {
		return {
			uid: userInfo.sub,
			email: userInfo.email,
			displayName: userInfo.name || userInfo.preferred_username,
			photoUrl: userInfo.picture,
		}
	}

	/**
	 * Signs out the current user
	 */
	async signOut(): Promise<void> {
		try {
			// Clear local state
			this._currentUser = null
			this._tokens = null

			// Optionally call the OIDC end_session_endpoint if available
			if (this._discoveryDocument?.end_session_endpoint) {
				// Note: This is optional and depends on your OIDC provider
				// Some providers support logout, others don't
				console.log("OIDC logout endpoint available but not called (implement if needed)")
			}

			console.log("User signed out successfully from OIDC provider")
		} catch (error) {
			ErrorService.logMessage("OIDC sign-out error", "error")
			ErrorService.logException(error)
			throw error
		}
	}

	/**
	 * Stores authentication credentials securely
	 */
	private async storeAuthCredential(
		context: ExtensionContext,
		tokens: OidcTokenResponse,
		userInfo: OidcUserInfo,
	): Promise<void> {
		try {
			const credential = {
				tokens,
				userInfo,
				timestamp: Date.now(),
			}
			await storeSecret(context, "clineAccountId", JSON.stringify(credential))
		} catch (error) {
			ErrorService.logMessage("OIDC store credential error", "error")
			ErrorService.logException(error)
			throw error
		}
	}

	/**
	 * Restores authentication credentials from storage
	 */
	async restoreAuthCredential(context: ExtensionContext): Promise<OidcUserInfo | null> {
		const credentialJSON = await getSecret(context, "clineAccountId")
		if (!credentialJSON) {
			console.log("No stored OIDC authentication credential found")
			return null
		}

		try {
			const credential = JSON.parse(credentialJSON)
			this._tokens = credential.tokens
			this._currentUser = credential.userInfo

			// Check if tokens are expired and try to refresh
			if (this._tokens && this._tokens.expires_in) {
				const expirationTime = credential.timestamp + this._tokens.expires_in * 1000
				const now = Date.now()

				if (now >= expirationTime - 60000) {
					// Refresh if expiring within 1 minute
					try {
						await this.refreshAuthToken()
						// Update stored credentials with new tokens
						await this.storeAuthCredential(context, this._tokens!, this._currentUser!)
					} catch (refreshError) {
						console.warn("Failed to refresh OIDC token, user may need to re-authenticate")
						return null
					}
				}
			}

			return this._currentUser
		} catch (error) {
			ErrorService.logMessage("OIDC restore credential error", "error")
			ErrorService.logException(error)
			throw error
		}
	}

	/**
	 * Signs in the user using the authorization code
	 */
	async signIn(context: ExtensionContext, code: string): Promise<OidcUserInfo> {
		try {
			// Exchange code for tokens
			const tokens = await this.exchangeCodeForTokens(code)

			// Get user information
			const userInfo = await this.getUserInfo(tokens.access_token)

			// Store credentials
			await this.storeAuthCredential(context, tokens, userInfo)

			return userInfo
		} catch (error) {
			ErrorService.logMessage("OIDC sign-in error", "error")
			ErrorService.logException(error)
			throw error
		}
	}
}
