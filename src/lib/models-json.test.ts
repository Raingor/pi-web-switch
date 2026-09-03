import { describe, expect, it } from "vitest";
import { withProviders, withProviderRemoved } from "./models-json";
import type { PiModelsJson } from "@/types";

const shelved: PiModelsJson = {
  providers: { active: { name: "Active" } },
  _disabledProviders: { shelved: { name: "Shelved", apiKey: "sk-keep" } },
};

describe("withProviders", () => {
  it("keeps the disabled shelf when providers change", () => {
    const next = withProviders(shelved, { active: { name: "Renamed" } });
    expect(next._disabledProviders).toEqual(shelved._disabledProviders);
    expect(next.providers).toEqual({ active: { name: "Renamed" } });
  });

  it("omits the shelf key when nothing is disabled", () => {
    const next = withProviders({ providers: {} }, { a: {} });
    expect("_disabledProviders" in next).toBe(false);
  });

  it("omits an empty shelf instead of writing an empty object", () => {
    const next = withProviders({ providers: {}, _disabledProviders: {} }, { a: {} });
    expect("_disabledProviders" in next).toBe(false);
  });
});

describe("withProviderRemoved", () => {
  it("removes an active provider and keeps the shelf", () => {
    const next = withProviderRemoved(shelved, "active");
    expect(next.providers).toEqual({});
    expect(next._disabledProviders).toEqual(shelved._disabledProviders);
  });

  it("removes a disabled provider from the shelf", () => {
    const next = withProviderRemoved(shelved, "shelved");
    expect(next.providers).toEqual(shelved.providers);
    expect("_disabledProviders" in next).toBe(false);
  });
});
