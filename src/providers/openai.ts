import { i18n } from "@/shared/i18n/i18n";
import { compatibleProvider } from "./openaiCompatible";

export const openai = compatibleProvider({
  id: "openai",
  name: "OpenAI",
  get description() {
    return i18n.t("providers.openai.description");
  },
  defaultBaseUrl: "https://api.openai.com/v1",
  requiresApiKey: true,
  // The list also holds models only the newer Responses API serves (codex, -pro, deep research) and old completions
  isChatModel: (id) => /^(gpt|o\d|chatgpt)/.test(id) && !/codex|-pro\b|deep-research|search|instruct/.test(id),
});
