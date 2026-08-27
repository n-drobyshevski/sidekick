import { renderStub } from "./_stub.js";

/** The estate: repositories as the asset, and who owns them. */
export function renderRepos(host) {
  renderStub(host, {
    lane: "Data",
    title: "Repositories",
    lede: "Where the backlog sits, which repositories offer a foothold, and who owns them.",
    sections: [
      "Repository profile: finding density by percentile rather than by mean — the distribution is far too skewed for a mean to describe it.",
      "The foothold rate: the share of repositories carrying at least one high-risk finding.",
      "Half-life per repository — the same Kaplan–Meier estimator, grouped by asset instead of by severity.",
      "Capacity per repository: which are falling behind, which are holding, which are gaining.",
      "Ownership attribution: coverage of the project hierarchy, and what is left unowned.",
    ],
    note: "For a code register subscriptionName is always null, so there is no second "
      + "attribution dimension — ownership comes from the projects[] folder/leaf hierarchy "
      + "on sastFindings.",
  });
}
