import { getDunningRetryDelaysMs, MAX_DUNNING_ATTEMPTS } from "./dunning-policy";

describe("dunning-policy", () => {
  it("returns the production day-scale schedule when no override is set", () => {
    const delays = getDunningRetryDelaysMs(undefined);
    expect(delays).toHaveLength(MAX_DUNNING_ATTEMPTS);
    expect(delays).toEqual([86400000, 259200000, 604800000]);
  });

  it("parses a comma-separated override for e2e tests", () => {
    expect(getDunningRetryDelaysMs("1000,2000,3000")).toEqual([1000, 2000, 3000]);
  });

  it("rejects an override with the wrong number of values", () => {
    expect(() => getDunningRetryDelaysMs("1000,2000")).toThrow(/exactly 3/);
  });

  it("rejects an override with a non-numeric value", () => {
    expect(() => getDunningRetryDelaysMs("1000,abc,3000")).toThrow(/exactly 3/);
  });
});
