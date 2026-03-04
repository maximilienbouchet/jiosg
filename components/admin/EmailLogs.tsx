"use client";

import { useState, useEffect } from "react";

interface DigestRun {
  id: string;
  ranAt: string;
  subject: string | null;
  eventsCount: number;
  headsUpCount: number;
  subscribersCount: number;
  totalSent: number;
  totalFailed: number;
  skipped: string | null;
  completedAt: string | null;
}

interface EmailLog {
  id: string;
  email: string;
  status: "sent" | "failed";
  resendMessageId: string | null;
  error: string | null;
  sentAt: string;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso + "Z");
  return date.toLocaleString("en-SG", { timeZone: "Asia/Singapore" });
}

function StatusBadge({ run }: { run: DigestRun }) {
  if (run.skipped) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
        Skipped
      </span>
    );
  }
  if (run.totalFailed > 0 && run.totalSent > 0) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
        Partial
      </span>
    );
  }
  if (run.totalFailed > 0 && run.totalSent === 0) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
        Failed
      </span>
    );
  }
  if (!run.completedAt) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
        Running
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
      OK
    </span>
  );
}

export function EmailLogs() {
  const [runs, setRuns] = useState<DigestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<DigestRun | null>(null);
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    fetch("/api/admin/data?type=email-logs")
      .then((res) => res.json())
      .then((data) => setRuns(data.runs || []))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleSelectRun(run: DigestRun) {
    setSelectedRun(run);
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/admin/data?type=email-logs&runId=${run.id}`);
      const data = await res.json();
      setLogs(data.logs || []);
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading email logs...</div>;
  }

  if (runs.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        No digest runs recorded yet. Runs are logged each time the email cron job executes.
      </div>
    );
  }

  if (selectedRun) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => { setSelectedRun(null); setLogs([]); }}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          &larr; Back to all runs
        </button>

        <div className="bg-gray-50 rounded p-4 text-sm space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">
              {formatTimestamp(selectedRun.ranAt)}
            </span>
            <StatusBadge run={selectedRun} />
          </div>
          {selectedRun.subject && (
            <div className="text-gray-600">Subject: {selectedRun.subject}</div>
          )}
          <div className="text-gray-600">
            {selectedRun.eventsCount} events, {selectedRun.headsUpCount} heads-up
          </div>
          <div className="text-gray-600">
            {selectedRun.totalSent} sent, {selectedRun.totalFailed} failed
            {selectedRun.skipped && ` — skipped: ${selectedRun.skipped}`}
          </div>
        </div>

        {logsLoading ? (
          <div className="p-4 text-center text-gray-500">Loading delivery details...</div>
        ) : logs.length === 0 ? (
          <div className="p-4 text-center text-gray-500">No individual email logs for this run.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-600">
                  <th className="py-1.5 pr-3 font-medium">Email</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 font-medium">Time (SGT)</th>
                  <th className="py-1.5 pr-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-100">
                    <td className="py-1.5 pr-3 text-gray-900">{log.email}</td>
                    <td className="py-1.5 pr-3">
                      {log.status === "sent" ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Sent</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Failed</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap">
                      {formatTimestamp(log.sentAt)}
                    </td>
                    <td className="py-1.5 pr-3 text-gray-500 text-xs">
                      {log.error ? (
                        <span className="text-red-600">{log.error}</span>
                      ) : log.resendMessageId ? (
                        <span className="font-mono">{log.resendMessageId}</span>
                      ) : (
                        "—"
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
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-600">
            <th className="py-1.5 pr-3 font-medium">Time (SGT)</th>
            <th className="py-1.5 pr-3 font-medium">Subject</th>
            <th className="py-1.5 pr-3 font-medium text-center">Events</th>
            <th className="py-1.5 pr-3 font-medium text-center">Sent</th>
            <th className="py-1.5 pr-3 font-medium text-center">Failed</th>
            <th className="py-1.5 pr-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr
              key={run.id}
              className="border-b border-gray-100 cursor-pointer hover:bg-gray-50"
              onClick={() => handleSelectRun(run)}
            >
              <td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap">
                {formatTimestamp(run.ranAt)}
              </td>
              <td className="py-1.5 pr-3 text-gray-900 max-w-[200px] truncate">
                {run.skipped || run.subject || "—"}
              </td>
              <td className="py-1.5 pr-3 text-center font-medium">
                {run.eventsCount}
              </td>
              <td className="py-1.5 pr-3 text-center font-medium text-green-700">
                {run.totalSent}
              </td>
              <td className="py-1.5 pr-3 text-center font-medium text-red-700">
                {run.totalFailed || "—"}
              </td>
              <td className="py-1.5 pr-3">
                <StatusBadge run={run} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
