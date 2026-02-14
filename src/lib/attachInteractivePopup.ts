import L from "leaflet";

interface PopupOptions {
  closeDelayMs: number;
  hoverPointerQuery: string;
  onHoverSessionStart?: () => void;
  onHoverSessionEnd?: () => void;
  onDirectionChange?: (directionKey: string | null) => void;
}

export function attachInteractivePopup(
  marker: L.CircleMarker,
  contentFactory: () => Promise<string> | string,
  options: PopupOptions,
): void {
  const {
    closeDelayMs,
    hoverPointerQuery,
    onHoverSessionStart,
    onHoverSessionEnd,
    onDirectionChange,
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

  const bindDirectionToggles = () => {
    const popupElement = marker.getPopup()?.getElement();
    if (!popupElement) return;

    const panels = Array.from(popupElement.querySelectorAll<HTMLElement>(".direction-panel[data-direction-panel]"));
    if (panels.length === 0) return;

    const switchButton = popupElement.querySelector<HTMLButtonElement>(".direction-switch[data-direction-switch]");
    const currentLabelElement = switchButton?.querySelector<HTMLElement>("[data-direction-current-label]");
    const currentIconElement = switchButton?.querySelector<HTMLElement>("[data-direction-current-icon]");

    const setActiveDirectionByIndex = (index: number) => {
      const normalizedIndex = ((index % panels.length) + panels.length) % panels.length;
      for (const panel of panels) {
        const panelIndex = panels.indexOf(panel);
        const isActive = panelIndex === normalizedIndex;
        panel.classList.toggle("is-active", isActive);
        panel.setAttribute("aria-hidden", isActive ? "false" : "true");
      }

      const activePanel = panels[normalizedIndex];
      onDirectionChange?.(activePanel?.dataset.directionPanel ?? null);

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
    setActiveDirectionByIndex(initialIndex);

    if (!switchButton || panels.length < 2) {
      return;
    }

    if (switchButton.dataset.directionBound === "1") {
      return;
    }
    switchButton.dataset.directionBound = "1";

    switchButton.addEventListener("click", () => {
      const currentIndex = Number.parseInt(switchButton.dataset.directionIndex ?? "0", 10);
      const safeCurrentIndex = Number.isNaN(currentIndex) ? 0 : currentIndex;
      setActiveDirectionByIndex(safeCurrentIndex + 1);
    });

    switchButton.addEventListener("keydown", (event) => {
      const currentIndex = Number.parseInt(switchButton.dataset.directionIndex ?? "0", 10);
      const safeCurrentIndex = Number.isNaN(currentIndex) ? 0 : currentIndex;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        setActiveDirectionByIndex(safeCurrentIndex + 1);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        setActiveDirectionByIndex(safeCurrentIndex - 1);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setActiveDirectionByIndex(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setActiveDirectionByIndex(panels.length - 1);
      }
    });
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

    bindDirectionToggles();
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

  if (hoverCapable) {
    marker.on("mouseover", () => {
      beginHoverSession();
      openPopup();
    });
    marker.on("mouseout", scheduleClose);
  }
  marker.on("click", openPopup);

  marker.on("popupopen", () => {
    bindPopupBehaviors();
  });

  marker.on("popupclose", endHoverSession);

  marker.on("remove", () => {
    clearCloseTimer();
    endHoverSession();
  });
}
