# mnpm: a tiny npm clone

A package manager in ~600 lines of dependency-free Node.js. It reads `package.json`,
resolves semver ranges against the real npm registry, downloads tarballs, verifies
their hashes, and unpacks them into `node_modules`.

```bash
node bin/mnpm.js init
node bin/mnpm.js install express lodash@4
node bin/mnpm.js install -D semver
node bin/mnpm.js ls --all
node bin/mnpm.js run test
npm link        # optional: makes the `mnpm` command available globally
```

Run the tests with `npm test`.

## How an install works

```
package.json ──► resolver ──► flat list of packages ──► installer ──► node_modules
                    │                  │                    │
              registry.js         mnpm-lock.json        tar.js (unpack)
              semver.js           (saves the plan)      integrity check
```

| File | Job | Concept it teaches |
|---|---|---|
| `src/semver.js` | Does `1.4.2` satisfy `^1.2.0`? | `^` is just sugar for `>=1.2.0 <2.0.0` |
| `src/registry.js` | Fetch package metadata and tarballs | The registry is a plain HTTP+JSON API |
| `src/resolver.js` | Walk the dependency tree and choose where each copy lives | Hoisting and version conflicts |
| `src/tar.js` | Unpack `.tgz` files by hand | tar = 512-byte headers + data; path-traversal safety |
| `src/installer.js` | Download, verify, extract, prune, link bins | Integrity hashes, concurrency |
| `src/lockfile.js` | Remember what was resolved | Reproducible installs |
| `src/cli.js` | Commands | Gluing it together |

## Suggested 3-hour plan (if you rebuild it yourself)

1. **0:00–0:25: Project and registry.** `npm init`, then fetch
   `https://registry.npmjs.org/lodash` and look at the JSON by hand. Find `dist-tags`,
   `versions`, and `versions[x].dist.tarball`.
2. **0:25–1:00: Semver.** Start with exact versions plus `^` and `~`, then add the rest.
   Write tests first, since the rules are full of edge cases (`^0.2.3`, prereleases).
3. **1:00–1:40: Tarballs.** Download a tarball, `gunzip` it, and parse the headers yourself.
   Strip the leading `package/` folder.
4. **1:40–2:20: Resolver and installer.** Install one package, then its dependencies, then
   handle conflicts by nesting.
5. **2:20–2:45: CLI, lockfile, `.bin` links.**
6. **2:45–3:00: Try it on `express`**, and write up what you learned.

## Design decisions worth discussing

- **Hoisting:** a dependency goes at the top level unless a conflicting version is
  already reachable, in which case it is nested under the package that needs it. This
  mirrors how Node's `require()` walks up through `node_modules` folders.
- **`latest` is preferred:** if the `latest` dist-tag satisfies the range, npm picks it
  even when a higher version exists. `pickVersion` mirrors this.
- **Integrity:** every tarball is hashed and compared to the registry's `sha512` before
  extraction. A mismatch aborts the install.
- **Tar safety:** entries that would escape the package folder throw, and symlinks are
  skipped. See `test/tar.test.js` for the "zip slip" test.
- **No install scripts:** real npm runs `postinstall` scripts, which is a major
  supply-chain risk. mnpm deliberately doesn't, so packages that need compiling won't work.

## Known limitations (good stretch goals)

- **Lockfile is all-or-nothing.** If `package.json` changes, everything is re-resolved
  instead of keeping already-locked versions where possible.
- **No peerDependencies.** They're ignored (npm 7+ installs them automatically).
- **Registry specs only.** Git URLs, `file:`, `npm:` aliases and workspaces are rejected
  with a clear error.
- **No cache.** Add `~/.mnpm-cache` keyed by integrity hash so repeat installs work offline.
- **Windows.** `.bin` symlinks are skipped if the OS refuses them (npm writes `.cmd` shims).
- **No `mnpm publish`.** A fun next step: `npm pack` equivalent, then `PUT` to a local
  [Verdaccio](https://verdaccio.org/) registry via `MNPM_REGISTRY`.
- **Other ideas:** `mnpm outdated`, `mnpm audit`, a progress bar, `--production`, scoped
  registry config via `.mnpmrc`.
