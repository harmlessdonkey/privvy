import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { LocalAuthProvider } from "../auth/local.js";
import { UserStore } from "../auth/users.js";
import { ConfigStore } from "../core/config.js";
import { Registry } from "../core/registry.js";
import { Runner } from "../core/runner.js";
import { trackingVsConsent } from "../plugins/tracking-vs-consent/index.js";
import { buildApp } from "./app.js";

async function sessionSecret(dataDir: string): Promise<string> {
  if (process.env["PRIVVY_SESSION_SECRET"]) return process.env["PRIVVY_SESSION_SECRET"];
  const file = join(dataDir, "config", ".session-key");
  try {
    return (await readFile(file, "utf8")).trim();
  } catch {
    const key = randomBytes(32).toString("hex");
    await mkdir(join(dataDir, "config"), { recursive: true });
    await writeFile(file, key + "\n", { mode: 0o600 });
    return key;
  }
}

const dataDir = resolve(process.env["PRIVVY_DATA_DIR"] ?? "./data");
await mkdir(dataDir, { recursive: true });

const users = new UserStore(dataDir);
await users.load();
const adminPassword = process.env["PRIVVY_ADMIN_PASSWORD"];
if (users.count === 0 && adminPassword) {
  const name = process.env["PRIVVY_ADMIN_USERNAME"] || "admin";
  await users.create(name, adminPassword);
  console.log(`Created first admin "${name}". Remove PRIVVY_ADMIN_PASSWORD from your environment now.`);
} else if (users.count === 0) {
  console.warn("No users exist. Login is disabled until PRIVVY_ADMIN_PASSWORD is set (12+ characters) and the server restarts.");
} else if (adminPassword) {
  console.warn("PRIVVY_ADMIN_PASSWORD is set but users already exist, so it is ignored. Remove it from your environment.");
}

// Add new plugins here.
const registry = new Registry([trackingVsConsent]);
const configs = new ConfigStore(dataDir);
const runner = new Runner(dataDir, registry, configs);

const app = await buildApp({
  dataDir,
  registry,
  configs,
  runner,
  auth: new LocalAuthProvider(users),
  sessionSecret: await sessionSecret(dataDir),
  cookieSecure: process.env["PRIVVY_COOKIE_SECURE"] === "true",
  setupNeeded: () => users.count === 0,
  logger: true,
});

// Localhost by default. The Docker image sets HOST=0.0.0.0 and compose publishes the port on 127.0.0.1 only.
await app.listen({ host: process.env["HOST"] ?? "127.0.0.1", port: Number(process.env["PORT"] ?? 3000) });
