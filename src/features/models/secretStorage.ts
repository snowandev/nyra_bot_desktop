import { invoke } from "@tauri-apps/api/core";

// API keys are kept by the Rust side: in the system keychain or, where there is none, in a file only the user can read

export type SecretStore = "keychain" | "file";

export const secretStore = () => invoke<SecretStore>("secret_store");
// Which providers have a key saved, without reading any from the keychain
export const savedApiKeys = (providers: string[]) => invoke<string[]>("saved_api_keys", { providers });
export const loadApiKey = (provider: string) => invoke<string | null>("load_api_key", { provider });
// An empty key forgets the saved one
export const saveApiKey = (provider: string, key: string) => invoke<void>("save_api_key", { provider, key });
export const forgetApiKey = (provider: string) => invoke<void>("forget_api_key", { provider });
