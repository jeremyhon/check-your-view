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
  const activeTouchPointers = new Map<number, { x: number; y: number }>();
  let pinchStartDistance: number | null = null;
  let pinchStartZoomPercent = MIN_ZOOM_PERCENT;

  function applyVisualZoom(): void {
    const canvas = viewer.scene.canvas;
    const scale = zoomPercent / MIN_ZOOM_PERCENT;
    canvas.style.transformOrigin = "center center";
    canvas.style.transform = Math.abs(scale - 1) < 0.0001 ? "none" : `scale(${scale.toFixed(4)})`;
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
    if (Math.abs(clampedZoomPercent - zoomPercent) < 0.01) {
      return;
    }
    zoomPercent = clampedZoomPercent;
    applyVisualZoom();
    notifyZoomPercentChanged();
  }

  function resetZoom(): void {
    setZoomPercent(MIN_ZOOM_PERCENT);
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
    const frustum = viewer.camera.frustum;
    if ("fov" in frustum) {
      frustum.fov = Cesium.Math.toRadians(state.fov_deg);
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
    applyVisualZoom();
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
