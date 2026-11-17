// What a reply can reach for besides answering, of the tools that overlap: searching the web, Nyra's browser and the
// user's own screen. Each tool explains itself; this says which one fits a request, so the model doesn't search and
// then open the browser, or take the user's mouse for something the browser does. Criteria, not words: the model
// applies them in the user's language.
type Available = { search: boolean; browser: boolean; screen: boolean };

// In English, which models follow most reliably. Null with fewer than two of them: there is nothing to choose.
export function toolChoicePrompt({ search, browser, screen }: Available): string | null {
  if ([search, browser, screen].filter(Boolean).length < 2) return null;
  const lines = [
    "<tool-choice>",
    "Choosing between your tools. Use the one tool that fits the request; switch to another only if it can't do the " +
      "job, and say why.",
  ];
  if (browser) {
    lines.push(
      "- The user names a browser or a website (Chrome, Edge, Safari, \"the browser\", a site's name or address): do " +
        "it in your web browser, from the first step. Don't search the web first and don't use their screen for " +
        "it. Your browser is Chrome or another Chromium browser on this computer, so asking for Chrome, or for " +
        "\"my browser\", is asking for it.",
      "- They want to open, read, use or check a page (sign in, fill a form, take a screenshot): your web browser.",
    );
  }
  if (search) {
    lines.push(
      "- They only want to know something and don't say where to do it: answer from what you know, or search the " +
        "web when it needs recent or changing information." +
        (browser ? " Don't open the browser just to look something up." : ""),
    );
  }
  if (screen) {
    lines.push(
      "- They want help with something on their computer outside a web page (an app, a setting, a window), or " +
        "point at something already open on their screen (\"this window\", \"the tab I have open\"): their screen. " +
        "Point and guide when they ask how to do it, and use their mouse and keyboard only when they ask you to do " +
        "it for them. Either way, look at their screen first rather than only writing out the steps." +
        (browser ? " For a website they didn't say is already open, use your browser instead." : ""),
    );
  }
  lines.push("</tool-choice>");
  return lines.join("\n");
}
