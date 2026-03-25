/**
 * ConnectorRegistry tests.
 */
import { describe, it, expect } from "vitest";
import { registry } from "../src/connectors/registry.js";

describe("ConnectorRegistry", () => {
  it("registers all 5 default connectors", () => {
    const names = registry.list().map((c) => c.name);
    expect(names).toContain("crypto");
    expect(names).toContain("forex");
    expect(names).toContain("news");
    expect(names).toContain("twitter");
    expect(names).toContain("blockchain");
    expect(names.length).toBe(5);
  });

  it("get() returns the correct connector", () => {
    const crypto = registry.get("crypto");
    expect(crypto).toBeDefined();
    expect(crypto?.config.name).toBe("crypto");
  });

  it("get() returns undefined for unknown connector", () => {
    expect(registry.get("doesNotExist")).toBeUndefined();
  });

  it("list() includes name, description, and cost for each connector", () => {
    for (const connector of registry.list()) {
      expect(typeof connector.name).toBe("string");
      expect(typeof connector.description).toBe("string");
      expect(typeof connector.cost).toBe("string");
    }
  });

  it("toolDescriptions() returns a non-empty string containing all connector names", () => {
    const desc = registry.toolDescriptions();
    expect(typeof desc).toBe("string");
    expect(desc.length).toBeGreaterThan(0);
    for (const name of ["crypto", "forex", "news", "twitter", "blockchain"]) {
      expect(desc).toContain(name);
    }
  });

  it("toolDescriptions() includes action lists", () => {
    const desc = registry.toolDescriptions();
    expect(desc).toContain("getPrice");
    expect(desc).toContain("convert");
    expect(desc).toContain("headlines");
  });
});
