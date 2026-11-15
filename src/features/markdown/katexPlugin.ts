import { useEffect, useSyncExternalStore } from "react";
import type { Options } from "react-markdown";
import { loadOnce } from "@/shared/lib/loadOnDemand";

// KaTeX is the heaviest part of drawing a reply and only formulas need it: it loads the first time one shows up,
// not when Nyra starts. Until then a formula is shown as written.

type Plugin = NonNullable<Options["rehypePlugins"]>[number];

let plugin: Plugin | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const loadKatex = loadOnce(() =>
  import("rehype-katex").then(({ default: rehypeKatex }) => {
    // A formula that can't be drawn shows as its code in red instead of breaking the reply
    plugin = [rehypeKatex, { throwOnError: false, strict: "ignore" }];
    listeners.forEach((listener) => listener());
  }),
);

// The plugin once loaded; asking for it with needed loads it, and the text is drawn again when it arrives
export function useKatexPlugin(needed: boolean) {
  const current = useSyncExternalStore(subscribe, () => plugin, () => plugin);
  useEffect(() => {
    if (needed) void loadKatex();
  }, [needed]);
  return current;
}
