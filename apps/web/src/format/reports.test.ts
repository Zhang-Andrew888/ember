import { describe, it, expect } from "vitest";
import { fixtureCoordinatorView } from "../../../../tests/fixtures/coordinator-view.fixture.js";
import {
  latestUrgentReport,
  routineReports,
  siteProtectionStatus,
  siteProtectionStatusLabel,
  siteDamageLabel,
} from "./reports.js";

describe("format/reports - latestUrgentReport", () => {
  it("returns null when the fixture has no urgent reports", () => {
    expect(latestUrgentReport(fixtureCoordinatorView)).toBeNull();
  });

  it("picks the highest-sequence urgent report when several exist", () => {
    const view = {
      ...fixtureCoordinatorView,
      recentReports: [
        { ...fixtureCoordinatorView.recentReports[0]!, sequence: 1 as never, urgent: true },
        { ...fixtureCoordinatorView.recentReports[0]!, sequence: 3 as never, urgent: true },
        { ...fixtureCoordinatorView.recentReports[0]!, sequence: 2 as never, urgent: true },
      ],
    };
    expect(latestUrgentReport(view)?.sequence).toBe(3);
  });
});

describe("format/reports - routineReports", () => {
  it("returns all fixture reports in chronological order", () => {
    const result = routineReports(fixtureCoordinatorView);
    expect(result.map((r) => r.sequence)).toEqual([1, 2, 3]);
  });

  it("excludes urgent reports", () => {
    const view = {
      ...fixtureCoordinatorView,
      recentReports: [
        { ...fixtureCoordinatorView.recentReports[0]!, sequence: 1 as never, urgent: true },
        { ...fixtureCoordinatorView.recentReports[1]!, sequence: 2 as never, urgent: false },
      ],
    };
    expect(routineReports(view)).toHaveLength(1);
  });
});

describe("format/reports - siteProtectionStatus", () => {
  it("is unobserved for every fixture site", () => {
    for (const site of fixtureCoordinatorView.sites) {
      expect(siteProtectionStatus(site)).toBe("unobserved");
    }
  });

  it("is destroyed once observedDestroyed is true", () => {
    const site = { ...fixtureCoordinatorView.sites[0]!, observedDestroyed: true };
    expect(siteProtectionStatus(site)).toBe("destroyed");
  });

  it("is unprotected at zero completed work", () => {
    const site = {
      ...fixtureCoordinatorView.sites[0]!,
      observedDestroyed: false,
      observedCompletedWork: 0 as never,
    };
    expect(siteProtectionStatus(site)).toBe("unprotected");
  });

  it("is partially_protected once work has started", () => {
    const site = {
      ...fixtureCoordinatorView.sites[0]!,
      observedDestroyed: false,
      observedCompletedWork: 5 as never,
    };
    expect(siteProtectionStatus(site)).toBe("partially_protected");
  });
});

describe("format/reports - siteProtectionStatusLabel", () => {
  it("gives every status a distinct, non-empty label", () => {
    const statuses: Array<ReturnType<typeof siteProtectionStatus>> = [
      "unobserved",
      "unprotected",
      "partially_protected",
      "destroyed",
    ];
    const labels = statuses.map(siteProtectionStatusLabel);
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(statuses.length);
  });
});

describe("format/reports - siteDamageLabel", () => {
  it("is null when damage hasn't been observed", () => {
    expect(siteDamageLabel(null)).toBeNull();
  });

  it("is null at zero damage", () => {
    expect(siteDamageLabel(0)).toBeNull();
  });

  it("gives a rounded percentage for positive damage", () => {
    expect(siteDamageLabel(0.4)).toBe("40% damaged");
  });

  it("rounds rather than truncates", () => {
    expect(siteDamageLabel(0.125)).toBe("13% damaged");
  });

  it("reads sensibly at full damage", () => {
    expect(siteDamageLabel(1)).toBe("100% damaged");
  });
});
