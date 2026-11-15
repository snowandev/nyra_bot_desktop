import { Channel, invoke } from "@tauri-apps/api/core";

// The commands run in Rust, in a real terminal; what they print arrives through a channel while they run

type CommandEvent = { kind: "output"; text: string };

// Resolves with the exit code once the command ends, however long it takes
export function runCommand(id: string, root: string, command: string, onOutput: (text: string) => void) {
  const channel = new Channel<CommandEvent>();
  channel.onmessage = (event) => onOutput(event.text);
  return invoke<number>("run_command", { id, root, command, onOutput: channel });
}

// Interrupts it like Ctrl+C, and ends it for good if it keeps running
export const stopCommand = (id: string) => invoke<void>("stop_command", { id });
export const writeCommandInput = (id: string, text: string) => invoke<void>("write_command_input", { id, text });
// The terminal hides what is typed, as for a password (not known on Windows)
export const commandInputHidden = (id: string) => invoke<boolean>("command_input_hidden", { id });
export const saveCommandOutput = (filename: string, content: string) =>
  invoke<boolean>("save_command_output", { filename, content });
