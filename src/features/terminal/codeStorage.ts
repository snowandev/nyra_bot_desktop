import { invoke } from "@tauri-apps/api/core";
import type { CodeLanguage } from "@/shared/types";

// The programs Nyra writes run from a folder of each conversation that Rust keeps in the app's cache

// The interpreter each language starts with on this computer, when there is one, and the common Python packages
// it can import
export type CodeRuntimes = Partial<Record<CodeLanguage, string | null>> & { packages?: string[]; missingPackages?: string[] };

type CodeFile = { path: string; size: number; modified: number };

// The conversation's folder, with its attached files written in by name
export const codeSpace = (conversationId: string, inputs: { name: string; data: string }[]) =>
  invoke<string>("code_space", { conversationId, inputs });
export const codeRuntimes = () => invoke<CodeRuntimes>("code_runtimes");
// Saves the program and gives the command that runs it
export const prepareCode = (conversationId: string, language: CodeLanguage, source: string) =>
  invoke<string>("prepare_code", { conversationId, language, source });
export const codeFiles = (conversationId: string) => invoke<CodeFile[]>("code_files", { conversationId });
export const readCodeFile = (conversationId: string, path: string) =>
  invoke<string>("read_code_file", { conversationId, path });
export const saveCodeFile = (conversationId: string, path: string) =>
  invoke<boolean>("save_code_file", { conversationId, path });
