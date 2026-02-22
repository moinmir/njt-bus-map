import L from "leaflet";
import { bindPopupContentInteractions } from "./bindPopupContentInteractions";
import { MOBILE_LAYOUT_QUERY } from "./constants";
import { createMobileStopPopupSheet } from "./mobileStopPopupSheet";

interface PopupOptions {
  closeDelayMs: number;
  hoverPointerQuery: string;
  defaultRouteKey?: string | null;
  onHoverSessionStart?: () => void;
  onHoverSessionEnd?: () => void;
  onDirectionChange?: (routeKey: string | null, directionKey: string | null) => void;
  onRouteChange?: (routeKey: string | null, directionKey: string | null) => void;
  onContentReady?: () => void;
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
    onContentReady,
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
  const useMobileSheet = window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
  const mobileSheet = useMobileSheet
    ? createMobileStopPopupSheet({
      onClose: () => {
        endHoverSession();
      },
    })
    : null;
  const popupOpenHandler = (marker as L.CircleMarker & { _openPopup?: (event?: L.LeafletMouseEvent) => void })
    ._openPopup;

  if (useMobileSheet && popupOpenHandler) {
    marker.off("click", popupOpenHandler, marker);
  }

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

  const bindPopupContent = (scopeElement: HTMLElement) => {
    bindPopupContentInteractions(scopeElement, {
      defaultRouteKey,
      onDirectionChange,
      onRouteChange,
    });
  };

  const bindDesktopPopupBehaviors = () => {
    const popupElement = marker.getPopup()?.getElement();
    if (!popupElement) return;

    const routePanels = Array.from(popupElement.querySelectorAll<HTMLElement>(".route-panel[data-route-panel]"));
    L.DomEvent.disableClickPropagation(popupElement);
    L.DomEvent.disableScrollPropagation(popupElement);

    const shellElement = popupElement as HTMLElement;
    if (shellElement.dataset.boundInteractive !== "1") {
      shellElement.dataset.boundInteractive = "1";
      popupElement.addEventListener("mouseenter", clearCloseTimer);
      popupElement.addEventListener("mouseleave", scheduleClose);
      popupElement.addEventListener("pointerdown", (event) => {
        clearCloseTimer();
        event.stopPropagation();
      });
      popupElement.addEventListener("pointerup", (event) => {
        event.stopPropagation();
      });
    }

    if (routePanels.length > 0 || popupElement.querySelector(".direction-panel[data-direction-panel]")) {
      bindPopupContent(shellElement);
    }
  };

  const openDesktopPopup = () => {
    clearCloseTimer();
    if (marker.isPopupOpen()) {
      return;
    }

    const token = ++popupRequestToken;
    marker.setPopupContent(loadingPopupHtml);
    marker.openPopup();
    Promise.resolve(contentFactory())
      .then((content) => {
        if (token !== popupRequestToken) return;
        if (!marker.isPopupOpen()) return;
        marker.setPopupContent(content);
        bindDesktopPopupBehaviors();
        onContentReady?.();
      })
      .catch((error) => {
        console.error(error);
        if (token !== popupRequestToken) return;
        if (!marker.isPopupOpen()) return;
        marker.setPopupContent(errorPopupHtml);
        bindDesktopPopupBehaviors();
      });
  };

  const openDesktopPopupWithPreviewSession = () => {
    beginHoverSession();
    openDesktopPopup();
  };

  const openMobilePopupWithPreviewSession = () => {
    beginHoverSession();
    if (!mobileSheet) return;

    marker.closePopup();
    const token = ++popupRequestToken;
    mobileSheet.open(loadingPopupHtml);
    Promise.resolve(contentFactory())
      .then((content) => {
        if (token !== popupRequestToken) return;
        if (!mobileSheet.isOpen()) return;
        const contentElement = mobileSheet.setContent(content);
        if (!contentElement) return;
        bindPopupContent(contentElement);
        onContentReady?.();
      })
      .catch((error) => {
        console.error(error);
        if (token !== popupRequestToken) return;
        if (!mobileSheet.isOpen()) return;
        mobileSheet.setContent(errorPopupHtml);
      });
  };

  if (useMobileSheet) {
    marker.on("click", openMobilePopupWithPreviewSession);
  } else {
    if (hoverCapable) {
      marker.on("mouseover", openDesktopPopupWithPreviewSession);
      marker.on("mouseout", scheduleClose);
    }
    marker.on("click", openDesktopPopupWithPreviewSession);
  }

  marker.on("popupopen", () => {
    bindDesktopPopupBehaviors();
  });

  marker.on("popupclose", () => {
    if (useMobileSheet) return;
    endHoverSession();
  });

  marker.on("remove", () => {
    clearCloseTimer();
    mobileSheet?.destroy();
    endHoverSession();
  });
}
