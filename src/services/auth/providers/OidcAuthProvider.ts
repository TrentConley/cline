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

function decodeJwtPayload(token: string): any {
	try {
		const payload = token.split(".")[1]
		if (!payload) {
			return null
		}
		const decoded = Buffer.from(payload, "base64").toString("utf8")
		return JSON.parse(decoded)
	} catch (error) {
		console.error("Error decoding JWT payload:", error)
		return null
	}
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
			console.log("OIDC: Using cached discovery document")
			return this._discoveryDocument
		}

		console.log("OIDC: Starting endpoint discovery...")
		console.log("OIDC: Issuer URL:", this._config.issuer)

		try {
			const wellKnownUrl = `${this._config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`
			console.log("OIDC: Discovery URL:", wellKnownUrl)

			// Try with enhanced axios configuration
			console.log("OIDC: Making HTTP request to discovery endpoint...")
			const startTime = Date.now()

			const axiosConfig = {
				timeout: 15000, // Increased timeout
				headers: {
					Accept: "application/json",
					"User-Agent": "Cline-VSCode-Extension/1.0",
					"Cache-Control": "no-cache",
				},
				// Handle SSL issues in development
				httpsAgent:
					process.env.NODE_ENV === "development"
						? new (require("https").Agent)({ rejectUnauthorized: false })
						: undefined,
				validateStatus: (status: number) => status < 500, // Accept 4xx as valid responses to debug further
			}

			console.log("OIDC: Request config:", {
				timeout: axiosConfig.timeout,
				headers: axiosConfig.headers,
				url: wellKnownUrl,
			})

			const response = await axios.get<OidcDiscoveryDocument>(wellKnownUrl, axiosConfig)
			const endTime = Date.now()

			console.log(`OIDC: Discovery request completed in ${endTime - startTime}ms`)
			console.log("OIDC: Discovery response status:", response.status)
			console.log("OIDC: Response headers:", response.headers)

			// Check if we got a successful response
			if (response.status >= 400) {
				console.error("OIDC: HTTP error response:", {
					status: response.status,
					statusText: response.statusText,
					data: response.data,
				})
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			console.log("OIDC: Discovery document endpoints:", {
				authorization_endpoint: response.data.authorization_endpoint,
				token_endpoint: response.data.token_endpoint,
				userinfo_endpoint: response.data.userinfo_endpoint,
				issuer: response.data.issuer,
			})

			this._discoveryDocument = response.data
			return this._discoveryDocument
		} catch (error) {
			console.error("OIDC: Discovery failed with error:", error)
			console.error("OIDC: Error details:", {
				message: error.message,
				code: error.code,
				status: error.response?.status,
				statusText: error.response?.statusText,
				data: error.response?.data,
			})
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
		console.log("OIDC: getUserInfo called, discovering endpoints...")
		const discovery = await this.discoverEndpoints()
		console.log("OIDC: Using userinfo endpoint:", discovery.userinfo_endpoint)

		try {
			console.log("OIDC: Making userinfo request with token:", `${accessToken.substring(0, 10)}...`)
			const startTime = Date.now()
			const response = await axios.get<OidcUserInfo>(discovery.userinfo_endpoint, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
				timeout: 10000,
			})
			const endTime = Date.now()

			console.log(`OIDC: Userinfo request completed in ${endTime - startTime}ms`)
			console.log("OIDC: Userinfo response status:", response.status)
			console.log("OIDC: User data received:", {
				sub: response.data.sub,
				email: response.data.email,
				name: response.data.name || response.data.given_name + " " + response.data.family_name,
			})

			this._currentUser = response.data
			return response.data
		} catch (error) {
			console.error("OIDC: Userinfo fetch failed:", error)
			console.error("OIDC: Userinfo error details:", {
				message: error.message,
				code: error.code,
				status: error.response?.status,
				statusText: error.response?.statusText,
				data: error.response?.data,
			})
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
	 * Gets the token expiration time in milliseconds
	 */
	async getTokenExpirationTime(context: ExtensionContext): Promise<number | null> {
		if (!this._tokens || !this._tokens.expires_in) {
			return null
		}

		// Get the stored credential to access the timestamp
		try {
			const credentialJSON = await getSecret(context, "clineAccountId")
			if (credentialJSON) {
				const credential = JSON.parse(credentialJSON)
				if (credential.timestamp) {
					return credential.timestamp + this._tokens.expires_in * 1000
				}
			}
		} catch (error) {
			console.error("Error getting token expiration time:", error)
		}

		return null
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

	/**
	 * Signs in the user using tokens received from the callback
	 */
	async signInWithTokens(context: ExtensionContext, tokens: OidcTokenResponse): Promise<OidcUserInfo> {
		try {
			this._tokens = tokens
			// NOTE: In a production environment, you should validate the id_token signature and claims here.
			// For this implementation, we are trusting the token from the callback server.
			const userInfoFromToken = decodeJwtPayload(tokens.id_token)

			if (!userInfoFromToken) {
				throw new Error("Invalid ID token received.")
			}

			// You can either trust the user info from the id_token or fetch it from the userinfo endpoint
			// Fetching from the endpoint is generally more reliable.
			const userInfo = await this.getUserInfo(tokens.access_token)
			this._currentUser = userInfo

			// Store credentials
			await this.storeAuthCredential(context, tokens, userInfo)

			return userInfo
		} catch (error) {
			console.error("OIDC: signInWithTokens failed, running diagnostics...")

			// Run diagnostics to help debug the issue
			try {
				await this.runDiagnostics()
			} catch (diagError) {
				console.error("OIDC: Diagnostics also failed:", diagError.message)
			}

			ErrorService.logMessage("OIDC sign-in with token error", "error")
			ErrorService.logException(error)
			throw error
		}
	}

	/**
	 * Test network connectivity to OIDC endpoints for debugging
	 */
	async testConnectivity(): Promise<void> {
		console.log("OIDC: Testing network connectivity...")

		const wellKnownUrl = `${this._config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`
		console.log("OIDC: Testing connectivity to:", wellKnownUrl)

		try {
			const startTime = Date.now()
			const response = await axios.head(wellKnownUrl, {
				timeout: 5000,
			})
			const endTime = Date.now()

			console.log(`OIDC: Connectivity test PASSED - Response time: ${endTime - startTime}ms`)
			console.log("OIDC: Response headers:", response.headers)
		} catch (error) {
			console.error("OIDC: Connectivity test FAILED:", error.message)
			if (error.code === "ENOTFOUND") {
				console.error("OIDC: DNS resolution failed - check issuer URL")
			} else if (error.code === "ECONNREFUSED") {
				console.error("OIDC: Connection refused - server may be down")
			} else if (error.code === "ETIMEDOUT") {
				console.error("OIDC: Connection timeout - network or firewall issue")
			}
			throw error
		}
	}

	/**
	 * Comprehensive diagnostic method to debug discovery issues
	 */
	async runDiagnostics(): Promise<void> {
		const wellKnownUrl = `${this._config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`
		console.log("🔍 OIDC DIAGNOSTICS STARTING...")
		console.log("Target URL:", wellKnownUrl)

		// Test 1: Basic connectivity
		console.log("\n📡 Test 1: Basic HEAD request...")
		try {
			await this.testConnectivity()
			console.log("✅ Basic connectivity: PASSED")
		} catch (error) {
			console.log("❌ Basic connectivity: FAILED")
			console.error(error.message)
		}

		// Test 2: Simple GET request
		console.log("\n🌐 Test 2: Simple GET request...")
		try {
			const response = await axios.get(wellKnownUrl, { timeout: 5000 })
			console.log("✅ Simple GET: PASSED")
			console.log("Response size:", JSON.stringify(response.data).length, "bytes")
		} catch (error) {
			console.log("❌ Simple GET: FAILED")
			console.error("Error:", error.message)
			console.error("Code:", error.code)
		}

		// Test 3: GET with headers
		console.log("\n📋 Test 3: GET with standard headers...")
		try {
			const response = await axios.get(wellKnownUrl, {
				timeout: 5000,
				headers: {
					Accept: "application/json",
					"User-Agent": "Cline-VSCode-Extension/1.0",
				},
			})
			console.log("✅ GET with headers: PASSED")
			console.log("Authorization endpoint found:", !!response.data.authorization_endpoint)
			console.log("Token endpoint found:", !!response.data.token_endpoint)
			console.log("Userinfo endpoint found:", !!response.data.userinfo_endpoint)
		} catch (error) {
			console.log("❌ GET with headers: FAILED")
			console.error("Error:", error.message)
			console.error("Status:", error.response?.status)
			console.error("Response:", error.response?.data)
		}

		// Test 4: Compare issuer in response vs config
		console.log("\n🔍 Test 4: Issuer validation...")
		try {
			const response = await axios.get(wellKnownUrl, { timeout: 5000 })
			const responseIssuer = response.data.issuer
			const configIssuer = this._config.issuer

			console.log("Config issuer:", configIssuer)
			console.log("Response issuer:", responseIssuer)

			if (responseIssuer === configIssuer) {
				console.log("✅ Issuer validation: PASSED")
			} else {
				console.log("⚠️ Issuer validation: MISMATCH")
				console.log("This might cause token validation issues!")
			}
		} catch (error) {
			console.log("❌ Issuer validation: FAILED")
			console.error(error.message)
		}

		console.log("\n🔍 OIDC DIAGNOSTICS COMPLETED\n")
	}
}
