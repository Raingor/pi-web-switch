import type { PiModelsJson } from "@/types";

/**
 * Build a models.json payload for a providers-only change.
 *
 * The server overwrites models.json wholesale, so any payload that omits
 * `_disabledProviders` permanently deletes every disabled provider — config
 * and API keys included. Every providers mutation must round-trip the shelf.
 */
export function withProviders(
  modelsJson: PiModelsJson,
  providers: PiModelsJson["providers"]
): PiModelsJson {
  const disabled = modelsJson._disabledProviders;
  return disabled && Object.keys(disabled).length > 0
    ? { providers, _disabledProviders: disabled }
    : { providers };
}

/**
 * Remove a provider from both the active map and the disabled shelf, so
 * deleting a provider works the same whether or not it is currently disabled.
 */
export function withProviderRemoved(modelsJson: PiModelsJson, id: string): PiModelsJson {
  const { [id]: _active, ...providers } = modelsJson.providers;
  const { [id]: _disabled, ...disabled } = modelsJson._disabledProviders ?? {};
  return Object.keys(disabled).length > 0
    ? { providers, _disabledProviders: disabled }
    : { providers };
}
