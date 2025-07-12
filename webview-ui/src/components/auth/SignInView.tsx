import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useClineAuth } from "@/context/ClineAuthContext"
import ClineLogoWhite from "@/assets/ClineLogoWhite"

const SignInView = () => {
	const { handleSignIn } = useClineAuth()

	const handleLogin = () => {
		handleSignIn()
	}

	return (
		<div className="fixed inset-0 flex items-center justify-center bg-[var(--vscode-editor-background)]">
			<div className="flex flex-col items-center p-8 max-w-md mx-auto">
				<div className="flex justify-center mb-6">
					<ClineLogoWhite className="size-16" />
				</div>

				<h2 className="text-2xl font-bold text-[var(--vscode-foreground)] mb-4 text-center">Sign in to continue</h2>

				<p className="text-[var(--vscode-descriptionForeground)] text-center mb-6">
					Please sign in to access Cline and start your coding tasks.
				</p>

				<VSCodeButton appearance="primary" onClick={handleLogin} className="w-full py-2 px-4 text-base">
					Sign In
				</VSCodeButton>
			</div>
		</div>
	)
}

export default SignInView
