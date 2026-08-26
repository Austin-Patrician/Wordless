import type { OAuthAuth } from "../../auth/types.ts";

/**
 * Loads an OAuth flow module through a variable specifier so bundlers cannot
 * follow the import into Node-only flow code (`node:http` callback servers,
 * `node:crypto` PKCE). The `.ts`/`.js` rewrite keeps the trick working from
 * both source and built output.
 */
export const loadAnthropicOAuth = async (): Promise<OAuthAuth> =>
	(await import("./anthropic.ts")).anthropicOAuth;

export const loadOpenAICodexOAuth = async (): Promise<OAuthAuth> =>
	(await import("./openai-codex.ts")).openaiCodexOAuth;

export const loadGitHubCopilotOAuth = async (): Promise<OAuthAuth> =>
	(await import("./github-copilot.ts")).githubCopilotOAuth;
