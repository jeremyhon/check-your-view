/* global Cesium */

import { clamp, normalizeDeg } from "./utils";
import type { Viewer } from "cesium";
import type { CameraController, ViewState } from "./types";

type CameraControllerOptions = {
  viewer: Viewer;
  state: ViewState;
  cameraFarMeters: number;
  onPoseChanged?: () => void;
  onOrientationInputUpdate?: () => void;
  onZoomPercentChanged?: (zoomPercent: number) => void;
};

const MIN_ZOOM_PERCENT = 100;
const MAX_ZOOM_PERCENT = 400;
const ZOOM_WHEEL_SENSITIVITY = 0.0015;
const MIN_EFFECTIVE_FOV_DEG = 5;
const MIN_ZOOM_STEP_PERCENT = 0.1;
const FOV_QUANTIZE_DEG = 0.25;
const ZOOM_APPLY_MIN_INTERVAL_MS = 120;
const ZOOM_APPLY_TRAILING_DELAY_MS = 140;

export function createCameraController({
  viewer,
  state,
  cameraFarMeters,
  onPoseChanged,
  onOrientationInputUpdate,
  onZoomPercentChanged,
}: CameraControllerOptions): CameraController {
  let activePointerId: number | null = null;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let zoomPercent = MIN_ZOOM_PERCENT;
  let lastAppliedZoomPercent = MIN_ZOOM_PERCENT;
  let lastAppliedBaseFovDeg = state.fov_deg;
  let lastZoomAppliedAt = 0;
  let pendingZoomApplyTimer: number | null = null;
  const activeTouchPointers = new Map<number, { x: number; y: number }>();
  let pinchStartDistance: number | null = null;
  let pinchStartZoomPercent = MIN_ZOOM_PERCENT;

  function clearPendingZoomApplyTimer(): void {
    if (pendingZoomApplyTimer !== null) {
      window.clearTimeout(pendingZoomApplyTimer);
      pendingZoomApplyTimer = null;
    }
  }

  function applyZoomFov(zoomPercentValue: number): void {
    const frustum = viewer.camera.frustum;
    if (!("fov" in frustum)) {
      return;
    }
    const unclampedFovDeg = clamp(
      (state.fov_deg * MIN_ZOOM_PERCENT) / zoomPercentValue,
      MIN_EFFECTIVE_FOV_DEG,
      120,
    );
    const quantizedFovDeg = Math.round(unclampedFovDeg / FOV_QUANTIZE_DEG) * FOV_QUANTIZE_DEG;
    frustum.fov = Cesium.Math.toRadians(quantizedFovDeg);
    lastAppliedZoomPercent = zoomPercentValue;
    lastAppliedBaseFovDeg = state.fov_deg;
    lastZoomAppliedAt = performance.now();
    viewer.scene.requestRender();
  }

  function applyZoomFovImmediate(): void {
    clearPendingZoomApplyTimer();
    applyZoomFov(zoomPercent);
  }

  function scheduleZoomFovApply(): void {
    clearPendingZoomApplyTimer();
    const now = performance.now();
    const timeSinceLastApply = now - lastZoomAppliedAt;
    if (timeSinceLastApply >= ZOOM_APPLY_MIN_INTERVAL_MS) {
      applyZoomFov(zoomPercent);
      return;
    }
    pendingZoomApplyTimer = window.setTimeout(() => {
      pendingZoomApplyTimer = null;
      applyZoomFov(zoomPercent);
    }, ZOOM_APPLY_TRAILING_DELAY_MS);
  }

  function notifyZoomPercentChanged(): void {
    if (typeof onZoomPercentChanged === "function") {
      onZoomPercentChanged(zoomPercent);
    }
  }

  function getTouchDistance(): number | null {
    if (activeTouchPointers.size !== 2) {
      return null;
    }
    const [firstPointer, secondPointer] = [...activeTouchPointers.values()];
    const dx = secondPointer.x - firstPointer.x;
    const dy = secondPointer.y - firstPointer.y;
    return Math.hypot(dx, dy);
  }

  function setZoomPercent(nextZoomPercent: number): void {
    const clampedZoomPercent = clamp(nextZoomPercent, MIN_ZOOM_PERCENT, MAX_ZOOM_PERCENT);
    if (Math.abs(clampedZoomPercent - zoomPercent) < MIN_ZOOM_STEP_PERCENT) {
      return;
    }
    zoomPercent = clampedZoomPercent;
    scheduleZoomFovApply();
    notifyZoomPercentChanged();
  }

  function resetZoom(): void {
    zoomPercent = MIN_ZOOM_PERCENT;
    applyZoomFovImmediate();
    notifyZoomPercentChanged();
  }

  function applyFixedPose(): void {
    const fixedPosition = Cesium.Cartesian3.fromDegrees(state.lng, state.lat, state.height_m);
    viewer.camera.setView({
      destination: fixedPosition,
      orientation: {
        heading: Cesium.Math.toRadians(state.heading_deg),
        pitch: Cesium.Math.toRadians(state.pitch_deg),
        roll: 0,
      },
    });
    if (
      Math.abs(lastAppliedZoomPercent - zoomPercent) > MIN_ZOOM_STEP_PERCENT ||
      Math.abs(lastAppliedBaseFovDeg - state.fov_deg) > 0.0001
    ) {
      applyZoomFovImmediate();
    } else {
      viewer.scene.requestRender();
    }
    viewer.camera.frustum.near = 0.2;
    viewer.camera.frustum.far = cameraFarMeters;
  }

  function lockPositionControls(): void {
    const controls = viewer.scene.screenSpaceCameraController;
    controls.enableInputs = false;
    controls.enableTranslate = false;
    controls.enableZoom = false;
    controls.enableRotate = false;
    controls.enableTilt = false;
    controls.enableLook = false;
  }

  function installOrientationDrag(): void {
    const canvas = viewer.scene.canvas;
    canvas.style.cursor = "grab";
    canvas.style.touchAction = "none";

    canvas.addEventListener("pointerdown", (event: PointerEvent) => {
      // Primary drag input for mouse/touch/pen.
      if (event.pointerType === "mouse" && event.button > 2) {
        return;
      }
      if (event.pointerType === "touch") {
        activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (activeTouchPointers.size === 2) {
          const initialDistance = getTouchDistance();
          pinchStartDistance = initialDistance && initialDistance > 0 ? initialDistance : null;
          pinchStartZoomPercent = zoomPercent;
          dragging = false;
          activePointerId = null;
          canvas.style.cursor = "grab";
          event.preventDefault();
          return;
        }
      }
      activePointerId = event.pointerId;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.style.cursor = "grabbing";
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Older browsers may not support pointer capture.
      }
      event.preventDefault();
    });

    canvas.addEventListener("pointermove", (event: PointerEvent) => {
      if (event.pointerType === "touch" && activeTouchPointers.has(event.pointerId)) {
        activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (activeTouchPointers.size === 2) {
          const distance = getTouchDistance();
          if (distance && pinchStartDistance && pinchStartDistance > 0) {
            const pinchRatio = distance / pinchStartDistance;
            setZoomPercent(pinchStartZoomPercent * pinchRatio);
          }
          event.preventDefault();
          return;
        }
      }
      if (!dragging || event.pointerId !== activePointerId) {
        return;
      }
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;

      state.heading_deg = normalizeDeg(state.heading_deg - dx * 0.2);
      state.pitch_deg = clamp(state.pitch_deg + dy * 0.2, -89, 89);
      applyFixedPose();
      if (typeof onOrientationInputUpdate === "function") {
        onOrientationInputUpdate();
      }
      if (typeof onPoseChanged === "function") {
        onPoseChanged();
      }
      event.preventDefault();
    });

    const endDrag = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        activeTouchPointers.delete(event.pointerId);
        if (activeTouchPointers.size < 2) {
          pinchStartDistance = null;
        }
      }
      if (event.pointerId !== activePointerId) {
        return;
      }
      dragging = false;
      activePointerId = null;
      canvas.style.cursor = "grab";
      event.preventDefault();
    };

    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("contextmenu", (event: MouseEvent) => event.preventDefault());
  }

  function installZoomControls(): void {
    const canvas = viewer.scene.canvas;
    applyZoomFovImmediate();
    canvas.addEventListener(
      "wheel",
      (event: WheelEvent) => {
        const zoomMultiplier = Math.exp(-event.deltaY * ZOOM_WHEEL_SENSITIVITY);
        setZoomPercent(zoomPercent * zoomMultiplier);
        event.preventDefault();
      },
      { passive: false },
    );
  }

  return {
    applyFixedPose,
    installOrientationDrag,
    installZoomControls,
    lockPositionControls,
    resetZoom,
  };
}
