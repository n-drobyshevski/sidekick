// Redeploy the app's existing web-app deployment in place.
//
//   DEPLOYMENT_ID=AKfy… npm run deploy     push, cut a version, point THAT deployment at it
//   npm run deploy:new                      push, cut a version, create a NEW deployment
//
// WHY IN PLACE IS THE DEFAULT. A bare `clasp deploy` creates a new deployment, and a new
// deployment is a new /exec URL — so the URL people bookmarked, and the one pasted into the
// hub and the sibling apps' Script Properties, keeps serving the OLD version. `clasp deploy
// -i <id>` instead cuts a version and repoints the existing deployment at it: same URL, new
// code. That is the deploy wanted every time except the first, so it is the one that needs no
// second thought, and the one that creates a URL is spelled out as `deploy:new`.
//
// It REFUSES rather than falling back when DEPLOYMENT_ID is unset: a silent fallback to a new
// deployment is the exact mistake this script exists to prevent. The id is on Deploy → Manage
// deployments (or `npx clasp deployments`); it is per-installation, so it lives in the
// environment, not in the repo — same reason no .clasp.json is committed.
//
// `npm run push` first, which runs the app's `check:exact` gate before `clasp push`.
//
// Cross-platform by spawning `node` on the npm and clasp entry scripts directly — no shell, so
// no .cmd shims or quoting rules on Windows. npm runs scripts from the package directory, so
// cwd is the app.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildStamp } from "./buildStamp.mjs";

const root = process.cwd();
const deploymentId = (process.env.DEPLOYMENT_ID ?? "").trim();

if (!deploymentId) {
  console.error(
    "deploy: DEPLOYMENT_ID is not set, so there is no deployment to update in place.\n" +
    "  Set it to the web app's id (Deploy → Manage deployments, or `npx clasp deployments`):\n" +
    "    DEPLOYMENT_ID=AKfy… npm run deploy\n" +
    "  First deploy of this project, or you really want a second /exec URL? npm run deploy:new",
  );
  process.exit(1);
}

// Set by npm for every `npm run`; absent means someone ran this file by hand.
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("deploy: run this as `npm run deploy` from the app's directory.");
  process.exit(1);
}

function run(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const claspDir = join(root, "node_modules", "@google", "clasp");
const claspBin = join(claspDir, JSON.parse(readFileSync(join(claspDir, "package.json"), "utf8")).bin.clasp);

run(npmCli, ["run", "push"]);
// The build id `npm run which-build` resolves, so each version in the deployment's history
// names the source it was cut from.
run(claspBin, ["deploy", "-i", deploymentId, "-d", `build ${buildStamp(root).id}`]);
