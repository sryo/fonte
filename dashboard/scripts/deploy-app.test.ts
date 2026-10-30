import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deployDashboardApp, dashboardAppDir } from "./deploy-app.mjs";

function listTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      out.push(path.relative(root, full));
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return out.sort();
}

describe("dashboardAppDir", () => {
  it("uses FONTE_HOME when it is set", () => {
    expect(dashboardAppDir({ FONTE_HOME: "/tmp/fonte-dev", HOME: "/Users/someone" })).toBe(
      "/tmp/fonte-dev/dashboard-app",
    );
  });

  it("falls back to ~/.fonte/dashboard-app when FONTE_HOME is unset or empty", () => {
    expect(dashboardAppDir({ HOME: "/Users/someone" })).toBe("/Users/someone/.fonte/dashboard-app");
    expect(dashboardAppDir({ FONTE_HOME: "", HOME: "/Users/someone" })).toBe(
      "/Users/someone/.fonte/dashboard-app",
    );
    expect(dashboardAppDir({})).toBe(path.join(os.homedir(), ".fonte", "dashboard-app"));
  });
});

describe("deployDashboardApp", () => {
  let root: string;
  let source: string;
  let fonteHome: string;
  let decoyHome: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fonte-deploy-app-"));
    source = path.join(root, "dashboard");
    fonteHome = path.join(root, "fonte-home");
    decoyHome = path.join(root, "user-home");
    fs.mkdirSync(path.join(source, "public", "icons"), { recursive: true });
    fs.mkdirSync(path.join(source, "src"), { recursive: true });
    fs.mkdirSync(decoyHome);
    fs.writeFileSync(path.join(source, "package.json"), '{"name":"fonte-ui"}');
    fs.writeFileSync(path.join(source, "next.config.ts"), "export default {};");
    fs.writeFileSync(path.join(source, "tsconfig.json"), "{}");
    fs.writeFileSync(path.join(source, "src", "page.tsx"), "x");
    fs.writeFileSync(path.join(source, "public", "logo.svg"), "<svg/>");
    fs.writeFileSync(path.join(source, "public", "icons", "a.png"), "png");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("copies the runtime files and public/ into FONTE_HOME and nowhere else", () => {
    const sourceBefore = listTree(source);

    const target = deployDashboardApp({ sourceDir: source, env: { FONTE_HOME: fonteHome, HOME: decoyHome } });

    expect(target).toBe(path.join(fonteHome, "dashboard-app"));
    expect(listTree(fonteHome)).toEqual([
      "dashboard-app",
      "dashboard-app/next.config.ts",
      "dashboard-app/package.json",
      "dashboard-app/public",
      "dashboard-app/public/icons",
      "dashboard-app/public/icons/a.png",
      "dashboard-app/public/logo.svg",
      "dashboard-app/tsconfig.json",
    ]);
    expect(fs.readFileSync(path.join(fonteHome, "dashboard-app", "package.json"), "utf8")).toBe('{"name":"fonte-ui"}');
    expect(listTree(source)).toEqual(sourceBefore);
    expect(listTree(decoyHome)).toEqual([]);
    expect(fs.readdirSync(root).sort()).toEqual(["dashboard", "fonte-home", "user-home"]);
  });

  it("mirrors public/ and leaves the .next and node_modules links in place", () => {
    const app = path.join(fonteHome, "dashboard-app");
    const nextOut = path.join(fonteHome, "dashboard-next");
    const modules = path.join(fonteHome, "dashboard-node-modules");
    fs.mkdirSync(path.join(app, "public"), { recursive: true });
    fs.mkdirSync(nextOut);
    fs.mkdirSync(modules);
    fs.writeFileSync(path.join(nextOut, "BUILD_ID"), "abc");
    fs.symlinkSync(nextOut, path.join(app, ".next"));
    fs.symlinkSync(modules, path.join(app, "node_modules"));
    fs.writeFileSync(path.join(app, "public", "stale.svg"), "old");
    fs.writeFileSync(path.join(app, "package.json"), "old");

    deployDashboardApp({ sourceDir: source, env: { FONTE_HOME: fonteHome, HOME: decoyHome } });

    expect(fs.existsSync(path.join(app, "public", "stale.svg"))).toBe(false);
    expect(fs.readFileSync(path.join(app, "public", "logo.svg"), "utf8")).toBe("<svg/>");
    expect(fs.readFileSync(path.join(app, "package.json"), "utf8")).toBe('{"name":"fonte-ui"}');
    expect(fs.readlinkSync(path.join(app, ".next"))).toBe(nextOut);
    expect(fs.readlinkSync(path.join(app, "node_modules"))).toBe(modules);
    expect(fs.readFileSync(path.join(nextOut, "BUILD_ID"), "utf8")).toBe("abc");
  });

  it("writes nothing when FONTE_SKIP_DEPLOY=1", () => {
    const target = deployDashboardApp({
      sourceDir: source,
      env: { FONTE_HOME: fonteHome, HOME: decoyHome, FONTE_SKIP_DEPLOY: "1" },
    });

    expect(target).toBeNull();
    expect(fs.existsSync(fonteHome)).toBe(false);
    expect(listTree(decoyHome)).toEqual([]);
  });

  it("fails when a runtime file is missing from the build", () => {
    fs.rmSync(path.join(source, "tsconfig.json"));

    expect(() =>
      deployDashboardApp({ sourceDir: source, env: { FONTE_HOME: fonteHome, HOME: decoyHome } }),
    ).toThrow(/tsconfig\.json/);
  });
});
