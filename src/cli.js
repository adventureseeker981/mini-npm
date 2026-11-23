"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { getPackument, pickVersion } = require("./registry");
const { isValidRange } = require("./semver");
const { resolveTree } = require("./resolver");
const { installEntries } = require("./installer");
const lockfile = require("./lockfile");

const GROUPS = ["dependencies", "devDependencies", "optionalDependencies"];

//package.json helpers

function readPkg(cwd) {
  const file = path.join(cwd, "package.json");
  if (!fs.existsSync(file))
    throw new Error('no package.json found. Run "mnpm init" first.');
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writePkg(cwd, pkg) {
  fs.writeFileSync(
    path.join(cwd, "package.json"),
    JSON.stringify(pkg, null, 2) + "\n",
  );
}

const sortKeys = (obj) =>
  Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)),
  );

function rootDeps(pkg) {
  // dependencies win over devDependencies if a name appears in both
  return sortKeys({
    ...pkg.optionalDependencies,
    ...pkg.devDependencies,
    ...pkg.dependencies,
  });
}

// "lodash@4" -> { name: "lodash", range: "4" }, "@scope/pkg@^1" -> { name: "@scope/pkg", range: "^1" }
function parseSpec(spec) {
  const at = spec.lastIndexOf("@");
  return at > 0
    ? { name: spec.slice(0, at), range: spec.slice(at + 1) }
    : { name: spec, range: "" };
}

// ---------- commands ----------

function cmdInit(cwd) {
  if (fs.existsSync(path.join(cwd, "package.json")))
    throw new Error("package.json already exists");
  const pkg = {
    name: path
      .basename(cwd)
      .toLowerCase()
      .replace(/[^a-z0-9-_.]+/g, "-"),
    version: "1.0.0",
    description: "",
    main: "index.js",
    scripts: { test: 'echo "Error: no test specified" && exit 1' },
    license: "ISC",
  };
  writePkg(cwd, pkg);
  console.log(`Created package.json for "${pkg.name}"`);
}

async function installProject(cwd, pkg) {
  const started = Date.now();
  const deps = rootDeps(pkg);
  const lock = lockfile.read(cwd);

  let entries;
  if (lock && lockfile.isFresh(lock, deps)) {
    console.log("Using mnpm-lock.json");
    entries = lockfile.toEntries(lock);
  } else {
    console.log("Resolving dependencies...");
    entries = await resolveTree(deps);
    lockfile.write(cwd, deps, entries);
  }

  console.log(`Installing ${entries.length} package(s)...`);
  const { installed, skipped } = await installEntries(cwd, entries, {
    log: (line) => console.log(`  ${line}`),
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\nDone in ${secs}s: ${installed} installed, ${skipped} already up to date.`,
  );
}

async function cmdInstall(cwd, args) {
  const dev = args.includes("-D") || args.includes("--save-dev");
  const specs = args.filter((a) => !a.startsWith("-"));
  const pkg = readPkg(cwd);

  for (const spec of specs) {
    const { name, range } = parseSpec(spec);
    const version = pickVersion(await getPackument(name), range);
    // Keep an explicit range the user typed; otherwise save a caret range like npm does.
    const saved = range && isValidRange(range) ? range : `^${version}`;
    const group = dev ? "devDependencies" : "dependencies";
    for (const g of GROUPS) if (pkg[g]) delete pkg[g][name];
    pkg[group] = sortKeys({ ...pkg[group], [name]: saved });
    console.log(`Adding ${name}@${saved} to ${group}`);
  }

  if (specs.length) writePkg(cwd, pkg);
  await installProject(cwd, pkg);
}

async function cmdUninstall(cwd, names) {
  if (!names.length) throw new Error("usage: mnpm uninstall <package...>");
  const pkg = readPkg(cwd);
  for (const name of names) {
    let found = false;
    for (const g of GROUPS) {
      if (pkg[g] && name in pkg[g]) {
        delete pkg[g][name];
        found = true;
      }
    }
    if (!found) console.warn(`warning: "${name}" is not a dependency`);
  }
  writePkg(cwd, pkg);
  await installProject(cwd, pkg);
}

function cmdLs(cwd, args) {
  const pkg = readPkg(cwd);
  if (args.includes("--all")) {
    const lock = lockfile.read(cwd);
    if (!lock)
      throw new Error('no mnpm-lock.json yet. Run "mnpm install" first.');
    for (const e of lockfile
      .toEntries(lock)
      .sort((a, b) => (a.location < b.location ? -1 : 1))) {
      const depth = e.location.split("/node_modules/").length - 1;
      console.log(`${"  ".repeat(depth)}${e.name}@${e.version}`);
    }
    return;
  }
  console.log(`${pkg.name}@${pkg.version}`);
  for (const [name, range] of Object.entries(rootDeps(pkg))) {
    let version = "MISSING";
    try {
      version = JSON.parse(
        fs.readFileSync(
          path.join(cwd, "node_modules", name, "package.json"),
          "utf8",
        ),
      ).version;
    } catch {}
    console.log(`  ${name}@${version}  (wanted ${range})`);
  }
}

function cmdRun(cwd, name, extra = []) {
  const pkg = readPkg(cwd);
  if (!name) {
    console.log("Available scripts:");
    for (const [k, v] of Object.entries(pkg.scripts || {}))
      console.log(`  ${k}: ${v}`);
    return;
  }
  const script = pkg.scripts?.[name];
  if (!script) throw new Error(`missing script: "${name}"`);
  const env = {
    ...process.env,
    PATH: [path.join(cwd, "node_modules", ".bin"), process.env.PATH].join(
      path.delimiter,
    ),
  };
  return new Promise((resolve) => {
    const child = spawn([script, extra.map(item => `"${item}"`)].join(" "), {
      cwd,
      env,
      shell: true,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      process.exitCode = code ?? 1;
      resolve();
    });
    child.on("error", (err) => {
      console.log(`Failed to start script: ${err.message}`);
      process.exitCode = 1;
      resolve();
    });
  });
}

function help() {
  console.log(`mnpm - a tiny npm clone

Usage:
  mnpm init                          create a package.json
  mnpm install                       install everything in package.json
  mnpm install <pkg[@range]...> [-D] add packages (-D = devDependencies)
  mnpm uninstall <pkg...>            remove packages
  mnpm ls [--all]                    show installed packages
  mnpm run <script> [args]           run a package.json script
  mnpm test | mnpm start             shortcuts for "run test" / "run start"

Env: MNPM_REGISTRY (default https://registry.npmjs.org), MNPM_DEBUG=1 for stack traces`);
}

async function main(argv) {
  const [cmd, ...args] = argv;
  const cwd = process.cwd();
  try {
    switch (cmd) {
      case "init":
        return cmdInit(cwd);
      case "install":
      case "i":
        return await cmdInstall(cwd, args);
      case "uninstall":
      case "remove":
      case "rm":
        return await cmdUninstall(cwd, args);
      case "ls":
      case "list":
        return cmdLs(cwd, args);
      case "run":
        return await cmdRun(cwd, args[0], args.slice(1));
      case "test":
      case "start":
        return await cmdRun(cwd, cmd, args);
      case "-v":
      case "--version":
        return console.log(require("../package.json").version);
      case undefined:
      case "help":
      case "-h":
      case "--help":
        return help();
      default:
        throw new Error(`unknown command "${cmd}". Run "mnpm help".`);
    }
  } catch (err) {
    console.error(`mnpm error: ${err.message}`);
    if (process.env.MNPM_DEBUG) {
      console.error(err.stack);
    }
    process.exitCode = 1;
  }
}

module.exports = { main };
