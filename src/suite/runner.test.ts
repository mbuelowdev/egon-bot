import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isScriptError, runScenarioSuite, scenarioUrl, summarizeConsoleErrors } from "./runner.js";
import type { SuiteSession } from "./runner.js";

function gameRepo(checks: Record<string, unknown[]>, scenarios: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "egon-runner-"));
  mkdirSync(join(dir, "egon", "checks"), { recursive: true });
  mkdirSync(join(dir, "egon", "scenarios"), { recursive: true });
  for (const [slug, entries] of Object.entries(checks)) {
    writeFileSync(join(dir, "egon", "checks", `${slug}.json`), JSON.stringify(entries));
  }
  for (const name of scenarios) {
    writeFileSync(join(dir, "egon", "scenarios", `${name}.gd`), "## A scenario.\n");
  }
  return dir;
}

function check(name: string, scenario = "default"): unknown {
  return {
    name,
    scenario,
    steps: [{ expect: "window.__egon.state().ready", equals: true }],
  };
}

type SessionOptions = {
  bridgeScenario?: string | null;
  registered?: string[];
  bridgePresent?: boolean;
  bootReady?: boolean;
  stateValue?: unknown;
  consoleErrors?: string[];
  visited?: string[];
  proofLog?: string[];
  startProofOk?: boolean;
};

function fakeSession(options: SessionOptions = {}): SuiteSession {
  return {
    goto: async (url) => {
      options.visited?.push(url);
    },
    evaluate: async <T>(source: string) => {
      if (source.includes("status-notice")) {
        return (options.bootReady === false
          ? { ready: false, failed: true, timedOut: false, reason: "status-notice", notice: "boom" }
          : { ready: true, failed: false, timedOut: false, reason: "ready" }) as T;
      }
      if (source.includes("bridge.scenario")) {
        return {
          present: options.bridgePresent !== false,
          scenario: options.bridgeScenario === undefined ? "default" : options.bridgeScenario,
          scenarios: options.registered ?? [],
        } as T;
      }
      const value = options.stateValue === undefined ? true : options.stateValue;
      return { value, first: value, changed: false, settled: true, samples: 1, ms: 1 } as T;
    },
    press: async () => {},
    click: async () => {},
    move: async () => {},
    drag: async () => {},
    screenshot: async (file) => {
      options.proofLog?.push(`shot:${file}`);
    },
    startProofVideo: async () => {
      options.proofLog?.push("start");
      return options.startProofOk !== false;
    },
    stopProofVideo: async (fileName) => {
      options.proofLog?.push(`stop:${fileName}`);
      return true;
    },
    wait: async (ms) => {
      options.proofLog?.push(`wait:${String(ms)}`);
    },
    consoleErrors: () => options.consoleErrors ?? [],
    close: async () => {},
  };
}

function screenshotsDir(): string {
  return join(mkdtempSync(join(tmpdir(), "egon-shots-")), "screenshots");
}

test("the default scenario loads the bare URL and a named one adds the parameter", () => {
  assert.equal(scenarioUrl(8080, "default"), "http://127.0.0.1:8080/");
  assert.equal(
    scenarioUrl(8080, "endgame_victory"),
    "http://127.0.0.1:8080/?egon_scenario=endgame_victory",
  );
});

test("console errors are deduped and SCRIPT ERROR lines identified", () => {
  assert.deepEqual(summarizeConsoleErrors(["a", "a", " a ", "b"]), ["a", "b"]);
  assert.equal(isScriptError("SCRIPT ERROR: nope"), true);
  assert.equal(isScriptError("favicon 404"), false);
});

test("a passing run reports every check on the branch", async () => {
  const dir = gameRepo({ dash: [check("dash works")], other: [check("other works")] });
  const result = await runScenarioSuite({
    gameRepoDir: dir,
    port: 8080,
    slug: "dash",
    screenshotsDir: screenshotsDir(),
    open: async () => fakeSession(),
  });
  assert.equal(result.results.length, 2);
  assert.ok(result.results.every((entry) => entry.ok));
  assert.equal(result.results.filter((entry) => entry.inherited).length, 1);
});

test("each check navigates to its own scenario URL", async () => {
  const visited: string[] = [];
  const dir = gameRepo(
    { dash: [check("boot check"), check("victory", "endgame_victory")] },
    ["endgame_victory"],
  );
  await runScenarioSuite({
    gameRepoDir: dir,
    port: 8080,
    slug: "dash",
    screenshotsDir: screenshotsDir(),
    open: async () =>
      fakeSession({ visited, bridgeScenario: "default", registered: ["endgame_victory"] }),
  });
  assert.deepEqual(visited, [
    "http://127.0.0.1:8080/",
    "http://127.0.0.1:8080/?egon_scenario=endgame_victory",
  ]);
});

test("a scenario that did not load fails the check instead of testing the wrong state", async () => {
  // A silent fall-through to the normal boot would let a typo pass against a state the
  // check was never written for.
  const dir = gameRepo({ dash: [check("victory", "endgame_victory")] }, ["endgame_victory"]);
  const result = await runScenarioSuite({
    gameRepoDir: dir,
    port: 8080,
    slug: "dash",
    screenshotsDir: screenshotsDir(),
    open: async () => fakeSession({ bridgeScenario: null, registered: ["other"] }),
  });
  assert.equal(result.results[0]?.ok, false);
  assert.match(result.results[0]?.failure ?? "", /did not load/);
  assert.match(result.results[0]?.failure ?? "", /registered: other/);
});

test("a build that never boots fails the check with the shell notice", async () => {
  const dir = gameRepo({ dash: [check("dash works")] });
  const result = await runScenarioSuite({
    gameRepoDir: dir,
    port: 8080,
    slug: "dash",
    screenshotsDir: screenshotsDir(),
    open: async () => fakeSession({ bootReady: false }),
  });
  assert.equal(result.results[0]?.ok, false);
  assert.match(result.results[0]?.failure ?? "", /game did not boot/);
  assert.match(result.results[0]?.failure ?? "", /boom/);
});

test("a missing bridge fails the check and names the hook", async () => {
  const dir = gameRepo({ dash: [check("dash works")] });
  const result = await runScenarioSuite({
    gameRepoDir: dir,
    port: 8080,
    slug: "dash",
    screenshotsDir: screenshotsDir(),
    open: async () => fakeSession({ bridgePresent: false }),
  });
  assert.equal(result.results[0]?.ok, false);
  assert.match(result.results[0]?.failure ?? "", /window\.__egon\.state is missing/);
});

test("SCRIPT ERROR from the page is collected even when the steps pass", async () => {
  const dir = gameRepo({ dash: [check("dash works")] });
  const result = await runScenarioSuite({
    gameRepoDir: dir,
    port: 8080,
    slug: "dash",
    screenshotsDir: screenshotsDir(),
    open: async () =>
      fakeSession({ consoleErrors: ["SCRIPT ERROR: Invalid access", "favicon 404"] }),
  });
  assert.equal(result.results[0]?.ok, true);
  assert.deepEqual(result.scriptErrors, ["SCRIPT ERROR: Invalid access"]);
});

test("a repo with no checks is a fatal suite result, not a silent pass", async () => {
  const dir = gameRepo({});
  const result = await runScenarioSuite({
    gameRepoDir: dir,
    port: 8080,
    slug: "dash",
    screenshotsDir: screenshotsDir(),
    open: async () => fakeSession(),
  });
  assert.equal(result.results.length, 0);
  assert.match(result.fatal ?? "", /no checks found/);
});

test("a session that throws fails only its own check", async () => {
  const dir = gameRepo({ dash: [check("one"), check("two")] });
  let opened = 0;
  const result = await runScenarioSuite({
    gameRepoDir: dir,
    port: 8080,
    slug: "dash",
    screenshotsDir: screenshotsDir(),
    open: async () => {
      opened += 1;
      if (opened === 1) {
        throw new Error("chromium exploded");
      }
      return fakeSession();
    },
  });
  assert.equal(result.results[0]?.ok, false);
  assert.match(result.results[0]?.failure ?? "", /chromium exploded/);
  assert.equal(result.results[1]?.ok, true);
});

test("a current-feature video check records a capped clip and a poster", async () => {
  const proofLog: string[] = [];
  const dir = gameRepo({
    dash: [
      {
        name: "dash motion",
        scenario: "default",
        proof: "video",
        steps: [{ expect: "window.__egon.state().ready", equals: true }],
      },
    ],
  });
  const result = await runScenarioSuite({
    gameRepoDir: dir,
    port: 8080,
    slug: "dash",
    screenshotsDir: screenshotsDir(),
    open: async () => fakeSession({ proofLog }),
  });
  assert.equal(result.results[0]?.ok, true);
  assert.deepEqual(proofLog, [
    "start",
    "wait:8000",
    "stop:criterion-1.webm",
    "shot:criterion-1.png",
  ]);
  assert.ok(result.results[0]?.screenshots.includes("criterion-1.webm"));
  assert.ok(result.results[0]?.screenshots.includes("criterion-1.png"));
});

test("inherited video checks stay stills", async () => {
  const proofLog: string[] = [];
  const dir = gameRepo({
    dash: [check("dash works")],
    older: [
      {
        name: "old dash",
        scenario: "default",
        proof: "video",
        steps: [{ expect: "window.__egon.state().ready", equals: true }],
      },
    ],
  });
  await runScenarioSuite({
    gameRepoDir: dir,
    port: 8080,
    slug: "dash",
    screenshotsDir: screenshotsDir(),
    open: async () => fakeSession({ proofLog }),
  });
  assert.deepEqual(
    proofLog.filter((line) => line === "start" || line.startsWith("stop:")),
    [],
  );
});
