// The one outbound link this register offers: a CVE id, at NIST.
//
// LOCAL because it is a fact about OS vulnerabilities. The sibling registers key on a rule
// id, a package advisory and a credential — none of them has an NVD page, and a shared
// module that knew about CVEs would be this app's vocabulary sitting in the design system.

// Built so no literal `/` `/` byte pair appears in the bundle: SSL-inspecting middleboxes
// have been observed stripping "comments" from the served page and truncating lines at a
// bare double slash. The join (which esbuild cannot constant-fold, unlike "a" + "b") yields
// the https URL at runtime; the build guard in esbuild.config.mjs enforces the invariant.
export function nvdUrl(id) {
  return ["https:", "", "nvd.nist.gov", "vuln", "detail", encodeURIComponent(id || "")].join("/");
}
