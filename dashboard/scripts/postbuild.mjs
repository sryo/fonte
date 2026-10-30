import path from "node:path";
import { fileURLToPath } from "node:url";
import { deployDashboardApp } from "./deploy-app.mjs";

const dashboardDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = deployDashboardApp({ sourceDir: dashboardDir, env: process.env });
console.log(target ? `Dashboard runtime files synced to ${target}` : "FONTE_SKIP_DEPLOY=1, skipped the dashboard-app sync");
