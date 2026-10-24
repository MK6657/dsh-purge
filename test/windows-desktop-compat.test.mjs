import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ALL_PATCHES, atomicCopyFileSync } from "../lib/core.js";
import { repairOfficialCliAfterUnpack } from "../lib/desktop.js";
import { hostFs } from "../lib/extract-asar.js";
import { hostPromptKeepsInject } from "../lib/host-clean.js";

// Minimal launcher fixture: never executes Electron or touches a real DSH install.
const originalCmd = String.raw`@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\..\..\DeepSeek Harness.exe" --expose-internals "%~dp0..\..\..\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" %*
`.replace(/\n/g, "\r\n");

function tempDirectory(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "dsh-purge-test-"));
  t.after(() => {
    const resolved = fs.realpathSync(root);
    const relative = path.relative(parent, resolved);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    assert.match(path.basename(resolved), /^dsh-purge-test-/);
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return root;
}

function launcherFixture(t) {
  const root = tempDirectory(t);
  const exe = path.join(root, "DeepSeek Harness.exe");
  const shim = path.join(root, "resources", "runtime", "cli", "bin", "dsh.cmd");
  fs.mkdirSync(path.dirname(shim), { recursive: true });
  fs.mkdirSync(path.join(root, "resources", "app"), { recursive: true });
  fs.writeFileSync(exe, "");
  fs.writeFileSync(shim, originalCmd);
  return { exe, shim, backup: `${shim}.dsh-purge.bak` };
}

function shimReport(report, shim) {
  return report.shims.find((item) => item.path === shim);
}

test("atomicCopyFileSync completes the backup before returning", (t) => {
  const root = tempDirectory(t);
  const source = path.join(root, "source");
  const backup = path.join(root, "nested", "backup");
  fs.writeFileSync(source, "original launcher");
  atomicCopyFileSync(source, backup);
  assert.equal(fs.readFileSync(backup, "utf8"), "original launcher");
  assert.deepEqual(fs.readdirSync(path.dirname(backup)), ["backup"]);
});

test("atomicCopyFileSync throws synchronously and removes its temp on rename failure", (t) => {
  const root = tempDirectory(t);
  const source = path.join(root, "source");
  const backup = path.join(root, "backup");
  fs.writeFileSync(source, "original launcher");
  const rename = hostFs.renameSync;
  t.mock.method(hostFs, "renameSync", (from, to) => {
    if (to === backup) throw Object.assign(new Error("simulated rename failure"), { code: "EACCES" });
    return rename(from, to);
  });
  assert.throws(() => atomicCopyFileSync(source, backup), { code: "EACCES" });
  assert.deepEqual(fs.readdirSync(root), ["source"]);
});

test("CLI repair preserves the original backup and is repeatable", (t) => {
  const { exe, shim, backup } = launcherFixture(t);
  const first = repairOfficialCliAfterUnpack(exe);
  assert.equal(first.ok, true);
  assert.equal(shimReport(first, shim).status, "patched");
  assert.equal(fs.readFileSync(backup, "utf8"), originalCmd);
  const repaired = fs.readFileSync(shim, "utf8");
  assert.match(repaired, /app\.asar\.unpacked/);
  assert.match(repaired, /app\\dsh\\node_modules/);
  assert.equal(shimReport(repairOfficialCliAfterUnpack(exe), shim).status, "already");
  assert.equal(fs.readFileSync(shim, "utf8"), repaired);
  assert.equal(fs.readFileSync(backup, "utf8"), originalCmd);
});

test("a failed backup does not leave a rejected Promise after synchronous CLI repair", async (t) => {
  const { exe, shim, backup } = launcherFixture(t);
  fs.mkdirSync(backup);
  assert.equal(shimReport(repairOfficialCliAfterUnpack(exe), shim).status, "patched");
  await new Promise((resolve) => setImmediate(resolve));
  // node:test also fails if an unhandled rejection escapes the repair call.
  assert.ok(fs.statSync(backup).isDirectory());
  assert.ok(!fs.readdirSync(path.dirname(shim)).some((name) => name.endsWith(".copytmp")));
});

for (const code of ["EPERM", "EBUSY", "EACCES"]) {
  test(`Windows locked-launcher fallback handles ${code} with a backup`, {
    skip: process.platform !== "win32",
  }, (t) => {
    const { exe, shim, backup } = launcherFixture(t);
    const rename = hostFs.renameSync;
    t.mock.method(hostFs, "renameSync", (from, to) => {
      if (to === shim) throw Object.assign(new Error("simulated delete-sharing lock"), { code });
      return rename(from, to);
    });
    assert.equal(shimReport(repairOfficialCliAfterUnpack(exe), shim).status, "patched");
    assert.equal(fs.readFileSync(backup, "utf8"), originalCmd);
    assert.match(fs.readFileSync(shim, "utf8"), /REM dsh-purge cli entry begin/);
    assert.ok(!fs.readdirSync(path.dirname(shim)).some((name) => /\.(?:copytmp|tmp)$/.test(name)));
  });
}

test("locked-launcher fallback requires a successful backup", {
  skip: process.platform !== "win32",
}, (t) => {
  const { exe, shim, backup } = launcherFixture(t);
  fs.mkdirSync(backup);
  const rename = hostFs.renameSync;
  t.mock.method(hostFs, "renameSync", (from, to) => {
    if (to === shim) throw Object.assign(new Error("simulated lock"), { code: "EPERM" });
    return rename(from, to);
  });
  assert.equal(shimReport(repairOfficialCliAfterUnpack(exe), shim).status, "write_error");
  assert.equal(fs.readFileSync(shim, "utf8"), originalCmd);
});

test("unrelated launcher write failures do not use the in-place fallback", (t) => {
  const { exe, shim } = launcherFixture(t);
  const rename = hostFs.renameSync;
  t.mock.method(hostFs, "renameSync", (from, to) => {
    if (to === shim) throw Object.assign(new Error("simulated full disk"), { code: "ENOSPC" });
    return rename(from, to);
  });
  assert.equal(shimReport(repairOfficialCliAfterUnpack(exe), shim).status, "write_error");
  assert.equal(fs.readFileSync(shim, "utf8"), originalCmd);
});

test("locked-launcher fallback reports a readback mismatch", {
  skip: process.platform !== "win32",
}, (t) => {
  const { exe, shim } = launcherFixture(t);
  const rename = hostFs.renameSync;
  const write = hostFs.writeFileSync;
  t.mock.method(hostFs, "renameSync", (from, to) => {
    if (to === shim) throw Object.assign(new Error("simulated lock"), { code: "EPERM" });
    return rename(from, to);
  });
  t.mock.method(hostFs, "writeFileSync", (file, ...args) => {
    if (file === shim) return write(file, "simulated short write", "utf8");
    return write(file, ...args);
  });
  const result = shimReport(repairOfficialCliAfterUnpack(exe), shim);
  assert.equal(result.status, "write_error");
  assert.match(result.error, /readback mismatch/);
});

// Minimal structural fixture for the DSH 0.2.1-rc.3 assembly tail.
// No model requests, personal prompts, or complete host sources are needed.
const dsh021Tail = `
    const transformed = await this.ctx.waterfall(scopeTarget(this, scope), "system-prompt/assemble", assembly, context, () => Promise.resolve(assembly));
    if (completeSection === void 0 && !runtimeContextSuppressed) return transformed;
    const requiredContexts = new Set([...contextByName.values()].filter((entry) => entry.required === true).map((entry) => entry.name));
    return {
      ...transformed,
      sections: completeSection === void 0 ? transformed.sections : [completeSection],
      contexts: runtimeContextSuppressed ? transformed.contexts.filter((entry) => requiredContexts.has(entry.name)) : transformed.contexts
    };`;
const patch40 = ALL_PATCHES.find((item) => item.id === 40);
const compatRule = patch40.replacements.find((item) => item.pattern instanceof RegExp && item.pattern.test(dsh021Tail));

test("patch 40 matches the DSH 0.2.1 required-contexts layout", () => {
  assert.ok(compatRule, "0.2.1 assembly must match a replacement");
  const after = dsh021Tail.replace(compatRule.pattern, compatRule.replace);
  assert.equal(hostPromptKeepsInject(dsh021Tail), false);
  assert.equal(hostPromptKeepsInject(after), true);
  assert.match(after, /const requiredContexts = new Set/);
  assert.doesNotMatch(after, /: \[completeSection\]/);
});

for (const complete of [false, true]) {
  for (const suppressed of [false, true]) {
    test(`0.2.1 assembly retains sections/tools and required contexts (complete=${complete}, suppressed=${suppressed})`, async () => {
      assert.ok(compatRule);
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const assemble = new AsyncFunction("scopeTarget", "scope", "assembly", "context", "completeSection", "runtimeContextSuppressed", "contextByName", compatRule.replace);
      const transformed = {
        sections: [
          { name: "persona", text: "transformed persona" },
          { name: "dsh-purge:inject", text: "fixture injection" },
          { name: "agent-instructions", text: "fixture workspace instructions" },
        ],
        contexts: [{ name: "required" }, { name: "optional" }],
        tools: ["fixture-tool"],
      };
      const contextByName = new Map([
        ["required", { name: "required", required: true }],
        ["optional", { name: "optional" }],
      ]);
      const receiver = { ctx: { waterfall: async () => structuredClone(transformed) } };
      const result = await assemble.call(receiver, (value) => value, {}, {}, {},
        complete ? { name: "persona", text: "original persona" } : undefined,
        suppressed, contextByName);
      assert.deepEqual(result.sections.map((item) => item.name), ["dsh-purge:inject", "persona", "agent-instructions"]);
      assert.equal(result.sections.find((item) => item.name === "persona").text, "transformed persona");
      assert.deepEqual(result.contexts.map((item) => item.name), suppressed ? ["required"] : ["required", "optional"]);
      assert.deepEqual(result.tools, transformed.tools);
    });
  }
}

test("the older assembly replacement remains available", () => {
  const before = dsh021Tail
    .replace(/^.*const requiredContexts = new Set.*\n/m, "")
    .replace("transformed.contexts.filter((entry) => requiredContexts.has(entry.name))", "[]");
  const rule = patch40.replacements.find((item) => item.pattern instanceof RegExp && item.pattern.test(before));
  assert.ok(rule);
  assert.equal(hostPromptKeepsInject(before.replace(rule.pattern, rule.replace)), true);
});

test("host validation recognizes folded markers and rejects unfinished prompt layouts", () => {
  assert.equal(hostPromptKeepsInject(""), false);
  assert.equal(hostPromptKeepsInject("unrelated module"), false);
  assert.equal(hostPromptKeepsInject('"system-prompt/assemble"; sections: enabled ? sections : [completeSection]'), false);
  assert.equal(hostPromptKeepsInject('"system-prompt/assemble"; You are an AI agent powered by DeepSeek Harness.'), false);
  assert.equal(hostPromptKeepsInject("// [dsh-purge] identity stripped\n// [dsh-purge] fold-complete inject first"), true);
});
