import { useCallback, useEffect, useRef } from "react";

const BOTTOM_THRESHOLD = 80;

// Follows new content while the user is at the bottom, so they can still scroll up to read
export function useStickToBottom<Container extends HTMLElement, Content extends HTMLElement>() {
  const containerRef = useRef<Container>(null);
  const contentRef = useRef<Content>(null);
  const isPinned = useRef(true);
  const lastScrollTop = useRef(0);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (el && isPinned.current) el.scrollTop = el.scrollHeight;
  }, []);

  // Height changes outside React renders too (markdown, emoji, fonts), so watch the real size
  useEffect(() => {
    const observer = new ResizeObserver(scrollToBottom);
    if (containerRef.current) observer.observe(containerRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  // Content growing can fire scroll events too; only scrolling up means the user wants to stay put
  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
    isPinned.current = isAtBottom || (isPinned.current && el.scrollTop >= lastScrollTop.current);
    lastScrollTop.current = el.scrollTop;
  }, []);

  const pin = useCallback(() => {
    isPinned.current = true;
    scrollToBottom();
  }, [scrollToBottom]);

  // Going to an older message (search, a file's message): drawing the messages before it makes the content grow,
  // and while pinned that growth would scroll straight back to the bottom
  const unpin = useCallback(() => {
    isPinned.current = false;
  }, []);

  return { containerRef, contentRef, onScroll, pin, unpin };
}
