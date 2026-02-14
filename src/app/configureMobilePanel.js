export function configureMobilePanel({
  map,
  mediaQuery,
  panelNode,
  panelToggleButton,
  appState,
}) {
  if (!panelNode || !panelToggleButton) return;

  const iconNode = panelToggleButton.querySelector(".sidebar-toggle-icon");

  const syncPanelState = () => {
    const shouldCollapse = appState.mobilePanelCollapsed;
    panelNode.classList.toggle("is-collapsed", shouldCollapse);
    panelToggleButton.setAttribute("aria-expanded", String(!shouldCollapse));
    panelToggleButton.setAttribute(
      "aria-label",
      shouldCollapse ? "Expand controls sidebar" : "Collapse controls sidebar",
    );

    if (iconNode) {
      iconNode.textContent = mediaQuery.matches ? "⌄" : "❮";
    }

    window.setTimeout(() => map.invalidateSize(), 180);
  };

  panelToggleButton.addEventListener("click", () => {
    appState.mobilePanelCollapsed = !appState.mobilePanelCollapsed;
    syncPanelState();
  });

  const onViewportChange = (event) => {
    appState.mobilePanelCollapsed = event.matches;
    syncPanelState();
  };

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", onViewportChange);
  } else {
    mediaQuery.addListener(onViewportChange);
  }

  syncPanelState();
}
