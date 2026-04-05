import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const requirementsPath = resolve("docs/requirements.txt");

const candidates =
  process.platform === "win32"
    ? [
        // Prefer the python launcher with Python 3.
        { cmd: "py", args: ["-3", "-m", "pip"] },
        { cmd: "py", args: ["-m", "pip"] },
        { cmd: "python", args: ["-m", "pip"] },
      ]
    : [
        { cmd: "python3", args: ["-m", "pip"] },
        { cmd: "python", args: ["-m", "pip"] },
      ];

for (const c of candidates) {
  const res = spawnSync(c.cmd, [...c.args, "install", "-r", requirementsPath], {
    stdio: "inherit",
  });
  if (res.status === 0) process.exit(0);
}

console.error(
  "Failed to install MkDocs deps. Install Python 3 + pip and run: pnpm run docs:install",
);
process.exit(1);

