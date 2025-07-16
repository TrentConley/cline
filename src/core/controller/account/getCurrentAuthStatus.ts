import { AuthService } from "@/services/auth/AuthService"
import { AuthState } from "@shared/proto/account"
import type { EmptyRequest } from "@shared/proto/common"
import type { Controller } from "../index"

/**
 * Gets the current authentication status directly from AuthService
 * @param controller The controller instance
 * @param request Empty request
 * @returns Current authentication state
 */
export async function getCurrentAuthStatus(controller: Controller, request: EmptyRequest): Promise<AuthState> {
	try {
		const authService = AuthService.getInstance()

		// Get the auth info directly from the auth service
		const authInfo = authService.getInfo()

		console.log("getCurrentAuthStatus: Auth info:", {
			hasUser: !!authInfo.user,
			isAuthenticated: authService.isAuthenticated(),
		})

		return authInfo
	} catch (error) {
		console.error("Error getting current auth status:", error)
		// Return empty auth state on error
		return AuthState.create({
			user: undefined,
		})
	}
}
