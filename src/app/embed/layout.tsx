/**
 * /embed/* layout — pass-through. Intentionally does NOT re-render the
 * marketing nav or footer; embed widgets are hosted inside third-party
 * iframes where that chrome would be confusing.
 *
 * Global providers (ThemeProvider, TooltipProvider) still wrap this
 * because they live in the root layout, which always runs. That's
 * fine — theme classes on <html> don't hurt us inside an iframe; if
 * an embedding site has a dark background and we render light, the
 * card still looks coherent because we use its own border / bg tokens.
 */
export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
