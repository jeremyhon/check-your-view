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

export type DpadControlsController = {
  dispose: () => void;
};

export function bindDpadControls({
  bindings,
  repeatIntervalMs,
  onMove,
  onStop,
}: DpadControlsOptions): DpadControlsController {
  let repeatTimerId: number | null = null;
  let repeatPointerId: number | null = null;
  const cleanupFns: Array<() => void> = [];

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
    const onPointerDown = (event: PointerEvent): void => {
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
    };
    button.addEventListener("pointerdown", onPointerDown);
    cleanupFns.push(() => {
      button.removeEventListener("pointerdown", onPointerDown);
    });

    const endPointerRepeat = (event: PointerEvent): void => {
      stopRepeat(event.pointerId);
    };

    button.addEventListener("pointerup", endPointerRepeat);
    cleanupFns.push(() => {
      button.removeEventListener("pointerup", endPointerRepeat);
    });
    button.addEventListener("pointercancel", endPointerRepeat);
    cleanupFns.push(() => {
      button.removeEventListener("pointercancel", endPointerRepeat);
    });
    button.addEventListener("lostpointercapture", endPointerRepeat);
    cleanupFns.push(() => {
      button.removeEventListener("lostpointercapture", endPointerRepeat);
    });

    // Keep keyboard activation working (Enter/Space dispatch click with detail=0).
    const onClick = (event: MouseEvent): void => {
      if (event.detail !== 0) {
        event.preventDefault();
        return;
      }
      onMove(forwardMeters, rightMeters);
      if (typeof onStop === "function") {
        onStop();
      }
    };
    button.addEventListener("click", onClick);
    cleanupFns.push(() => {
      button.removeEventListener("click", onClick);
    });
  }

  bindings.forEach(bindButton);

  const onWindowPointerUp = (event: PointerEvent): void => {
    stopRepeat(event.pointerId);
  };
  window.addEventListener("pointerup", onWindowPointerUp);
  cleanupFns.push(() => {
    window.removeEventListener("pointerup", onWindowPointerUp);
  });

  const onWindowPointerCancel = (event: PointerEvent): void => {
    stopRepeat(event.pointerId);
  };
  window.addEventListener("pointercancel", onWindowPointerCancel);
  cleanupFns.push(() => {
    window.removeEventListener("pointercancel", onWindowPointerCancel);
  });

  const onWindowBlur = (): void => {
    stopRepeat();
  };
  window.addEventListener("blur", onWindowBlur);
  cleanupFns.push(() => {
    window.removeEventListener("blur", onWindowBlur);
  });

  const onVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") {
      stopRepeat();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  cleanupFns.push(() => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
  });

  return {
    dispose: (): void => {
      stopRepeat();
      cleanupFns.forEach((cleanupFn) => {
        cleanupFn();
      });
    },
  };
}
