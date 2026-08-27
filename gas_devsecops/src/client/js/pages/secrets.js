import { renderStub } from "./_stub.js";

/** Credentials in the repository — a lifecycle of its own. */
export function renderSecrets(host) {
  renderStub(host, {
    lane: "Registers",
    title: "Secrets",
    lede: "Credentials committed to source: removing one is not the same as fixing it.",
    sections: [
      "The register: secret kind, repository, path, commit, first seen.",
      "Two states rather than one: removed from code, and rotated. The first does not imply the second.",
      "Exposure window: from the first commit to rotation — not to removal.",
      "What is still readable in git history after the string left HEAD.",
    ],
    note: "The only one of the three registers where a RESOLVED status from Wiz does not mean "
      + "the risk is gone: a committed secret stays live until it is rotated.",
  });
}
