"use client";

import { useState, useEffect } from "react";

interface Subscriber {
  id: string;
  email: string;
  subscribedAt: string;
  isActive: boolean;
}

export function SubscriberList() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/subscribers")
      .then((res) => res.json())
      .then((data) => {
        setSubscribers(data.subscribers || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-500">Loading subscribers...</p>;

  const active = subscribers.filter((s) => s.isActive);
  const inactive = subscribers.filter((s) => !s.isActive);

  return (
    <div>
      <div className="flex items-center gap-4 mb-4">
        <span className="text-sm text-gray-500">
          {active.length} active · {inactive.length} unsubscribed · {subscribers.length} total
        </span>
      </div>

      {subscribers.length === 0 ? (
        <p className="text-gray-400 text-sm">No subscribers yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Subscribed</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {subscribers.map((sub) => (
              <tr key={sub.id} className="border-b border-gray-100">
                <td className="py-2 pr-4 font-mono text-xs">{sub.email}</td>
                <td className="py-2 pr-4 text-gray-500">
                  {new Date(sub.subscribedAt + "Z").toLocaleDateString("en-SG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </td>
                <td className="py-2">
                  {sub.isActive ? (
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                      Active
                    </span>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                      Unsubscribed
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
