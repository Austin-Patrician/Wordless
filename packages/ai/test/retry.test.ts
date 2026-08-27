import { describe, expect, it } from "vitest";
import { fauxAssistantMessage } from "../src/providers/faux.ts";
import { isRetryableAssistantError, retryAssistantCall } from "../src/utils/retry.ts";

const openAIExplicitRetryMessage =
	"An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID req_******** in your message.";
const bedrockExplicitRetryMessage =
	'{"message":"The system encountered an unexpected error during processing. Try your request again."}';
const nvidiaNIMResourceExhaustedMessage = "ResourceExhausted: Worker local total request limit reached (288/48)";
const bunFetchSocketClosedMessage =
	"The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()";

describe("provider retry classification", () => {
	it("runs the bounded assistant retry loop until a transient failure recovers", async () => {
		let calls = 0;
		const scheduled: number[] = [];
		const result = await retryAssistantCall(
			async () => {
				calls += 1;
				return calls < 3
					? fauxAssistantMessage("", { stopReason: "error", errorMessage: "Connection error." })
					: fauxAssistantMessage("recovered");
			},
			{ enabled: true, maxRetries: 5, baseDelayMs: 0 },
			undefined,
			{ onRetryScheduled: (attempt) => scheduled.push(attempt) },
		);

		expect(calls).toBe(3);
		expect(scheduled).toEqual([1, 2]);
		expect(result.stopReason).toBe("stop");
	});

	it("matches explicit provider retry guidance", () => {
		expect(
			isRetryableAssistantError(
				fauxAssistantMessage("", { stopReason: "error", errorMessage: openAIExplicitRetryMessage }),
			),
		).toBe(true);
		expect(
			isRetryableAssistantError(
				fauxAssistantMessage("", { stopReason: "error", errorMessage: bedrockExplicitRetryMessage }),
			),
		).toBe(true);
		expect(
			isRetryableAssistantError(
				fauxAssistantMessage("", { stopReason: "error", errorMessage: nvidiaNIMResourceExhaustedMessage }),
			),
		).toBe(true);
	});

	it("matches Bun fetch socket drop wording", () => {
		expect(
			isRetryableAssistantError(
				fauxAssistantMessage("", { stopReason: "error", errorMessage: bunFetchSocketClosedMessage }),
			),
		).toBe(true);
	});

	it("matches DNS resolution failures", () => {
		for (const errorMessage of ["getaddrinfo ENOTFOUND api.example.com", "EAI_AGAIN api.example.com"]) {
			expect(
				isRetryableAssistantError(fauxAssistantMessage("", { stopReason: "error", errorMessage })),
			).toBe(true);
		}
	});

	it("keeps provider limit errors non-retryable", () => {
		expect(
			isRetryableAssistantError(
				fauxAssistantMessage("", { stopReason: "error", errorMessage: "429 quota exceeded" }),
			),
		).toBe(false);
	});

	it("classifies assistant error messages", () => {
		expect(
			isRetryableAssistantError(fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" })),
		).toBe(true);
		expect(
			isRetryableAssistantError(
				fauxAssistantMessage("", { stopReason: "error", errorMessage: "524 status code (no body)" }),
			),
		).toBe(true);
		expect(isRetryableAssistantError(fauxAssistantMessage("not an error"))).toBe(false);
	});
});
