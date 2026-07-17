// slimRecord is the single ingestion choke where the severity fallback is baked (upstream of
// the fixture-locked reconcile path). Lock that a blank top-level severity is healed from
// vendorSeverity/nvdSeverity with provenance, and that a real severity is left untouched with
// no `severity_source` stamped — so records without vendor/nvd fields stay byte-identical.

import { describe, expect, it } from "vitest";
import { slimRecord } from "../src/server/scanJobs";

describe("slimRecord severity bake", () => {
  it("rescues a blank severity from vendorSeverity and records provenance", () => {
    const out = slimRecord({ id: "v1", severity: "", vendorSeverity: "HIGH" });
    expect(out["severity"]).toBe("HIGH");
    expect(out["severity_source"]).toBe("vendorSeverity");
    // Raw signals survive for audit (both are in SLIM_TOP).
    expect(out["vendorSeverity"]).toBe("HIGH");
  });

  it("rescues from nvdSeverity when vendorSeverity is also blank", () => {
    const out = slimRecord({ id: "v2", severity: "", vendorSeverity: "", nvdSeverity: "medium" });
    expect(out["severity"]).toBe("MEDIUM");
    expect(out["severity_source"]).toBe("nvdSeverity");
  });

  it("leaves a real severity untouched and stamps no source", () => {
    const out = slimRecord({ id: "v3", severity: "critical", vendorSeverity: "LOW" });
    expect(out["severity"]).toBe("critical"); // verbatim copy, not normalized
    expect("severity_source" in out).toBe(false);
  });

  it("stamps no source when every candidate is blank (genuine UNKNOWN)", () => {
    const out = slimRecord({ id: "v4", severity: "", vendorSeverity: "", nvdSeverity: "" });
    expect(out["severity"]).toBe(""); // left as the raw copy; reconcile normalizes to UNKNOWN
    expect("severity_source" in out).toBe(false);
  });
});
