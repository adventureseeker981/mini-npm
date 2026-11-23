# mnpm: Tiny npm Clone

mnpm is a lightweight Node.js package manager that demonstrates how npm-style dependency resolution works. It supports registry lookups, semver ranges, dependency hoisting, lockfiles, tarball integrity checks, and executable `.bin` links.

It is dependency-free, requires Node.js 18 or newer, and contains roughly 600 lines of JavaScript.

## Features

- Initialize projects with `package.json`
- Install and uninstall dependencies
- Resolve semver ranges and npm dist-tags
- Hoist compatible dependencies and nest conflicting versions
- Generate `mnpm-lock.json`
- Download and verify package tarballs
- Safely extract packages into `node_modules`
- Create executable links in `node_modules/.bin`
- Run package scripts
- Prune packages removed from `package.json`
- Support optional dependencies and platform/CPU filtering

## Installation

Clone the repository:

```bash
git clone https://github.com/adventureseeker981/mini-npm.git
cd mini-npm
```

Run mnpm directly:

```bash
node bin/mnpm.js
```

Optionally make it available globally:

```bash
npm link
```

After linking, replace `node bin/mnpm.js` with `mnpm` in the examples below.

## Quick Start

```bash
# Create package.json
node bin/mnpm.js init

# Install packages
node bin/mnpm.js install express lodash@4
node bin/mnpm.js install -D semver

# Display dependencies
node bin/mnpm.js ls
node bin/mnpm.js ls --all

# Run a package script
node bin/mnpm.js run test
```

## Commands

### `init`

Creates a basic `package.json` in the current directory.

```bash
mnpm init
```

The file includes a default package name, version, main entry point, test script, and license.

### `install`

Installs all dependencies declared in `package.json`.

```bash
mnpm install
```

To add one or more packages:

```bash
mnpm install express lodash@4
mnpm install semver@~7.6
```

### Development dependencies

Use `-D` or `--save-dev` to add dependencies to `devDependencies`.

```bash
mnpm install -D typescript
mnpm install --save-dev mocha
```

### `uninstall`

Removes one or more dependencies from `package.json`, then updates the installation.

```bash
mnpm uninstall lodash express
```

Aliases:

```bash
mnpm remove lodash
mnpm rm lodash
```

### `ls`

Lists the project's direct dependencies and whether they are currently installed.

```bash
mnpm ls
```

Use `--all` to show the complete dependency tree from the lockfile.

```bash
mnpm ls --all
```

### `run`

Runs a script from `package.json`.

```bash
mnpm run test
mnpm run build
```

Arguments are passed to the script:

```bash
mnpm run test --verbose
```

Shortcuts are available:

```bash
mnpm test
mnpm start
```

### Help and version

```bash
mnpm help
mnpm --help
mnpm --version
```

## Registry Configuration

mnpm uses the npm registry by default:

```text
https://registry.npmjs.org
```

Set `MNPM_REGISTRY` to use another compatible registry:

```bash
MNPM_REGISTRY=https://registry.example.com mnpm install express
```

Enable debug output for full stack traces:

```bash
MNPM_DEBUG=1 mnpm install express
```

## How It Works

The installation flow is:

```text
package.json
    │
    ▼
Dependency resolver
    │
    ▼
Flat package plan
    │
    ▼
Installer
    │
    ├── download tarballs
    ├── verify integrity
    ├── extract files
    ├── prune old packages
    └── create .bin links
```

### Registry Metadata

mnpm queries the registry using the package metadata API. Registry metadata contains:

- `dist-tags`, such as `latest`
- Available versions
- Tarball URLs
- Integrity hashes
- Package dependency declarations
- Executable information

### Semver Resolution

mnpm supports common npm-style semver ranges:

| Range | Meaning |
|---|---|
| `1.4.2` | Exact version |
| `^1.2.0` | Compatible version within major 1 |
| `~1.2.0` | Compatible patch range |
| `>=1.2.0` | Minimum version |
| `1.x` | Any 1.x version |
| `latest` | Registry `latest` dist-tag |

The `latest` dist-tag is preferred when it satisfies the requested range.

### Dependency Hoisting

mnpm uses a simplified npm-style hoisting strategy:

- Reuse a compatible dependency already reachable from the requesting package.
- Place a package at the top level if no conflicting copy exists.
- Nest a conflicting version under the package that requires it.

For example:

```text
node_modules/
├── express/
└── foo/
    └── node_modules/
        └── bar/
```

Nested placement mirrors Node.js module lookup, where `require()` searches the nearest `node_modules` directories before walking upward.

### Lockfile

Successful resolutions are stored in `mnpm-lock.json`.

The lockfile makes subsequent installs reproducible and allows mnpm to use the saved package plan when the dependency declarations have not changed.

When `package.json` changes, mnpm currently re-resolves the complete dependency tree.

### Integrity and Tarball Safety

Before extraction, mnpm verifies each tarball against the registry's `sha512` integrity value. A mismatch aborts the installation.

Tar extraction is also protected against path traversal. Entries that could escape the package directory are rejected.

Symlinks are skipped for safety.

### Executable Links

If a package declares a `bin` field, mnpm creates links in `node_modules/.bin`.

These links are available to package scripts because mnpm prepends `node_modules/.bin` to `PATH` when running scripts.

On systems where symlinks are unsupported or prohibited, executable linking may be skipped.

## Project Structure

| File | Purpose |
|---|---|
| `bin/mnpm.js` | CLI entry point |
| `src/cli.js` | Command parsing and package.json operations |
| `src/registry.js` | Registry metadata and tarball requests |
| `src/semver.js` | Semver range parsing and matching |
| `src/resolver.js` | Dependency tree resolution and hoisting |
| `src/installer.js` | Downloads, extraction, pruning, and `.bin` links |
| `src/lockfile.js` | Lockfile reading and writing |
| `src/tar.js` | Tarball unpacking |
| `test/` | Automated test suite |

## Running Tests

```bash
npm test
```

The test suite uses Node.js's built-in test runner:

```bash
node --test test/*.test.js
```

## Supported Package Specifications

mnpm supports:

- Exact versions
- Semver ranges
- npm dist-tags
- Scoped packages
- Optional dependencies
- OS and CPU restrictions

It does not support:

- Git and GitHub URLs
- `http:` or `https:` package URLs
- `file:` dependencies
- `link:` dependencies
- `workspace:` dependencies
- `npm:` aliases
- GitHub shorthand such as `owner/repository`
- Peer dependencies
- Lifecycle scripts
- A tarball cache
- Publishing packages
- Windows `.cmd` executable shims

## Known Limitations

- The lockfile is not yet incremental; dependency changes trigger a full resolution.
- Peer dependencies are ignored.
- No cache is maintained for downloaded tarballs.
- Git and local package specifications are rejected.
- Packages that require install scripts may not work.
- Windows executable shims are not yet generated.

## Suggested Experiments

- Install Express and inspect its dependency tree.
- Compare a hoisted package with a nested conflicting version.
- Inspect the contents of `mnpm-lock.json`.
- Modify a tarball integrity hash and observe the verification failure.
- Add support for a package cache.
- Add peer dependency handling.
- Implement `mnpm outdated` or `mnpm audit`.
- Add support for Verdaccio and `mnpm publish`.

## License

This project is licensed under the ISC license.
