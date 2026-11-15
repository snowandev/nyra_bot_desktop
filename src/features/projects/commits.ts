// A commit the model proposes in a reply: the app shows it as a card where the user edits the message, chooses the
// files and makes the commit. The model never commits nor pushes by itself.

const COMMIT = /<nyra-commit>([\s\S]*?)<\/nyra-commit>/g;
// Still being written: from the opening tag (or its first characters) to the end
const OPEN_COMMIT = /<nyra-commit>[\s\S]*$|<(?:n(?:y(?:r(?:a(?:-(?:c(?:o(?:m(?:m(?:i(?:t)?)?)?)?)?)?)?)?)?)?)?$/;

export const COMMIT_PROMPT = [
  "When the user asks you to prepare a commit, first look at the changes (run git status and git diff, as you would " +
    "any command), then give the commit message in this tag, once, at the end of your reply:",
  "<nyra-commit>",
  "Short first line in the imperative",
  "",
  "Optional body with the why",
  "</nyra-commit>",
  "The app shows it as a card where the user edits the message, chooses the files and makes the commit. Never run " +
    "git commit or git push yourself. Don't mention the tag to the user. Write your explanation in the language of " +
    "the user's messages, whatever the language of the code; the commit message follows the project's earlier commits.",
].join("\n");

// The reply without its commit tags, and the message of the first one
export function takeCommit(reply: string): { message: string | null; text: string } {
  let message: string | null = null;
  const text = reply.replace(COMMIT, (_, body: string) => {
    message ??= body.trim() || null;
    return "";
  });
  return { message, text: message === null && text === reply ? reply : text.replace(/\n{3,}/g, "\n\n").trim() };
}

// While the reply arrives: the commit's tag is never shown, also half written
export const withoutCommitTag = (reply: string) => takeCommit(reply).text.replace(OPEN_COMMIT, "");

// The first line, for lists of what is pending
export const commitTitle = (message: string) => message.split("\n")[0].trim();
