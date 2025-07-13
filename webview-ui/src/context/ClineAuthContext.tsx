import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { StateServiceClient, AccountServiceClient } from "@/services/grpc-client"
import { EmptyRequest } from "@shared/proto/common"

// Define User type (you may need to adjust this based on your actual User type)
export interface ClineUser {
	uid: string
	email?: string
	displayName?: string
	photoUrl?: string
}

interface ClineAuthContextType {
	clineUser: ClineUser | null
	handleSignIn: () => void
	handleSignOut: () => void
}

const ClineAuthContext = createContext<ClineAuthContextType | undefined>(undefined)

export const ClineAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [user, setUser] = useState<ClineUser | null>(null)

	useEffect(() => {
		console.log("Extension: ClineAuthContext: user updated:", user)
	}, [user])

	// Handle auth status update events
	useEffect(() => {
		// Subscribe to auth status updates from the backend
		const cancelSubscription = StateServiceClient.subscribeToState(EmptyRequest.create(), {
			onResponse: async (response: any) => {
				console.log("Extension: ClineAuthContext: Received state update:", response)
				if (response && response.stateJson) {
					try {
						const stateData = JSON.parse(response.stateJson)
						if (stateData.userInfo) {
							setUser(stateData.userInfo)
						} else {
							handleSignIn()
						}
					} catch (error) {
						console.error("Error parsing state JSON:", error)
					}
				}
			},
			onError: (error: Error) => {
				console.error("Error in state subscription:", error)
			},
			onComplete: () => {
				console.log("State subscription completed")
			},
		})

		// Cleanup function to cancel subscription when component unmounts
		return () => {
			cancelSubscription()
		}
	}, [])

	const handleSignIn = useCallback(async () => {
		try {
			// This will trigger the OIDC authentication flow
			// The backend will handle the OIDC provider authentication
			console.log("Initiating OIDC authentication")
			await AccountServiceClient.accountLoginClicked(EmptyRequest.create())
			// The actual authentication is handled by the backend AuthService
			// when the user clicks the sign-in button
		} catch (error) {
			console.error("Error signing in:", error)
			throw error
		}
	}, [])

	const handleSignOut = useCallback(async () => {
		try {
			// Handle OIDC logout
			// The backend will handle the logout process
			console.log("Initiating OIDC logout")
			setUser(null)
		} catch (error) {
			console.error("Error signing out:", error)
			throw error
		}
	}, [])

	return (
		<ClineAuthContext.Provider value={{ clineUser: user, handleSignIn, handleSignOut }}>{children}</ClineAuthContext.Provider>
	)
}

export const useClineAuth = () => {
	const context = useContext(ClineAuthContext)
	if (context === undefined) {
		throw new Error("useClineAuth must be used within a ClineAuthProvider")
	}
	return context
}
