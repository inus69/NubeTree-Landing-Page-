import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

var serverRoot = resolve(import.meta.dirname, "..");
var projectRoot = resolve(serverRoot, "..");
var action = process.argv[2];

try {
  process.loadEnvFile(resolve(projectRoot, ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

var connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  console.error("Set TEST_DATABASE_URL in the project-root .env before running this command.");
  process.exit(1);
}

var databaseUrl;
try {
  databaseUrl = new URL(connectionString);
} catch {
  console.error("TEST_DATABASE_URL must be a valid PostgreSQL connection URL.");
  process.exit(1);
}

var localHosts = ["localhost", "127.0.0.1", "[::1]", "::1"];
var databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ""));
if (!(["postgres:", "postgresql:"].includes(databaseUrl.protocol)) ||
    !localHosts.includes(databaseUrl.hostname) ||
    !/(^|[_-])test($|[_-])/i.test(databaseName)) {
  console.error("TEST_DATABASE_URL must target localhost and a database name containing a separate 'test' segment.");
  process.exit(1);
}

var args;
var environment = Object.assign({}, process.env, { DATABASE_URL: connectionString });
if (action === "test") {
  environment.RUN_POSTGRES_INTEGRATION = "1";
  args = ["--test", "test/booking-postgres.test.js"];
} else if (action === "migrate") {
  args = ["node_modules/prisma/build/index.js", "migrate", "deploy"];
} else {
  console.error("Usage: node scripts/test-database.js <test|migrate>");
  process.exit(2);
}

var result = spawnSync(process.execPath, args, {
  cwd: serverRoot,
  env: environment,
  stdio: "inherit"
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);