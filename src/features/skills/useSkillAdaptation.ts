import { useEffect, useState } from "react";
import { i18n } from "@/shared/i18n/i18n";
import { errorMessage } from "@/shared/lib/errors";
import { formatNumber } from "@/shared/lib/format";
import { configForModel, deliverByFrame } from "@/features/chat/reply/modelRequest";
import {
  ADAPTATION_SYSTEM,
  type Adaptation,
  adaptationRequest,
  adaptationTokens,
  parseAdaptation,
} from "./adaptation";
import type { Skill } from "./skills";
import { getProvider } from "@/providers";
import { useProviderSettingsContext } from "@/features/models/providerSettingsContext";
import { useStableCallback } from "@/shared/hooks/useStableCallback";

type AdaptationState =
  | { status: "running"; received: number }
  | { status: "done"; result: Adaptation }
  | { status: "error"; message: string };

// Runs as soon as it mounts; leaving (unmounting) cancels the request
export function useSkillAdaptation(skill: Skill) {
  const { models, defaultModelId, selectedModelId, optionsFor } = useProviderSettingsContext();
  // The default model, as the feature promises; without one, the model chosen in the chat
  const model = models.find((m) => m.id === defaultModelId) ?? models.find((m) => m.id === selectedModelId);
  const [state, setState] = useState<AdaptationState>({ status: "running", received: 0 });
  const [attempt, setAttempt] = useState(0);

  const run = useStableCallback(async (signal: AbortSignal) => {
    const provider = model && getProvider(model.providerId);
    if (!model || !provider) {
      setState({ status: "error", message: i18n.t("skills.adapt.noModel") });
      return;
    }
    const options = optionsFor(provider.id);
    const needed = adaptationTokens(skill);
    if (model.contextWindow && needed > model.contextWindow) {
      setState({
        status: "error",
        message: i18n.t("skills.adapt.tooLong", {
          model: model.name,
          needed: formatNumber(needed),
          limit: formatNumber(model.contextWindow),
        }),
      });
      return;
    }
    // Left to its default, Ollama may load a smaller context and silently cut a long skill, so the request
    // asks for what it needs (never less than the user's own setting)
    const contextLength = provider.supportsContextLength
      ? Math.max(options.contextLength ?? 0, Math.ceil(needed / 1024) * 1024)
      : options.contextLength;

    let reply = "";
    try {
      await deliverByFrame(
        (onToken) =>
          provider.chat(configForModel({ ...options, contextLength }, model), model, {
            messages: adaptationRequest(skill),
            system: ADAPTATION_SYSTEM,
            onToken,
            signal,
          }),
        (text) => {
          reply += text;
          setState({ status: "running", received: reply.length });
        },
      );
      if (!signal.aborted) setState({ status: "done", result: parseAdaptation(reply) });
    } catch (e) {
      if (!signal.aborted) setState({ status: "error", message: errorMessage(e) });
    }
  });

  useEffect(() => {
    const controller = new AbortController();
    run(controller.signal);
    return () => controller.abort();
  }, [attempt, run]);

  function retry() {
    setState({ status: "running", received: 0 });
    setAttempt((n) => n + 1);
  }

  return { state, modelName: model?.name ?? null, retry };
}
