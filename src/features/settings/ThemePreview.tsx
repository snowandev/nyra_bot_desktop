import type { Theme } from "@/shared/storage/settings";

type Props = {
  theme: Theme;
};

// data-theme makes the preview use that theme's colors whatever the app's current theme
export function ThemePreview({ theme }: Props) {
  return (
    <span className="theme-preview" data-theme={theme}>
      <span className="theme-preview-sidebar" />
      <span className="theme-preview-chat">
        <span className="theme-preview-bubble" />
        <span className="theme-preview-line" />
        <span className="theme-preview-line short" />
        <span className="theme-preview-composer" />
      </span>
    </span>
  );
}
