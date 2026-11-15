import { createContext, useContext } from "react";
import type { Attachment } from "@/shared/types";

// The images of a conversation, the user's and the browser's screenshots, by file name: a document the model writes
// shows one, also in its PDF, where it writes ![description](its file name)
export type ConversationImages = ReadonlyMap<string, Attachment>;

export const ConversationImagesContext = createContext<ConversationImages>(new Map());

export const isConversationImage = (attachment: Attachment) => attachment.kind === "image" && !!attachment.data;

export const imagesByName = (images: Attachment[]): ConversationImages =>
  new Map(images.map((image) => [image.name, image]));

// As the model wrote it: maybe with "./" in front, or with its spaces as %20
export function imageNamed(images: ConversationImages, src: string | undefined) {
  if (!src) return undefined;
  const name = src.trim().replace(/^\.\//, "");
  try {
    return images.get(name) ?? images.get(decodeURIComponent(name));
  } catch {
    return images.get(name);
  }
}

export const useConversationImage = (src: string | undefined) => imageNamed(useContext(ConversationImagesContext), src);
