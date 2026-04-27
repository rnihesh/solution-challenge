import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const [, , action, service] = process.argv;

const VALID_ACTIONS = new Set(["install", "dev", "start"]);
const VALID_SERVICES = new Set(["ml", "agent"]);
const isWindows = process.platform === "win32";

if (!VALID_ACTIONS.has(action) || !VALID_SERVICES.has(service)) {
  console.error(
    "Usage: node scripts/python-service.mjs <install|dev|start> <ml|agent>"
  );
  process.exit(1);
}

const serviceDir = path.join(repoRoot, service);
const venvDir = path.join(serviceDir, ".venv");
const venvPython = isWindows
  ? path.join(venvDir, "Scripts", "python.exe")
  : path.join(venvDir, "bin", "python");
const preferredPython = service === "ml" || isWindows ? "3.11" : null;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: options.cwd ?? repoRoot,
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

function resolvePythonLauncher() {
  if (isWindows) {
    const version = preferredPython ?? "3.11";
    return {
      command: "py",
      args: [`-${version}`],
      display: `py -${version}`,
    };
  }

  const candidates = preferredPython
    ? [
        { command: `python${preferredPython}`, args: [], display: `python${preferredPython}` },
        { command: "python3", args: [], display: "python3" },
        { command: "python", args: [], display: "python" },
      ]
    : [
        { command: "python3", args: [], display: "python3" },
        { command: "python", args: [], display: "python" },
      ];

  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.args, "--version"], {
      stdio: "ignore",
      shell: false,
    });

    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }

  console.error("Could not find a usable Python interpreter.");
  process.exit(1);
}

function installService() {
  const launcher = resolvePythonLauncher();

  console.log(`Creating ${service} virtualenv with ${launcher.display}...`);
  run(launcher.command, [...launcher.args, "-m", "venv", ".venv", "--clear"], {
    cwd: serviceDir,
  });

  if (!existsSync(venvPython)) {
    console.error(`Virtualenv python not found at ${venvPython}`);
    process.exit(1);
  }

  console.log(`Installing ${service} dependencies...`);
  run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"], {
    cwd: serviceDir,
  });
  run(venvPython, ["-m", "pip", "install", "-r", "requirements.txt"], {
    cwd: serviceDir,
  });
}

function runService(mode) {
  if (!existsSync(venvPython)) {
    console.error(
      `Missing virtualenv for ${service}. Run "npm run install:${service}" first.`
    );
    process.exit(1);
  }

  const args =
    mode === "dev"
      ? ["-m", "uvicorn", "main:app", "--reload", "--port", service === "ml" ? "8000" : "8001"]
      : [
          "-m",
          "uvicorn",
          "main:app",
          "--host",
          "0.0.0.0",
          "--port",
          service === "ml" ? "8000" : "8001",
        ];

  run(venvPython, args, { cwd: serviceDir });
}

if (action === "install") {
  installService();
} else {
  runService(action);
}
