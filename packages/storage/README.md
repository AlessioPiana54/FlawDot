# @flawdot/storage

Where FlawDot keeps what it has to remember: projects, runs, findings, the "ignore" states, the settings, the API key and the
files of a run. It implements the ports of `@flawdot/core-model` (`ProjectRepository`, `RunRepository`, `FindingRepository`,
`SettingsRepository`, `SecretStore`, `ArtifactStore`). It is a private workspace package, and it depends on core-model and
nothing else of FlawDot.

**Today it has the adapters that need no database**: the repositories and the secret store in memory, and the artifact store
on a folder. SQLite (`node:sqlite`) comes with Task 23, the key in the system keyring with Task 24. They must pass the same
contract suites, so what is written here is what they have to do.

## What is in it

| Export                               | What it is                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `createInMemoryStorage({ clock })`   | `projects`, `runs`, `findings` and `settings`, all in the memory of the process. Each call is a store of its own. |
| `createInMemorySecretStore()`        | The API key in a variable of a closure: nothing a log, a dump or `JSON.stringify` could print.                    |
| `createDirectoryArtifactStore(root)` | The paths of the files of a run and of a login session, on the disk (it makes the folders).                       |
| `projectFromOrigin(origin)`          | The canonical origin and the id of a project, shared with the SQLite adapter.                                     |

## The rules that every adapter follows

- **A failure is a rejected promise**, never an exception thrown before the promise exists, and it is a `FlawDotError` with
  the code `INVALID_INPUT` (a missing run is `Run not found`; there is no `NOT_FOUND` code).
- **Data that comes in is checked with the schemas of core-model**, and what goes out is a copy: nobody who holds a result
  can change the store.
- **A project is a site.** Its id is the host name, with `-<port>` when the port is not the default one of the scheme
  (`localhost-3000`, `example.com-8443`), so `http` and `https` of one host are one project. A run is saved again only to
  change its status: it never moves to another project.
- **The order is the order of the ids** (ULIDs, which sort by creation time): runs newest first, findings by id, projects by
  the time they were created and then by id.
- **"Ignore" belongs to a project and a fingerprint.** Opening a fingerprint again removes its entry, so `states()` lists only
  the ignored ones.
- **Settings are replaced field by field**, never merged inside a field, and a patch that would make them invalid changes
  nothing.
- **The key never leaves the store**: it is not in an error, in `JSON.stringify` or in `util.inspect`. It is kept exactly as it
  was given, up to 1024 characters.

## The files

```
<root>/runs/<runId>/<name>.png                 screenshot
<root>/runs/<runId>/<name>.marked.png          with the numbers of the set-of-marks (input of the AI)
<root>/runs/<runId>/<name>.annotated.png       with the circles
<root>/runs/<runId>/<name>.tile.png            a tile of a long page ("<name>__t3")
<root>/runs/<runId>/exports/<name>             an export; its name carries the extension ("report.pdf")
<root>/sessions/project-<projectId>/storage-state.json   the login session (cookies: folder 0700 where the system has modes)
```

`pathFor` makes the folder, so whoever writes the file does not have to. A name may have letters, digits, `_`, `-`, `@` and
dots in the middle, up to 150 characters. Nothing else gets through: no separator, no `:` (a stream on Windows), no `..`, no
dot at the end, no name that Windows reads as a device (`NUL`, `CON.txt`), and no name that ends in `.marked`, `.annotated` or
`.tile` (it would be the file of another kind). The error says the rule and never repeats the name. The `project-` prefix keeps
a site such as `con` or `aux.com` from being a device. The layout is not the one of the first spec (`projects/<id>/runs/...`),
because `pathFor` is given a run id and does not know the project.

## Working on it

`pnpm --filter @flawdot/storage test` runs the contract suites on these adapters and the tests of the layout; no browser is
needed. `src/` may import only core-model (rule A1 of `.oxlintrc.json`); the suites of `@flawdot/test-support` are for tests.

## Known limits

- Two sites whose ids are written the same cannot be told apart: `http://localhost:3000` and a host called `localhost-3000`
  are one project, because a project id has no other separator.
- A host with an underscore (`my_app:3000`) is refused, because a project id does not allow `_`.
- File names are case-sensitive here, and Windows and macOS are not: `Report.pdf` and `report.pdf` are one file there.
- There is no transaction yet (`transaction(fn)` of the first spec): the kernel saves a run and its findings with two calls.
  It comes with SQLite, where it is needed.
