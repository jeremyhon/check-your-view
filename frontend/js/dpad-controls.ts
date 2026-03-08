type DpadBinding = {
  button: HTMLButtonElement;
  forwardMeters: number;
  rightMeters: number;
};

type DpadControlsOptions = {
  bindings: DpadBinding[];
  repeatIntervalMs: number;
  onMove: (forwardMeters: number, rightMeters: number) => void;
  onStop?: () => void;
};

export function bindDpadControls({
  bindings,
  repeatIntervalMs,
  onMove,
  onStop,
}: DpadControlsOptions): void {
  let repeatTimerId: number | null = null;
  let repeatPointerId: number | null = null;

  function stopRepeat(pointerId?: number): void {
    if (pointerId !== undefined && repeatPointerId !== pointerId) {
      return;
    }
    const wasRepeating = repeatTimerId !== null;
    if (repeatTimerId !== null) {
      window.clearInterval(repeatTimerId);
      repeatTimerId = null;
    }
    repeatPointerId = null;
    if (wasRepeating && typeof onStop === "function") {
      onStop();
    }
  }

  function bindButton({ button, forwardMeters, rightMeters }: DpadBinding): void {
    button.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      stopRepeat();
      onMove(forwardMeters, rightMeters);
      repeatPointerId = event.pointerId;
      repeatTimerId = window.setInterval(() => {
        onMove(forwardMeters, rightMeters);
      }, repeatIntervalMs);
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        // Ignore pointer-capture failures on unsupported browsers.
      }
      event.preventDefault();
    });

    const endPointerRepeat = (event: PointerEvent): void => {
      stopRepeat(event.pointerId);
    };

    button.addEventListener("pointerup", endPointerRepeat);
    button.addEventListener("pointercancel", endPointerRepeat);
    button.addEventListener("lostpointercapture", endPointerRepeat);

    // Keep keyboard activation working (Enter/Space dispatch click with detail=0).
    button.addEventListener("click", (event: MouseEvent) => {
      if (event.detail !== 0) {
        event.preventDefault();
        return;
      }
      onMove(forwardMeters, rightMeters);
      if (typeof onStop === "function") {
        onStop();
      }
    });
  }

  bindings.forEach(bindButton);

  window.addEventListener("pointerup", (event: PointerEvent) => {
    stopRepeat(event.pointerId);
  });
  window.addEventListener("pointercancel", (event: PointerEvent) => {
    stopRepeat(event.pointerId);
  });
  window.addEventListener("blur", () => {
    stopRepeat();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      stopRepeat();
    }
  });
}
