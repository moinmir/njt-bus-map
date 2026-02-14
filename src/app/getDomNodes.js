function getRequiredElementById(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }
  return element;
}

export function getDomNodes() {
  const panelNode = document.querySelector(".panel");

  return {
    routeGroupsNode: getRequiredElementById("route-groups"),
    routeSearchNode: getRequiredElementById("route-search"),
    statusNode: getRequiredElementById("status"),
    sourceDetailsNode: getRequiredElementById("source-details"),
    fitButton: getRequiredElementById("fit-selected"),
    locateMeButton: getRequiredElementById("locate-me"),
    selectVisibleButton: getRequiredElementById("select-visible"),
    clearSelectedButton: getRequiredElementById("clear-selected"),
    searchAreaButton: getRequiredElementById("search-area"),
    clearAreaButton: getRequiredElementById("clear-area"),
    panelNode,
    panelToggleButton: getRequiredElementById("panel-toggle"),
  };
}
