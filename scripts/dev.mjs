import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = spawn(process.execPath, ["--experimental-strip-types", "server/index.ts"], {
  cwd: root,
  stdio: "inherit",
});
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
  cwd: root,
  stdio: "inherit",
});

function stop() {
  server.kill();
  vite.kill();
}

server.on("exit", (code) => {
  if (code) {
    vite.kill();
    process.exit(code);
  }
});
vite.on("exit", (code) => {
  server.kill();
  process.exit(code ?? 0);
});
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
