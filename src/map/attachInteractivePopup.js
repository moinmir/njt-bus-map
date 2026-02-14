export function attachInteractivePopup(marker, contentFactory, options) {
  const { closeDelayMs, hoverPointerQuery } = options;
  let closeTimer = null;
  let popupRequestToken = 0;
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

  const openPopup = () => {
    clearCloseTimer();
    const token = ++popupRequestToken;
    marker.setPopupContent(
      '<div class="popup-shell"><div class="next-bar">Loading stop schedule...</div></div>',
    );
    marker.openPopup();
    Promise.resolve(contentFactory())
      .then((content) => {
        if (token !== popupRequestToken) return;
        if (!marker.isPopupOpen()) return;
        marker.setPopupContent(content);
      })
      .catch((error) => {
        console.error(error);
        if (token !== popupRequestToken) return;
        if (!marker.isPopupOpen()) return;
        marker.setPopupContent(
          '<div class="popup-shell"><div class="next-bar">Unable to load stop schedule right now.</div></div>',
        );
      });
  };

  if (hoverCapable) {
    marker.on("mouseover", openPopup);
    marker.on("mouseout", scheduleClose);
  }
  marker.on("click", openPopup);

  marker.on("popupopen", () => {
    const popupElement = marker.getPopup()?.getElement();
    if (!popupElement) return;

    L.DomEvent.disableClickPropagation(popupElement);
    L.DomEvent.disableScrollPropagation(popupElement);

    if (popupElement.dataset.boundInteractive === "1") {
      return;
    }
    popupElement.dataset.boundInteractive = "1";

    popupElement.addEventListener("mouseenter", clearCloseTimer);
    popupElement.addEventListener("mouseleave", scheduleClose);
  });

  marker.on("remove", clearCloseTimer);
}
