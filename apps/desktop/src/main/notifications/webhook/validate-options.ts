import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import type { WebhookValidationResult } from "@wordless/protocol";

/**
 * Enforces a provider's own `optionsSchema`.
 *
 * The schema was declared from the start but nothing ever ran it, so an option blob
 * could hold anything at all. Two ways in: the settings form writes the blob, and a
 * config file on disk is editable by hand. The form cannot produce a bad shape on
 * its own — it renders a control per declared field — but a value that survives to
 * the platform is a 3am send failure, which is exactly what the schema exists to
 * prevent. So it is enforced at the boundary rather than trusted.
 *
 * Returns a typed code, never a sentence, matching the rest of the validation path.
 * `detail` carries the JSON pointer of the offending value for the log; it is not
 * user-facing wording, and no message is translated from it.
 */
export function validateProviderOptions(schema: unknown, options: unknown): WebhookValidationResult {
  // `unknown` in, `TSchema` here: the contract holds the schema as unknown because
  // that is how it arrives from a provider file, not because it is untyped.
  const typed = schema as TSchema;
  try {
    if (Value.Check(typed, options)) return { ok: true };
    const first = [...Value.Errors(typed, options)][0];
    if (!first) return { ok: false, code: "options-invalid" };
    // `instancePath` is a JSON pointer: "" for a mismatch on the object itself,
    // "/atMobiles/0" for one element of a list.
    return { ok: false, code: "options-invalid", detail: `${first.instancePath || "/"} ${first.message}` };
  } catch (error) {
    // A schema this function cannot evaluate is a bug in our own provider code, not
    // in the user's input. Refusing the save would blame them for it, and would leave
    // them unable to configure a channel that may be perfectly fine — so allow it and
    // say so in the log.
    console.warn("[webhook] could not validate options against the provider schema:", error);
    return { ok: true };
  }
}

/**
 * Filters a stored option blob down to what the channel's schema allows.
 *
 * Storage deliberately keeps `options` verbatim — it does not know the provider
 * registry, and a channel written by a newer build is exactly the case it must not
 * reject. The consequence is that a blob can hold a key this build cannot send, and
 * once the schema is enforced on save that becomes a trap: the settings form writes
 * the whole blob back, so the row can no longer be saved at all and the user sees
 * only "invalid options" with no way to find the offending key.
 *
 * So it is filtered on the way in. Keys are kept one at a time, each checked against
 * its own property schema, so one bad entry costs that entry rather than the whole
 * blob. The stored file is left alone: repairing it here would write on startup, and
 * reading through this filter forever costs nothing.
 */
export function sanitizeProviderOptions(
  schema: unknown,
  options: Record<string, unknown>,
): { options: Record<string, unknown>; repaired: boolean } {
  const { properties } = schema as { properties?: Record<string, unknown> };
  if (!properties) return { options: {}, repaired: Object.keys(options).length > 0 };

  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (!Object.hasOwn(properties, key)) continue;
    // A one-property schema per key, reusing the provider's own declaration rather
    // than re-stating its types here, which would be a second source of truth.
    const probe = { type: "object", properties: { [key]: properties[key] }, additionalProperties: false };
    if (Value.Check(probe as TSchema, { [key]: value })) kept[key] = value;
  }

  const repaired = Object.keys(kept).length !== Object.keys(options).length;
  return { options: kept, repaired };
}
