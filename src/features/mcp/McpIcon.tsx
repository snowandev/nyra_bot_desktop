import type { ServerIcon } from "./mcpStorage";

type Props = {
  icon: ServerIcon | undefined;
  name: string;
  size?: "small" | "medium";
};

// A server's own picture, the one for the theme when it has two; without one, its initial. Always an <img> of a data
// URI, so an SVG from a server never runs anything.
export function McpIcon({ icon, name, size = "medium" }: Props) {
  const light = icon?.light ?? icon?.dark;
  const dark = icon?.dark ?? icon?.light;
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";

  return (
    <span className={`mcp-icon ${size}`} aria-hidden="true">
      {light && dark && light !== dark ? (
        <>
          <img className="on-light" src={light} alt="" />
          <img className="on-dark" src={dark} alt="" />
        </>
      ) : light ? (
        <img src={light} alt="" />
      ) : (
        <span className="mcp-icon-initial">{initial}</span>
      )}
    </span>
  );
}
