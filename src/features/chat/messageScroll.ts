import { whenRendered } from "@/shared/lib/whenRendered";

// Room left above a message taller than the chat, so it doesn't stick to the edge
const TOP_MARGIN = 24;

// Centers a message in the chat, scrolling only the chat. scrollIntoView would also scroll the app's own containers
// when the message can't be centered (e.g. a long last reply), shifting the whole window out of place.
export function scrollToMessage(container: HTMLElement, element: Element) {
  const box = container.getBoundingClientRect();
  const message = element.getBoundingClientRect();
  const offset =
    message.height > box.height - TOP_MARGIN * 2
      ? message.top - box.top - TOP_MARGIN
      : message.top - box.top - (box.height - message.height) / 2;
  container.scrollTo({ top: container.scrollTop + offset });
}

// Calls back once a message is on the page: older messages are drawn on demand. Returns a way to give up, e.g. when
// the target changes before it appears.
export function whenMessageRendered(
  getContainer: () => HTMLElement | null,
  index: number,
  onRendered: (container: HTMLElement, element: Element) => void,
) {
  return whenRendered(
    () => {
      const container = getContainer();
      const element = container?.querySelector(`[data-message-index="${index}"]`);
      return container && element ? { container, element } : null;
    },
    ({ container, element }) => onRendered(container, element),
  );
}
