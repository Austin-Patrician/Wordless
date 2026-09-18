import { openCodeSessionHeadersFor } from "@wordless/ai/providers/opencode-headers";
import type { Model, ModelStreamOptions, MutableModels, ProviderHeaders } from "@wordless/ai";

/** Decides the headers a request to one model has to carry. */
export type ModelRequestHeadersPolicy = (
  model: Model,
  options: ModelStreamOptions | undefined,
) => ProviderHeaders | undefined;

/**
 * Headers shared by every request, whatever layer issued it.
 *
 * The registry is the one object the runtime hands to the harness (chat,
 * context compaction, branch summaries) and to its own model configuration
 * (selection translation), so deciding headers here covers paths that never see
 * the runtime's own options - compaction summarization in particular, which
 * issues a bare `completeSimple` request from inside the agent package.
 */
export const defaultModelRequestHeaders: ModelRequestHeadersPolicy = (model, options) =>
  openCodeSessionHeadersFor(model, { sessionId: options?.sessionId, headers: options?.headers });

function withPolicyHeaders(
  model: Model,
  options: ModelStreamOptions | undefined,
  policy: ModelRequestHeadersPolicy,
): ModelStreamOptions | undefined {
  const headers = policy(model, options);
  // Nothing to add means no allocation: unrelated providers pay no per-request cost.
  if (!headers) return options;
  return { ...options, headers: { ...options?.headers, ...headers } };
}

/**
 * Wraps a model registry so every dispatch applies a header policy.
 *
 * The wrapper delegates through the prototype chain instead of copying, because
 * `ModelsImpl` keeps its state in instance fields and its methods on the
 * prototype: a spread would produce an object with data but no methods. Only
 * `stream` and `streamSimple` are replaced, so every other call - including the
 * mutations `RuntimeModelConfiguration.rebuild()` performs - reaches the real
 * registry unchanged.
 */
export function withModelRequestHeaders(
  models: MutableModels,
  policy: ModelRequestHeadersPolicy = defaultModelRequestHeaders,
): MutableModels {
  const wrapped = Object.create(models) as MutableModels;
  wrapped.stream = (model, context, options) =>
    models.stream(model, context, withPolicyHeaders(model, options, policy));
  wrapped.streamSimple = (model, context, options) =>
    models.streamSimple(model, context, withPolicyHeaders(model, options, policy));
  return wrapped;
}
