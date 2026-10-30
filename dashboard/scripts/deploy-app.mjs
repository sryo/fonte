import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const RUNTIME_FILES = ["package.json", "next.config.ts", "tsconfig.json"];

/** @param {Record<string, string | undefined>} env */
export function dashboardAppDir(env) {
  const fonteHome = env.FONTE_HOME || path.join(env.HOME || os.homedir(), ".fonte");
  return path.join(fonteHome, "dashboard-app");
}

/**
 * @param {{ sourceDir: string, env: Record<string, string | undefined> }} options
 * @returns {string | null}
 */
export function deployDashboardApp({ sourceDir, env }) {
  if (env.FONTE_SKIP_DEPLOY === "1") return null;

  const target = dashboardAppDir(env);
  for (const file of RUNTIME_FILES) {
    if (!fs.existsSync(path.join(sourceDir, file))) {
      throw new Error(`Missing ${file} in ${sourceDir}`);
    }
  }
  fs.mkdirSync(target, { recursive: true });
  for (const file of RUNTIME_FILES) {
    fs.copyFileSync(path.join(sourceDir, file), path.join(target, file));
  }

  const rsync = spawnSync(
    "rsync",
    ["-a", "--delete", path.join(sourceDir, "public") + "/", path.join(target, "public") + "/"],
    { stdio: ["ignore", "inherit", "pipe"], encoding: "utf8" },
  );
  if (rsync.error) throw rsync.error;
  if (rsync.status !== 0) {
    throw new Error(`rsync of public/ failed (exit ${rsync.status}): ${rsync.stderr.trim()}`);
  }
  return target;
}
