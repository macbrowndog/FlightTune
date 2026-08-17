import { describe, expect, it } from "vitest";
import { applyChanges, createPlan, scoreCpu, type Change } from "./optimizer";

describe("CPU hardware tiers", () => {
  it.each([
    ["13th Gen Intel Core i9-13900K", 3],
    ["Intel Core Ultra 9 285K", 3],
    ["AMD Ryzen 7 9800X3D", 3],
    ["AMD Ryzen 9 7950X", 3],
    ["Intel Core i7-12700K", 2],
    ["AMD Ryzen 7 7700X", 2],
    ["Intel Core Ultra 7 155H", 2],
    ["AMD Ryzen 5 5600X", 1],
    ["Unknown processor", 1],
  ])("classifies %s as tier %i", (name, tier) => {
    expect(scoreCpu(name)).toBe(tier);
  });
});

describe("configuration editing", () => {
  it("preserves CRLF line endings while applying an exact change", () => {
    const config = "{Video\r\n  SecondaryScaling 1.000000\r\n}\r\n";
    const changes: Change[] = [{
      line: 1,
      setting: "Video · SecondaryScaling",
      from: "1.000000",
      to: "0.900000",
      reason: "Test",
      impact: "VR",
    }];
    expect(applyChanges(config, changes)).toBe("{Video\r\n  SecondaryScaling 0.900000\r\n}\r\n");
  });

  it("does not change a line when the expected original value is stale", () => {
    const config = "{Video\n  SecondaryScaling 0.800000\n}";
    const changes: Change[] = [{
      line: 1,
      setting: "Video · SecondaryScaling",
      from: "1.000000",
      to: "0.900000",
      reason: "Test",
      impact: "VR",
    }];
    expect(applyChanges(config, changes)).toBe(config);
  });

  it("uses the tested CPU tier when creating terrain recommendations", () => {
    const config = "{Graphics\n  {Terrain\n    LoDFactor 1.000000\n  }\n}";
    const plan = createPlan(config, "Intel Core Ultra 9 285K", 24, "Pimax", "vfr", "TAA", "Quality");
    expect(plan.changes.find((change) => change.setting === "Terrain · LoDFactor")?.to).toBe("2.050000");
  });
});
