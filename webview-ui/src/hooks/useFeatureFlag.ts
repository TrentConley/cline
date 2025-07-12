import { useExtensionState } from "@/context/ExtensionStateContext"

export const useFeatureFlag = (flagName: string): boolean => {
	const { telemetrySetting } = useExtensionState()

	// TODO: Implement feature flag service integration with backend
	// For now, return false as a fallback since no feature flag service is exposed to webview
	try {
		if (telemetrySetting === "enabled") {
			console.warn(`Feature flag ${flagName} not implemented - returning false as fallback.`)
		}
	} catch (error) {
		console.error(`Error with feature flag "${flagName}":`, error)
	}
	return false
}
