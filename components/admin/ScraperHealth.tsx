"use client";

import { useState, useEffect } from "react";

interface ScraperRun {
  id: string;
  source: string;
  eventsFound: number;
  error: string | null;
  ranAt: string;
}

const SOURCE_LABELS: Record<string, string> = {
  thekallang: "The Kallang",
  eventbrite: "Eventbrite",
  esplanade: "Esplanade",
  sportplus: "SportPlus",
};

const ALL_SOURCES = ["thekallang", "eventbrite", "esplanade", "sportplus"];

function formatTimestamp(iso: string): string {
  const date = new Date(iso + "Z");
  return date.toLocaleString("en-SG", { timeZone: "Asia/Singapore" });
}

function StatusBadge({ runs }: { runs: ScraperRun[] }) {
  if (runs.length === 0) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
        No data
      </span>
    );
  }

  const latest = runs[0];
  if (latest.error) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
        Error
      </span>
    );
  }
  if (latest.eventsFound === 0) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
        0 events
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
      OK
    </span>
  );
}

export function ScraperHealth() {
  const [runs, setRuns] = useState<ScraperRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/scraper-health")
      .then((res) => res.json())
      .then((data) => setRuns(data.runs || []))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading scraper health...</div>;
  }

  if (runs.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        No scraper runs recorded yet. Runs are logged each time the cron job executes.
      </div>
    );
  }

  const bySource: Record<string, ScraperRun[]> = {};
  for (const source of ALL_SOURCES) {
    bySource[source] = runs.filter((r) => r.source === source);
  }

  return (
    <div className="space-y-6">
      {ALL_SOURCES.map((source) => {
        const sourceRuns = bySource[source];
        return (
          <div key={source}>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-semibold text-gray-900">
                {SOURCE_LABELS[source] || source}
              </h3>
              <StatusBadge runs={sourceRuns} />
            </div>
            {sourceRuns.length === 0 ? (
              <p className="text-sm text-gray-400">No runs recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-600">
                      <th className="py-1.5 pr-3 font-medium">Time (SGT)</th>
                      <th className="py-1.5 pr-3 font-medium text-center">Events</th>
                      <th className="py-1.5 pr-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceRuns.map((run) => (
                      <tr key={run.id} className="border-b border-gray-100">
                        <td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap">
                          {formatTimestamp(run.ranAt)}
                        </td>
                        <td className="py-1.5 pr-3 text-center font-medium">
                          {run.error ? "—" : run.eventsFound}
                        </td>
                        <td className="py-1.5 pr-3">
                          {run.error ? (
                            <span className="text-red-600 text-xs">{run.error}</span>
                          ) : run.eventsFound === 0 ? (
                            <span className="text-yellow-600 text-xs">0 events returned</span>
                          ) : (
                            <span className="text-green-600 text-xs">OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
