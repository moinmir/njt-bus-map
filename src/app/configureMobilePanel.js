export function configureMobilePanel({
  map,
  mediaQuery,
  panelNode,
  panelToggleButton,
  appState,
}) {
  if (!panelNode || !panelToggleButton) return;

  const syncPanelState = () => {
    const shouldCollapse = mediaQuery.matches && appState.mobilePanelCollapsed;
    panelNode.classList.toggle("is-collapsed", shouldCollapse);
    panelToggleButton.setAttribute("aria-expanded", String(!shouldCollapse));
    panelToggleButton.textContent = shouldCollapse ? "Show Controls" : "Hide Controls";
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
