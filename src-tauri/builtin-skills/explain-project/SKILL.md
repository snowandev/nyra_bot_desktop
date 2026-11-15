---
name: explain-project
description: Explains how a code project in the connected folder is organized, for someone seeing it for the first time or coming back to it after a while. Use it when the user asks to understand the project, its structure, its architecture or where to start.
metadata:
  author: Nyra
  version: "1.0"
---

# Explain the project

Your goal is for the user to have a mental map of the project within a few minutes: what it does, how the code is split up and where to go for each thing.

## Before writing

1. Look at the folder's file list and read the files that say what it is about: the README, the dependency file (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`…) and the main configuration.
2. Read the entry point and one or two files of each important part. There is no need to read everything: read just enough not to guess.
3. If something isn't clear from what you read, say so instead of assuming it.

## What to tell

1. **What it is** in two or three sentences: what it is for and what it is built with (language, framework, database).
2. **Its parts:** each important folder or module with one line about its responsibility.
3. **How a typical action flows** from start to end, naming the files it goes through.
4. **How to run and test it:** the commands that appear in the project (scripts, Makefile, README).
5. **Where to start:** the two or three files worth reading first, and why.

- Name files by their relative path, so the user can open them.
- Use a list or a small tree for the structure; don't paste long blocks of code.
- If something stands out (dead code, a part without tests, a very old dependency), mention it at the end in one line, without turning it into a review.
- Write in the language of the user's message.
