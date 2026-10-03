import { describe, it, expect } from "vitest";
import { fixtureCoordinatorView } from "../../../../tests/fixtures/coordinator-view.fixture.js";
import { applyIncomingView } from "./viewReducer.js";

describe("state/viewReducer - applyIncomingView", () => {
  it("accepts the first view when there is no current state", () => {
    expect(applyIncomingView(null, fixtureCoordinatorView)).toBe(fixtureCoordinatorView);
  });

  it("accepts a strictly newer sequence", () => {
    const newer = { ...fixtureCoordinatorView, sequence: (fixtureCoordinatorView.sequence as number) + 1 } as typeof fixtureCoordinatorView;
    expect(applyIncomingView(fixtureCoordinatorView, newer)).toBe(newer);
  });

  it("rejects a duplicate sequence", () => {
    const duplicate = { ...fixtureCoordinatorView };
    expect(applyIncomingView(fixtureCoordinatorView, duplicate)).toBe(fixtureCoordinatorView);
  });

  it("accepts an equal sequence with later simulated time (issue #53: sequence held while time advances)", () => {
    const later = { ...fixtureCoordinatorView, simTimeMs: (fixtureCoordinatorView.simTimeMs as number) + 1_000 } as typeof fixtureCoordinatorView;
    expect(applyIncomingView(fixtureCoordinatorView, later)).toBe(later);
  });

  it("rejects an equal sequence with earlier simulated time", () => {
    const later = { ...fixtureCoordinatorView, simTimeMs: (fixtureCoordinatorView.simTimeMs as number) + 1_000 } as typeof fixtureCoordinatorView;
    expect(applyIncomingView(later, fixtureCoordinatorView)).toBe(later);
  });

  it("rejects an older/out-of-order sequence", () => {
    const older = { ...fixtureCoordinatorView, sequence: (fixtureCoordinatorView.sequence as number) - 1 } as typeof fixtureCoordinatorView;
    expect(applyIncomingView(fixtureCoordinatorView, older)).toBe(fixtureCoordinatorView);
  });
});
