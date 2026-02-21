"use client";

import { useState, useEffect } from "react";

interface FeedbackEvent {
  id: string;
  rawTitle: string;
  venue: string;
  eventDateStart: string;
  isPublished: number;
  thumbsUp: number;
  thumbsDown: number;
}

export function FeedbackView() {
  const [events, setEvents] = useState<FeedbackEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/events")
      .then((res) => res.json())
      .then((data) => {
        const withVotes = (data.events as FeedbackEvent[])
          .filter((e) => e.thumbsUp + e.thumbsDown > 0)
          .sort((a, b) => b.thumbsDown - a.thumbsDown);
        setEvents(withVotes);
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading feedback...</div>;
  }

  if (events.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        No events with feedback yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-600">
            <th className="py-2 pr-3 font-medium">Title</th>
            <th className="py-2 pr-3 font-medium">Date</th>
            <th className="py-2 pr-3 font-medium text-center">Thumbs Up</th>
            <th className="py-2 pr-3 font-medium text-center">Thumbs Down</th>
            <th className="py-2 pr-3 font-medium text-center">Net</th>
            <th className="py-2 pr-3 font-medium text-center">Published</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const net = event.thumbsUp - event.thumbsDown;
            return (
              <tr key={event.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 pr-3">
                  <div className="font-medium text-gray-900 max-w-xs truncate">
                    {event.rawTitle}
                  </div>
                  <div className="text-xs text-gray-500">{event.venue}</div>
                </td>
                <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">
                  {event.eventDateStart?.slice(0, 10) || "—"}
                </td>
                <td className="py-2 pr-3 text-center text-green-600 font-medium">
                  {event.thumbsUp}
                </td>
                <td className="py-2 pr-3 text-center text-red-600 font-medium">
                  {event.thumbsDown}
                </td>
                <td className={`py-2 pr-3 text-center font-medium ${
                  net > 0 ? "text-green-600" : net < 0 ? "text-red-600" : "text-gray-500"
                }`}>
                  {net > 0 ? `+${net}` : net}
                </td>
                <td className="py-2 pr-3 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    event.isPublished
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-600"
                  }`}>
                    {event.isPublished ? "Yes" : "No"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
