import L from "leaflet";

interface PopupOptions {
  closeDelayMs: number;
  hoverPointerQuery: string;
  defaultRouteKey?: string | null;
  onHoverSessionStart?: () => void;
  onHoverSessionEnd?: () => void;
  onDirectionChange?: (routeKey: string | null, directionKey: string | null) => void;
  onRouteChange?: (routeKey: string | null, directionKey: string | null) => void;
}

export function attachInteractivePopup(
  marker: L.CircleMarker,
  contentFactory: () => Promise<string> | string,
  options: PopupOptions,
): void {
  const {
    closeDelayMs,
    hoverPointerQuery,
    defaultRouteKey = null,
    onHoverSessionStart,
    onHoverSessionEnd,
    onDirectionChange,
    onRouteChange,
  } = options;
  const loadingPopupHtml = `
    <div class="popup-shell">
      <div class="next-card next-card--status" aria-live="polite">
        <p class="next-kicker"><span class="next-icon" aria-hidden="true">⏱</span>Status</p>
        <p class="next-empty">Loading stop schedule…</p>
      </div>
    </div>
  `;
  const errorPopupHtml = `
    <div class="popup-shell">
      <div class="next-card next-card--status" aria-live="polite">
        <p class="next-kicker"><span class="next-icon" aria-hidden="true">⚠</span>Status</p>
        <p class="next-empty">Unable to load stop schedule right now.</p>
      </div>
    </div>
  `;
  let closeTimer: number | null = null;
  let popupRequestToken = 0;
  let hoverSessionActive = false;
  const hoverCapable = window.matchMedia(hoverPointerQuery).matches;

  const clearCloseTimer = () => {
    if (closeTimer !== null) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimer = window.setTimeout(() => {
      marker.closePopup();
    }, closeDelayMs);
  };

  const beginHoverSession = () => {
    if (hoverSessionActive) return;
    hoverSessionActive = true;
    onHoverSessionStart?.();
  };

  const endHoverSession = () => {
    if (!hoverSessionActive) return;
    hoverSessionActive = false;
    onHoverSessionEnd?.();
  };

  const bindDirectionToggles = (
    scopeElement: ParentNode,
    routeKey: string | null,
    emitInitialChange: boolean,
  ): string | null => {
    const panels = Array.from(scopeElement.querySelectorAll<HTMLElement>(".direction-panel[data-direction-panel]"));
    if (panels.length === 0) {
      if (emitInitialChange) {
        onDirectionChange?.(routeKey, null);
      }
      return null;
    }

    const switchButton = scopeElement.querySelector<HTMLButtonElement>(".direction-switch[data-direction-switch]");
    const currentLabelElement = switchButton?.querySelector<HTMLElement>("[data-direction-current-label]");
    const currentIconElement = switchButton?.querySelector<HTMLElement>("[data-direction-current-icon]");

    const normalizeIndex = (index: number) => ((index % panels.length) + panels.length) % panels.length;
    let activeDirectionKey: string | null = null;

    const setActiveDirectionByIndex = (index: number, emitChange: boolean) => {
      const normalizedIndex = normalizeIndex(index);
      for (const panel of panels) {
        const panelIndex = panels.indexOf(panel);
        const isActive = panelIndex === normalizedIndex;
        panel.classList.toggle("is-active", isActive);
        panel.setAttribute("aria-hidden", isActive ? "false" : "true");
      }

      const activePanel = panels[normalizedIndex];
      activeDirectionKey = activePanel?.dataset.directionPanel ?? null;
      if (emitChange) {
        onDirectionChange?.(routeKey, activeDirectionKey);
      }

      if (!switchButton || panels.length < 2) return;

      const nextPanel = panels[(normalizedIndex + 1) % panels.length];
      const activeLabel = activePanel.dataset.directionLabel ?? `Direction ${normalizedIndex + 1}`;
      const activeIcon = activePanel.dataset.directionIcon ?? "→";
      const nextLabel = nextPanel.dataset.directionLabel ?? "the next direction";

      if (currentLabelElement) {
        currentLabelElement.textContent = activeLabel;
      }
      if (currentIconElement) {
        currentIconElement.textContent = activeIcon;
      }
      switchButton.setAttribute("aria-label", `Switch direction to ${nextLabel}`);
      switchButton.title = `Switch direction to ${nextLabel}`;
      switchButton.dataset.directionIndex = String(normalizedIndex);
    };

    const defaultPanelIndex = panels.findIndex((panel) => panel.classList.contains("is-active"));
    const initialIndex = defaultPanelIndex >= 0 ? defaultPanelIndex : 0;
    setActiveDirectionByIndex(initialIndex, emitInitialChange);

    if (!switchButton || panels.length < 2) {
      return activeDirectionKey;
    }

    if (switchButton.dataset.directionBound === "1") {
      return activeDirectionKey;
    }
    switchButton.dataset.directionBound = "1";

    switchButton.addEventListener("click", () => {
      const currentIndex = Number.parseInt(switchButton.dataset.directionIndex ?? "0", 10);
      const safeCurrentIndex = Number.isNaN(currentIndex) ? 0 : currentIndex;
      setActiveDirectionByIndex(safeCurrentIndex + 1, true);
    });

    switchButton.addEventListener("keydown", (event) => {
      const currentIndex = Number.parseInt(switchButton.dataset.directionIndex ?? "0", 10);
      const safeCurrentIndex = Number.isNaN(currentIndex) ? 0 : currentIndex;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        setActiveDirectionByIndex(safeCurrentIndex + 1, true);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        setActiveDirectionByIndex(safeCurrentIndex - 1, true);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setActiveDirectionByIndex(0, true);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setActiveDirectionByIndex(panels.length - 1, true);
      }
    });

    return activeDirectionKey;
  };

  const bindRouteToggles = () => {
    const popupElement = marker.getPopup()?.getElement();
    if (!popupElement) return;

    const routePanels = Array.from(popupElement.querySelectorAll<HTMLElement>(".route-panel[data-route-panel]"));
    if (routePanels.length === 0) {
      bindDirectionToggles(popupElement, defaultRouteKey, true);
      return;
    }

    const routeNavButtons = Array.from(
      popupElement.querySelectorAll<HTMLButtonElement>(".route-nav[data-route-nav]"),
    );
    const currentRouteLabelElement = popupElement.querySelector<HTMLElement>("[data-route-current-label]");
    const currentRouteCountElement = popupElement.querySelector<HTMLElement>("[data-route-current-count]");
    const normalizeRouteIndex = (index: number) => ((index % routePanels.length) + routePanels.length) % routePanels.length;

    const setActiveRouteByIndex = (index: number, emitRouteChange: boolean) => {
      const normalizedIndex = normalizeRouteIndex(index);
      for (const panel of routePanels) {
        const panelIndex = routePanels.indexOf(panel);
        const isActive = panelIndex === normalizedIndex;
        panel.classList.toggle("is-active", isActive);
        panel.setAttribute("aria-hidden", isActive ? "false" : "true");
      }

      const activePanel = routePanels[normalizedIndex];
      const activeRouteKey = activePanel?.dataset.routePanel ?? null;
      const activeRouteShortName = activePanel?.dataset.routeShortName ?? "";
      const activeDirectionKey = bindDirectionToggles(activePanel, activeRouteKey, true);

      if (emitRouteChange) {
        onRouteChange?.(activeRouteKey, activeDirectionKey);
      }

      if (currentRouteLabelElement) {
        currentRouteLabelElement.textContent = activeRouteShortName;
      }
      if (currentRouteCountElement) {
        currentRouteCountElement.textContent = `${normalizedIndex + 1}/${routePanels.length}`;
      }

      for (const button of routeNavButtons) {
        const delta = Number.parseInt(button.dataset.routeNav ?? "0", 10);
        const safeDelta = Number.isNaN(delta) ? 0 : delta;
        const targetIndex = normalizeRouteIndex(normalizedIndex + safeDelta);
        const targetPanel = routePanels[targetIndex];
        const targetRoute = targetPanel?.dataset.routeShortName ?? "route";
        const labelPrefix = safeDelta < 0 ? "Previous route" : "Next route";
        button.setAttribute("aria-label", `${labelPrefix}: ${targetRoute}`);
        button.title = `${labelPrefix}: ${targetRoute}`;
      }

      popupElement.dataset.activeRouteIndex = String(normalizedIndex);
    };

    const defaultPanelIndex = routePanels.findIndex((panel) => panel.classList.contains("is-active"));
    const initialIndex = defaultPanelIndex >= 0 ? defaultPanelIndex : 0;
    setActiveRouteByIndex(initialIndex, true);

    for (const button of routeNavButtons) {
      if (button.dataset.routeBound === "1") continue;
      button.dataset.routeBound = "1";

      button.addEventListener("click", () => {
        const delta = Number.parseInt(button.dataset.routeNav ?? "0", 10);
        if (Number.isNaN(delta) || delta === 0) return;
        const currentIndex = Number.parseInt(popupElement.dataset.activeRouteIndex ?? "0", 10);
        const safeCurrentIndex = Number.isNaN(currentIndex) ? 0 : currentIndex;
        setActiveRouteByIndex(safeCurrentIndex + delta, true);
      });

      button.addEventListener("keydown", (event) => {
        const currentIndex = Number.parseInt(popupElement.dataset.activeRouteIndex ?? "0", 10);
        const safeCurrentIndex = Number.isNaN(currentIndex) ? 0 : currentIndex;

        if (event.key === "ArrowRight") {
          event.preventDefault();
          setActiveRouteByIndex(safeCurrentIndex + 1, true);
          return;
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          setActiveRouteByIndex(safeCurrentIndex - 1, true);
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          setActiveRouteByIndex(0, true);
          return;
        }
        if (event.key === "End") {
          event.preventDefault();
          setActiveRouteByIndex(routePanels.length - 1, true);
        }
      });
    }
  };

  const bindPopupBehaviors = () => {
    const popupElement = marker.getPopup()?.getElement();
    if (!popupElement) return;

    L.DomEvent.disableClickPropagation(popupElement);
    L.DomEvent.disableScrollPropagation(popupElement);

    if ((popupElement as HTMLElement & { dataset: DOMStringMap }).dataset.boundInteractive !== "1") {
      (popupElement as HTMLElement & { dataset: DOMStringMap }).dataset.boundInteractive = "1";
      popupElement.addEventListener("mouseenter", clearCloseTimer);
      popupElement.addEventListener("mouseleave", scheduleClose);
    }

    bindRouteToggles();
  };

  const openPopup = () => {
    clearCloseTimer();
    const token = ++popupRequestToken;
    marker.setPopupContent(loadingPopupHtml);
    marker.openPopup();
    Promise.resolve(contentFactory())
      .then((content) => {
        if (token !== popupRequestToken) return;
        if (!marker.isPopupOpen()) return;
        marker.setPopupContent(content);
        bindPopupBehaviors();
      })
      .catch((error) => {
        console.error(error);
        if (token !== popupRequestToken) return;
        if (!marker.isPopupOpen()) return;
        marker.setPopupContent(errorPopupHtml);
        bindPopupBehaviors();
      });
  };

  const openPopupWithPreviewSession = () => {
    beginHoverSession();
    openPopup();
  };

  if (hoverCapable) {
    marker.on("mouseover", openPopupWithPreviewSession);
    marker.on("mouseout", scheduleClose);
  }
  marker.on("click", openPopupWithPreviewSession);

  marker.on("popupopen", () => {
    bindPopupBehaviors();
  });

  marker.on("popupclose", endHoverSession);

  marker.on("remove", () => {
    clearCloseTimer();
    endHoverSession();
  });
}
