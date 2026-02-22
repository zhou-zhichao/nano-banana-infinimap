const path = require("node:path");
const { spawnSync } = require("node:child_process");

const tests = [
  "lib/batch/plan.test.ts",
  "lib/batch/executor.test.ts",
];

const tsNodeBin = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "ts-node.cmd" : "ts-node",
);

const env = {
  ...process.env,
  TS_NODE_COMPILER_OPTIONS: JSON.stringify({
    module: "commonjs",
    moduleResolution: "node",
  }),
};

for (const testFile of tests) {
  const command = process.platform === "win32" ? `"${tsNodeBin}"` : tsNodeBin;
  const result = spawnSync(command, [testFile], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

process.exit(0);
