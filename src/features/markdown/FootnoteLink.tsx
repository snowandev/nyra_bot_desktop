import type { MouseEvent, ReactNode } from "react";

type Props = {
  href: string;
  id?: string;
  // The way back's name for screen readers, since it shows only an arrow
  label?: string;
  children: ReactNode;
};

// A link the model wrote by hand may have a % that isn't an escape
function decodedId(fragment: string) {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

// Every reply numbers its footnotes from 1, so the same ids repeat down the chat: the jump looks only inside the reply
// the link is in
function jump(e: MouseEvent<HTMLAnchorElement>, href: string) {
  e.preventDefault();
  const id = CSS.escape(decodedId(href.slice(1)));
  const link = e.currentTarget;
  const scopes = [link.closest(".markdown"), link.closest(".assistant-body")];
  const target = scopes.map((scope) => scope?.querySelector<HTMLElement>(`[id="${id}"]`)).find(Boolean);
  target?.scrollIntoView({ block: "center", behavior: "smooth" });
}

// A footnote's number, or its way back to the text: a jump within the reply, never a page to open
export function FootnoteLink({ href, id, label, children }: Props) {
  return (
    <a href={href} id={id} aria-label={label} className="footnote-link" onClick={(e) => jump(e, href)}>
      {children}
    </a>
  );
}
