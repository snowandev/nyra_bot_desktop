// The welcome's steps: those for setting up models depend on where the user wants to run them, and the permissions
// step shows only where the system has some left to ask

export type WelcomeStep = "hello" | "appearance" | "where" | "ollama" | "cloud" | "mcp" | "access" | "done";
export type ModelPlaces = { local: boolean; cloud: boolean };

export function stepsFor(places: ModelPlaces, asksAccess = false): WelcomeStep[] {
  return [
    "hello",
    "appearance",
    "where",
    ...(places.local ? (["ollama"] as const) : []),
    ...(places.cloud ? (["cloud"] as const) : []),
    "mcp",
    ...(asksAccess ? (["access"] as const) : []),
    "done",
  ];
}

// What the welcome set up, for the summary at the end
export type WelcomeResult = {
  // A model installed, downloaded or on its way, by name
  local: { state: "none" | "ready" | "downloading"; model?: string };
  // Cloud providers whose key worked, with how many models each has
  cloud: { providerId: string; models: number }[];
  mcpImported: number;
};

export const EMPTY_RESULT: WelcomeResult = { local: { state: "none" }, cloud: [], mcpImported: 0 };
