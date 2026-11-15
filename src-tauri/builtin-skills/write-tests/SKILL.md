---
name: write-tests
description: Writes tests for code in the connected folder, following the tools and style the project already uses. Use it when the user asks for tests, coverage or to check that something works.
metadata:
  author: Nyra
  version: "1.0"
---

# Write tests

Write tests that protect the behavior that matters and that fit the project as if its own team had written them.

## Before writing

1. Find out how the project tests: look for existing tests, the tool (Vitest, Jest, pytest, `cargo test`, Go…) and how they run (scripts in the dependency file).
2. Read the code to test and the nearby tests, to copy their structure, names and helpers.
3. If the user didn't say what to test, ask in one sentence instead of choosing yourself.

## What to test

- The expected behavior with normal data.
- The edges: empty, one, many, limits, invalid values.
- The errors: what happens when something fails and the message given.
- A bug the user mentioned, with a test that would fail without the fix.

## How to write them

- One behavior per test, with a name that says what is checked.
- Made-up, neutral data, never anyone's real data.
- Not depending on order, the current time or the network, unless the project already does.
- Propose the tests as new files or changes to existing ones, in the folder where the project keeps them.
- Then ask to run only those tests and, if they fail, explain why and fix the test or point out the bug in the code.
- Write your explanations in the language of the user's message.
