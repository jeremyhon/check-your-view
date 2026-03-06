import type { PanelController, UiElements } from "./types";

type PanelControllerOptions = {
  ui: UiElements;
  storageKey: string;
  onAfterToggle?: (collapsed: boolean) => void;
  defaultCollapsed?: boolean;
};

export function setMiniMapInstructionText(ui: UiElements, isMobileClient: boolean): void {
  if (!ui.miniMapInstruction) {
    return;
  }
  ui.miniMapInstruction.textContent = `${isMobileClient ? "Tap" : "Click"} on the map to move.`;
}

export function createPanelController({
  ui,
  storageKey,
  onAfterToggle,
  defaultCollapsed = false,
}: PanelControllerOptions): PanelController {
  let panelCollapsed = false;

  function applyPanelCollapsedState(collapsed: boolean, persist = true): void {
    panelCollapsed = Boolean(collapsed);
    document.body.classList.toggle("panel-collapsed", panelCollapsed);
    if (ui.panelToggleBtn) {
      ui.panelToggleBtn.textContent = panelCollapsed ? "Show Panel" : "Hide Panel";
      ui.panelToggleBtn.setAttribute(
        "aria-label",
        panelCollapsed ? "Show controls panel" : "Hide controls panel",
      );
      ui.panelToggleBtn.setAttribute("aria-expanded", String(!panelCollapsed));
    }
    if (persist) {
      try {
        window.localStorage.setItem(storageKey, panelCollapsed ? "1" : "0");
      } catch {
        // ignore storage errors
      }
    }
    window.setTimeout(() => {
      if (typeof onAfterToggle === "function") {
        onAfterToggle(panelCollapsed);
      }
    }, 240);
  }

  function initializePanelCollapsedState(): void {
    let savedValue = null;
    try {
      savedValue = window.localStorage.getItem(storageKey);
    } catch {
      // ignore storage errors
    }
    const collapsed = savedValue === null ? defaultCollapsed : savedValue === "1";
    applyPanelCollapsedState(collapsed, false);
  }

  function bindPanelToggle(): void {
    if (!ui.panelToggleBtn) {
      return;
    }
    ui.panelToggleBtn.addEventListener("click", () => {
      applyPanelCollapsedState(!panelCollapsed);
    });
  }

  return {
    bindPanelToggle,
    initializePanelCollapsedState,
  };
}
