/**
 * Vesa design-mode plugin.
 *
 * Tags the document with `data-vesa-design-mode` when the host requests it so
 * the preview shell can overlay edit affordances without touching app code.
 */
export default function vesaDesignMode() {
  return {
    name: "vesa-design-mode",
    transformIndexHtml(html) {
      if (!html.includes("<body")) return html;
      return html.replace("<body", "<body data-vesa-design-mode");
    },
  };
}
