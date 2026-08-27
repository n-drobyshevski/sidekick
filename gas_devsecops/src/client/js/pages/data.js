import { renderStub } from "./_stub.js";

/** The stored record and what can be taken out of it. */
export function renderData(host) {
  renderStub(host, {
    lane: "Data",
    title: "Storage",
    lede: "The register's storage: what it occupies, what can be exported, what can be reset.",
    sections: [
      "Export of the ledger and the derived tables as CSV.",
      "Space in use: sheet cells, Drive archives, and headroom against the limits.",
      "Reset, and rebuilding the ledger from the archive.",
    ],
  });
}
