---
name: document-code
description: Writes or improves the documentation of the code in the connected folder, such as the README, function comments or usage guides, in the project's style. Use it when the user asks to document, explain in a README or add comments to the code.
metadata:
  author: Nyra
  version: "1.0"
---

# Document

Write documentation that answers what the reader needs at that moment, based on what the code really does.

## Before writing

1. Ask what to document if the user didn't say: the whole project, a module, a function or an API.
2. Read the code and the existing documentation, so as not to contradict it and to follow its style, language and format.
3. Check commands and names in the project's files; don't invent options or steps.

## By kind

- **README:** what it is, how to install it, how to use it with a minimal example, how to develop and test. Short and in that order.
- **Functions and modules:** what they do, what they take, what they return and what errors they give, in the language's comment format (JSDoc, docstrings, `///`…). Explain the why when it isn't obvious; don't repeat what the code already says.
- **Guides:** numbered steps, with the commands in code blocks.

## When proposing it

- Propose the changes in the files for the user to review.
- Write the documentation in the language of the existing documentation; if there is none, in the language of the user's message. Write your explanations to the user in the language of their message.
