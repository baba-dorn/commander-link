import { describe, it, expect } from "vitest";
import {
  rmsToPercent,
  smoothLevel,
  DEFAULT_AUDIO_LEVEL_CONFIG,
} from "./audio-level";

describe("rmsToPercent", () => {
  it("returns 0 for silence (all zeros)", () => {
    const silence = new Float32Array(512);
    expect(rmsToPercent(silence)).toBe(0);
  });

  it("returns 0 for near-silence (below threshold)", () => {
    const nearSilence = new Float32Array(512);
    for (let i = 0; i < nearSilence.length; i++) nearSilence[i] = 0.000001;
    expect(rmsToPercent(nearSilence)).toBe(0);
  });

  it("returns ~100 for a full-scale signal", () => {
    const fullScale = new Float32Array(512);
    for (let i = 0; i < fullScale.length; i++) {
      fullScale[i] = i % 2 === 0 ? 1 : -1;
    }
    const result = rmsToPercent(fullScale);
    expect(result).toBeGreaterThan(90);
    expect(result).toBeLessThanOrEqual(100);
  });

  it("returns a mid-range value for a moderate signal", () => {
    const moderate = new Float32Array(512);
    for (let i = 0; i < moderate.length; i++) {
      moderate[i] = 0.1 * Math.sin(i * 0.1);
    }
    const result = rmsToPercent(moderate);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(100);
  });

  it("clamps to 0..100 range", () => {
    const silence = new Float32Array(512);
    expect(rmsToPercent(silence)).toBeGreaterThanOrEqual(0);

    const full = new Float32Array(512).fill(1);
    expect(rmsToPercent(full)).toBeLessThanOrEqual(100);
  });

  it("respects custom dB range", () => {
    const signal = new Float32Array(512);
    for (let i = 0; i < signal.length; i++) {
      signal[i] = 0.01 * Math.sin(i * 0.1);
    }
    const defaultResult = rmsToPercent(signal);
    const customResult = rmsToPercent(signal, -70, -20);
    expect(customResult).toBeGreaterThan(defaultResult);
  });
});

describe("smoothLevel", () => {
  const config = DEFAULT_AUDIO_LEVEL_CONFIG;

  it("attacks quickly when instant > current", () => {
    const result = smoothLevel(10, 80, config);
    expect(result).toBeCloseTo(59, 0);
  });

  it("decays slowly when instant < current", () => {
    const result = smoothLevel(80, 10, config);
    expect(result).toBeCloseTo(71.6, 0);
  });

  it("floors to 0 when below threshold", () => {
    const result = smoothLevel(0.5, 0, config);
    expect(result).toBe(0);
  });

  it("stays at 0 when both current and instant are 0", () => {
    const result = smoothLevel(0, 0, config);
    expect(result).toBe(0);
  });

  it("handles edge case: current equals instant", () => {
    const result = smoothLevel(50, 50, config);
    expect(result).toBeCloseTo(50, 0);
  });

  it("applies asymmetric smoothing correctly", () => {
    const attackResult = smoothLevel(20, 100, config);
    const decayResult = smoothLevel(100, 20, config);
    const attackDelta = attackResult - 20;
    const decayDelta = 100 - decayResult;
    expect(attackDelta).toBeGreaterThan(decayDelta);
  });
});
