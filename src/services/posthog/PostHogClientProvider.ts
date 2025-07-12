// import { PostHog } from "posthog-node"
// import { posthogConfig } from "@/shared/services/config/posthog-config"

class PostHogClientProvider {
	private static instance: PostHogClientProvider
	private client: any

	private constructor() {
		this.client = {
			capture: () => {},
			identify: () => {},
			isFeatureEnabled: () => false,
			reloadFeatureFlags: async () => {},
			shutdown: async () => {},
			optIn: () => {},
			optOut: () => {},
			getFeatureFlagPayload: async () => ({ enabled: false }),
		}
	}

	public static getInstance(): PostHogClientProvider {
		if (!PostHogClientProvider.instance) {
			PostHogClientProvider.instance = new PostHogClientProvider()
		}
		return PostHogClientProvider.instance
	}

	public getClient(): any {
		return this.client
	}

	public async shutdown(): Promise<void> {
		await this.client.shutdown()
	}
}

export const posthogClientProvider = PostHogClientProvider.getInstance()
