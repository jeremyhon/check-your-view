/* global Cesium */

import { clamp, normalizeDeg } from "./utils";

export function createCameraController({
  viewer,
  state,
  cameraFarMeters,
  onPoseChanged,
  onOrientationInputUpdate,
}) {
  let activePointerId = null;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function applyFixedPose() {
    const fixedPosition = Cesium.Cartesian3.fromDegrees(state.lng, state.lat, state.height_m);
    viewer.camera.setView({
      destination: fixedPosition,
      orientation: {
        heading: Cesium.Math.toRadians(state.heading_deg),
        pitch: Cesium.Math.toRadians(state.pitch_deg),
        roll: 0,
      },
    });
    viewer.camera.frustum.fov = Cesium.Math.toRadians(state.fov_deg);
    viewer.camera.frustum.near = 0.2;
    viewer.camera.frustum.far = cameraFarMeters;
  }

  function lockPositionControls() {
    const controls = viewer.scene.screenSpaceCameraController;
    controls.enableInputs = false;
    controls.enableTranslate = false;
    controls.enableZoom = false;
    controls.enableRotate = false;
    controls.enableTilt = false;
    controls.enableLook = false;
  }

  function installOrientationDrag() {
    const canvas = viewer.scene.canvas;
    canvas.style.cursor = "grab";

    canvas.addEventListener("pointerdown", (event) => {
      // Primary drag input for mouse/touch/pen.
      if (event.pointerType === "mouse" && event.button > 2) {
        return;
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

    canvas.addEventListener("pointermove", (event) => {
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

    const endDrag = (event) => {
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
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  return {
    applyFixedPose,
    installOrientationDrag,
    lockPositionControls,
  };
}
