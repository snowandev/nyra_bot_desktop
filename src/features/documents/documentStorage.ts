import { invoke } from "@tauri-apps/api/core";

// The save dialog opens on the Rust side; false means the user closed it without saving
export const saveMarkdown = (filename: string, content: string) =>
  invoke<boolean>("save_markdown", { filename, content });

// The Markdown and the images it shows in one .zip, each image under the name its link uses; data in base64
export const saveMarkdownZip = (filename: string, content: string, images: { name: string; data: string }[]) =>
  invoke<boolean>("save_markdown_zip", { filename, content, images });

// The bytes go as the raw request body, like the images, and the suggested name in a header
export const savePdf = (filename: string, pdf: Uint8Array) =>
  invoke<boolean>("save_pdf", pdf, { headers: { "x-filename": filename } });
