import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState, memo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { validateApiConfiguration } from "@/utils/validate"
import ApiOptions from "@/components/settings/ApiOptions"
import ClineLogoWhite from "@/assets/ClineLogoWhite"
import { StateServiceClient } from "@/services/grpc-client"
import { BooleanRequest } from "@shared/proto/common"

const WelcomeView = memo(() => {
	const { apiConfiguration } = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [showApiOptions, setShowApiOptions] = useState(true)

	const disableLetsGoButton = apiErrorMessage != null

	const handleSubmit = async () => {
		try {
			await StateServiceClient.setWelcomeViewCompleted(BooleanRequest.create({ value: true }))
		} catch (error) {
			console.error("Failed to update API configuration or complete welcome view:", error)
		}
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(apiConfiguration))
	}, [apiConfiguration])

	return (
		<div className="fixed inset-0 p-0 flex flex-col">
			<div className="h-full px-5 overflow-auto">
				<h2>Hi, I'm Cline</h2>
				<div className="flex justify-center my-5">
					<ClineLogoWhite className="size-16" />
				</div>
				<p>
					I can do all kinds of tasks thanks to breakthroughs in{" "}
					<VSCodeLink href="https://www.anthropic.com/claude/sonnet" className="inline">
						Claude 4 Sonnet's
					</VSCodeLink>
					agentic coding capabilities and access to tools that let me create & edit files, explore complex projects, use
					a browser, and execute terminal commands <i>(with your permission, of course)</i>. I can even use MCP to
					create new tools and extend my own capabilities.
				</p>

				<p className="text-[var(--vscode-descriptionForeground)]">
					Please configure your API key to access models like Claude 3.7 Sonnet.
				</p>

				<div className="mt-4.5">
					{showApiOptions && (
						<div>
							<ApiOptions showModelOptions={false} />
							<VSCodeButton onClick={handleSubmit} disabled={disableLetsGoButton} className="mt-0.75">
								Let's go!
							</VSCodeButton>
						</div>
					)}
				</div>
			</div>
		</div>
	)
})

export default WelcomeView
