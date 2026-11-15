// Frames to wait for something about to be drawn; a few are enough even on a slow machine
const MAX_FRAMES = 10;

// Calls back once what find looks for is on the page. What a click or a change of screen asks for can land a frame
// or two later (a render from an effect, a message drawn on demand). Returns a way to give up.
export function whenRendered<T>(find: () => T | null | undefined, onFound: (found: T) => void, maxFrames = MAX_FRAMES) {
  let frame = 0;
  let framesLeft = maxFrames;
  const look = () => {
    const found = find();
    if (found) onFound(found);
    else if (--framesLeft > 0) frame = requestAnimationFrame(look);
  };
  frame = requestAnimationFrame(look);
  return () => cancelAnimationFrame(frame);
}

// The cursor in the composer of what is on screen, once it is drawn
export const focusComposer = () =>
  whenRendered(
    () => document.querySelector<HTMLTextAreaElement>("textarea[data-composer]"),
    (textarea) => textarea.focus(),
  );
