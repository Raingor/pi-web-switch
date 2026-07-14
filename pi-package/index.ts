import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PI_SWITCH_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let serverProcess: ReturnType<typeof spawn> | null = null;

function getPackageManager(): "npm" | "pnpm" | "yarn" {
  if (existsSync(join(PI_SWITCH_DIR, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(PI_SWITCH_DIR, "yarn.lock"))) return "yarn";
  return "npm";
}

export default function (api: ExtensionAPI, ctx: ExtensionContext) {
  // Register a command to start/stop the web UI
  api.registerCommand({
    name: "pi-switch",
    description: "Start or stop the pi-web-switch dashboard",
    params: Type.Object({
      action: Type.Enum({ start: "start", stop: "stop", status: "status" }),
      port: Type.Optional(Type.Number({ default: 5173 })),
    }),
    execute: async (params) => {
      const { action, port = 5173 } = params;

      if (action === "status") {
        if (serverProcess && !serverProcess.killed) {
          return ctx.say(
            <Box borderStyle="round" borderColor="green" paddingLeft={1} paddingRight={1}>
              <Text>pi-web-switch is running at http://localhost:{port}</Text>
            </Box>
          );
        } else {
          serverProcess = null;
          return ctx.say(
            <Box borderStyle="round" borderColor="yellow" paddingLeft={1} paddingRight={1}>
              <Text>pi-web-switch is not running.</Text>
              <Text>Use `/pi-web-switch start` to launch the dashboard.</Text>
            </Box>
          );
        }
      }

      if (action === "stop") {
        if (serverProcess && !serverProcess.killed) {
          serverProcess.kill();
          serverProcess = null;
          return ctx.say(
            <Box borderStyle="round" borderColor="green" paddingLeft={1} paddingRight={1}>
              <Text>pi-web-switch stopped.</Text>
            </Box>
          );
        }
        return ctx.say(
          <Box borderStyle="round" borderColor="yellow" paddingLeft={1} paddingRight={1}>
            <Text>pi-web-switch is not running.</Text>
          </Box>
        );
      }

      if (action === "start") {
        if (serverProcess && !serverProcess.killed) {
          return ctx.say(
            <Box borderStyle="round" borderColor="yellow" paddingLeft={1} paddingRight={1}>
              <Text>pi-web-switch is already running at http://localhost:{port}</Text>
            </Box>
          );
        }

        const pm = getPackageManager();
        const cmd = pm === "npm" ? "npx" : pm;

        serverProcess = spawn(cmd, ["vite", "--host", "--port", String(port)], {
          cwd: PI_SWITCH_DIR,
          stdio: "ignore",
          detached: true,
        });

        serverProcess.unref();

        // Wait a moment then check
        await new Promise((r) => setTimeout(r, 2000));

        return ctx.say(
          <Box borderStyle="round" borderColor="green" paddingLeft={1} paddingRight={1}>
            <Text>pi-web-switch started!</Text>
            <Text>Dashboard: http://localhost:{port}</Text>
            <Text>Use `/pi-web-switch stop` to stop the server.</Text>
          </Box>
        );
      }
    },
  });
}
