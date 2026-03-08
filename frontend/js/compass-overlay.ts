import { normalizeDeg } from "./utils";
import type { CompassOverlayController } from "./types";

type CompassOverlayOptions = {
  track: HTMLElement;
  readout: HTMLElement;
};

const STEP_DEGREES = 15;
const STEP_PIXELS = 34;
const TRACK_CYCLES = 3;
const MARK_COUNT = (360 / STEP_DEGREES) * TRACK_CYCLES + 1;

function toPositiveHeading(headingDeg: number): number {
  const normalized = normalizeDeg(headingDeg);
  return normalized < 0 ? normalized + 360 : normalized;
}

function directionLabel(headingDeg: number): string {
  const normalized = toPositiveHeading(headingDeg);
  const sector = Math.round(normalized / 45) % 8;
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[sector];
}

function markLabel(deg: number): string {
  const normalized = deg % 360;
  const labels: Record<number, string> = {
    0: "N",
    45: "NE",
    90: "E",
    135: "SE",
    180: "S",
    225: "SW",
    270: "W",
    315: "NW",
  };
  return labels[normalized] ?? "";
}

function buildTrack(track: HTMLElement): void {
  track.innerHTML = "";
  for (let index = 0; index < MARK_COUNT; index += 1) {
    const deg = index * STEP_DEGREES;
    const mark = document.createElement("span");
    mark.className = "compass-mark";

    if (deg % 45 === 0) {
      mark.classList.add("major");
      const label = document.createElement("span");
      label.className = "compass-mark-label";
      label.textContent = markLabel(deg);
      mark.appendChild(label);
    } else {
      mark.classList.add("minor");
    }

    track.appendChild(mark);
  }
}

export function createCompassOverlay({
  track,
  readout,
}: CompassOverlayOptions): CompassOverlayController {
  buildTrack(track);

  function syncHeading(headingDeg: number): void {
    const positiveHeading = toPositiveHeading(headingDeg);
    const anchorDegrees = 360 + positiveHeading;
    const translateX = -((anchorDegrees / STEP_DEGREES) * STEP_PIXELS);
    track.style.transform = `translateX(${translateX}px)`;
    readout.textContent = `${directionLabel(positiveHeading)} ${positiveHeading.toFixed(1)}°`;
  }

  return {
    syncHeading,
  };
}
