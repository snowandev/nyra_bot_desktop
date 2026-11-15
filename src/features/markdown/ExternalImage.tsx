import { ImageOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isInlineImage } from "@/shared/lib/links";
import { ExternalLink } from "@/shared/ui/ExternalLink";
import { imageSrc } from "@/features/attachments/attachments";
import { useConversationImage } from "./conversationImages";

type Props = {
  src: string | undefined;
  alt: string | undefined;
};

// Loading an image from a URL the model wrote would let instructions hidden in a file or imported chat send
// conversation data to any server, so remote images are never fetched; the user can open them on purpose
export function ExternalImage({ src, alt }: Props) {
  const { t } = useTranslation();
  // One of the conversation's own images, named by its file: it is already here, nothing is fetched
  const image = useConversationImage(src);
  if (image) return <img className="conversation-image" src={imageSrc(image)} alt={alt ?? image.name} />;
  if (isInlineImage(src)) return <img src={src} alt={alt ?? ""} />;

  return (
    <span className="external-image">
      <ImageOff size={14} strokeWidth={2} aria-hidden="true" />
      <span>{alt ? t("ui.externalImageNamed", { alt }) : t("ui.externalImage")}</span>
      <ExternalLink href={src}>{t("ui.openInBrowser")}</ExternalLink>
    </span>
  );
}
