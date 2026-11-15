---
name: update-dependencies
description: Reviews the dependencies of the project in the connected folder and recommends which to update, with their risks and in what order. Use it when the user asks about outdated dependencies, vulnerabilities or how to update libraries.
metadata:
  author: Nyra
  version: "1.0"
---

# Update dependencies

Help update safely: the urgent first, then the easy, and last what can break things.

## Find out the state

1. Read the dependency file and the lock file (`package.json` and its lockfile, `Cargo.toml`, `requirements.txt`, `pyproject.toml`, `go.mod`…).
2. Ask to run the ecosystem's tool that lists what is outdated and vulnerable: for example `npm outdated` and `npm audit`, `cargo outdated` or `cargo audit` if installed, `pip list --outdated`. If a tool isn't installed, say so instead of guessing.
3. Don't invent versions or vulnerabilities: use only what those tools or the files show.

## What to recommend

Group them in a table or a list:

1. **Urgent:** high or critical vulnerabilities, with the version that fixes them.
2. **Safe:** patches and minor versions.
3. **Careful:** major versions; say what usually changes and which parts of the project use them.

- For each group, give the command to update it.
- Recommend running the tests and the build after each group, not only at the end.
- Don't change files or run the update without the user's approval.
- Write in the language of the user's message.
