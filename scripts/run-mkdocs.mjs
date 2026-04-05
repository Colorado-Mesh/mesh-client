import { spawnSync } from "node:child_process";

const mkdocsArgs = process.argv.slice(2);
if (mkdocsArgs.length === 0) {
  console.error("Usage: node scripts/run-mkdocs.mjs <mkdocs-args...>");
  process.exit(1);
}

const candidates =
  process.platform === "win32"
    ? [
        { cmd: "py", args: ["-3", "-m"] },
        { cmd: "py", args: ["-m"] },
        { cmd: "python", args: ["-m"] },
      ]
    : [
        { cmd: "python3", args: ["-m"] },
        { cmd: "python", args: ["-m"] },
      ];

// Try each Python launcher until `python* -m mkdocs ...` succeeds.
for (const c of candidates) {
  const res = spawnSync(c.cmd, [...c.args, "mkdocs", ...mkdocsArgs], {
    stdio: "inherit",
  });
  if (res.status === 0) process.exit(0);
}

process.exit(1);

