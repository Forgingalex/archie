import { describe, it, expect } from "vitest";
import { cache, cacheKey } from "../src/cache/cache.js";

describe("Cache", () => {
  it("should store and retrieve values", () => {
    cache.set("test-key", { hello: "world" }, 60);
    const result = cache.get("test-key");
    expect(result).toEqual({ hello: "world" });
  });

  it("should return null for expired entries", async () => {
    cache.set("expire-test", "value", 0.01); // 10ms TTL
    await new Promise((r) => setTimeout(r, 50));
    const result = cache.get("expire-test");
    expect(result).toBeNull();
  });

  it("should return null for missing keys", () => {
    const result = cache.get("nonexistent");
    expect(result).toBeNull();
  });

  it("should build consistent cache keys", () => {
    const key1 = cacheKey("crypto", "getPrice", { coins: "bitcoin", currencies: "usd" });
    const key2 = cacheKey("crypto", "getPrice", { currencies: "usd", coins: "bitcoin" });
    expect(key1).toBe(key2); // Order shouldn't matter
  });
});
