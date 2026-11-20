import { invoke } from "@tauri-apps/api/core";

// A microphone connected now: its id, which finds it again, and the name the system gives it
export type AudioInput = { id: string; name: string };

export const audioInputs = () => invoke<AudioInput[]>("audio_inputs");
