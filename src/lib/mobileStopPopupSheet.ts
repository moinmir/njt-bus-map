interface MobileStopPopupSheetOptions {
  onClose?: () => void;
}

interface ActiveSession {
  owner: symbol;
  onClose?: () => void;
}

interface MobileStopPopupSheetDom {
  root: HTMLDivElement;
  panel: HTMLElement;
  content: HTMLDivElement;
}

export interface MobileStopPopupSheetHandle {
  close: () => void;
  destroy: () => void;
  isOpen: () => boolean;
  open: (contentHtml: string) => HTMLDivElement;
  setContent: (contentHtml: string) => HTMLDivElement | null;
}

let activeSession: ActiveSession | null = null;
let sheetDom: MobileStopPopupSheetDom | null = null;
let documentListenersBound = false;

function setDocumentListeners(enabled: boolean): void {
  if (enabled && !documentListenersBound) {
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.addEventListener("keydown", onDocumentKeyDown);
    documentListenersBound = true;
    return;
  }

  if (!enabled && documentListenersBound) {
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("keydown", onDocumentKeyDown);
    documentListenersBound = false;
  }
}

function closeActiveSession(): void {
  if (!sheetDom) return;
  if (!activeSession) return;

  const previousSession = activeSession;
  activeSession = null;

  sheetDom.root.classList.remove("is-open");
  sheetDom.root.setAttribute("aria-hidden", "true");
  sheetDom.content.innerHTML = "";
  setDocumentListeners(false);

  previousSession.onClose?.();
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!sheetDom || !activeSession) return;
  const target = event.target;
  if (target instanceof Node && sheetDom.panel.contains(target)) {
    return;
  }
  closeActiveSession();
}

function onDocumentKeyDown(event: KeyboardEvent): void {
  if (!activeSession) return;
  if (event.key !== "Escape") return;
  event.preventDefault();
  closeActiveSession();
}

function ensureSheetDom(): MobileStopPopupSheetDom {
  if (sheetDom) return sheetDom;

  const root = document.createElement("div");
  root.className = "mobile-stop-popup-sheet";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `
    <section class="mobile-stop-popup-sheet__panel" role="dialog" aria-label="Stop details" aria-modal="false">
      <div class="mobile-stop-popup-sheet__head">
        <button
          type="button"
          class="mobile-stop-popup-sheet__close"
          aria-label="Close stop details"
          title="Close stop details"
          data-mobile-stop-popup-close
        >
          ×
        </button>
      </div>
      <div class="mobile-stop-popup-sheet__content" data-mobile-stop-popup-content></div>
    </section>
  `;
  document.body.appendChild(root);

  const panel = root.querySelector<HTMLElement>(".mobile-stop-popup-sheet__panel");
  const content = root.querySelector<HTMLDivElement>("[data-mobile-stop-popup-content]");
  const closeButton = root.querySelector<HTMLButtonElement>("[data-mobile-stop-popup-close]");

  if (!panel || !content || !closeButton) {
    root.remove();
    throw new Error("Unable to initialize mobile stop popup sheet.");
  }

  closeButton.addEventListener("click", () => {
    closeActiveSession();
  });

  sheetDom = { root, panel, content };
  return sheetDom;
}

export function createMobileStopPopupSheet(
  options: MobileStopPopupSheetOptions = {},
): MobileStopPopupSheetHandle {
  const owner = Symbol("mobile-stop-popup-sheet-owner");

  return {
    close: () => {
      if (activeSession?.owner !== owner) return;
      closeActiveSession();
    },
    destroy: () => {
      if (activeSession?.owner !== owner) return;
      closeActiveSession();
    },
    isOpen: () => activeSession?.owner === owner,
    open: (contentHtml: string) => {
      const dom = ensureSheetDom();
      if (activeSession && activeSession.owner !== owner) {
        closeActiveSession();
      }

      activeSession = { owner, onClose: options.onClose };
      dom.content.innerHTML = contentHtml;
      dom.root.classList.add("is-open");
      dom.root.setAttribute("aria-hidden", "false");
      setDocumentListeners(true);

      return dom.content;
    },
    setContent: (contentHtml: string) => {
      if (activeSession?.owner !== owner) return null;
      const dom = ensureSheetDom();
      dom.content.innerHTML = contentHtml;
      return dom.content;
    },
  };
}
