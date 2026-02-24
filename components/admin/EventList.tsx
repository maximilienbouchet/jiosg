"use client";

import { useState, useEffect, useCallback } from "react";
import { ALL_TAGS, TAG_COLORS } from "../../lib/tags";

interface AdminEvent {
  id: string;
  source: string;
  sourceUrl: string;
  rawTitle: string;
  rawDescription: string | null;
  venue: string;
  eventDateStart: string;
  eventDateEnd: string | null;
  blurb: string | null;
  tags: string[];
  isManuallyAdded: number;
  isPublished: number;
  isHeadsUp: number;
  isDuplicate: number;
  duplicateOf: string | null;
  thumbsUp: number;
  thumbsDown: number;
}

const SOURCE_BADGES: Record<string, string> = {
  manual: "bg-purple-100 text-purple-700",
  eventbrite: "bg-orange-100 text-orange-700",
  thekallang: "bg-blue-100 text-blue-700",
  esplanade: "bg-green-100 text-green-700",
  sportplus: "bg-red-100 text-red-700",
  peatix: "bg-yellow-100 text-yellow-700",
  fever: "bg-pink-100 text-pink-700",
  tessera: "bg-cyan-100 text-cyan-700",
};

export function EventList() {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    rawTitle: "",
    venue: "",
    blurb: "",
    tags: [] as string[],
    eventDateStart: "",
    eventDateEnd: "",
  });

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/events");
    if (res.ok) {
      const data = await res.json();
      setEvents(data.events);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  async function toggleField(id: string, field: "is_published" | "is_heads_up", currentValue: number) {
    const res = await fetch("/api/admin/events", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, data: { [field]: currentValue ? 0 : 1 } }),
    });
    if (res.ok) {
      setEvents((prev) =>
        prev.map((e) =>
          e.id === id
            ? {
                ...e,
                ...(field === "is_published"
                  ? { isPublished: currentValue ? 0 : 1 }
                  : { isHeadsUp: currentValue ? 0 : 1 }),
              }
            : e
        )
      );
    }
  }

  function startEdit(event: AdminEvent) {
    setEditingId(event.id);
    setEditForm({
      rawTitle: event.rawTitle,
      venue: event.venue,
      blurb: event.blurb || "",
      tags: event.tags || [],
      eventDateStart: event.eventDateStart?.slice(0, 10) || "",
      eventDateEnd: event.eventDateEnd?.slice(0, 10) || "",
    });
  }

  async function saveEdit() {
    if (!editingId) return;
    const res = await fetch("/api/admin/events", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingId,
        data: {
          raw_title: editForm.rawTitle,
          venue: editForm.venue,
          blurb: editForm.blurb,
          tags: editForm.tags,
          event_date_start: editForm.eventDateStart,
          event_date_end: editForm.eventDateEnd || null,
        },
      }),
    });
    if (res.ok) {
      setEditingId(null);
      fetchEvents();
    }
  }

  function toggleTag(tag: string) {
    setEditForm((prev) => ({
      ...prev,
      tags: prev.tags.includes(tag)
        ? prev.tags.filter((t) => t !== tag)
        : prev.tags.length < 3
          ? [...prev.tags, tag]
          : prev.tags,
    }));
  }

  const sources = [...new Set(events.map((e) => e.source))].sort();

  const filtered = events.filter((e) => {
    if (sourceFilter !== "all" && e.source !== sourceFilter) return false;
    if (search && !e.rawTitle.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading events...</div>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-4 flex-wrap">
        <input
          type="text"
          placeholder="Search by title..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2 text-sm flex-1 max-w-sm"
        />
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2 text-sm bg-white"
        >
          <option value="all">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="text-sm text-gray-500">{filtered.length} events</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-600">
              <th className="py-2 pr-3 font-medium">Date</th>
              <th className="py-2 pr-3 font-medium">Title</th>
              <th className="py-2 pr-3 font-medium">Source</th>
              <th className="py-2 pr-3 font-medium text-center">Published</th>
              <th className="py-2 pr-3 font-medium text-center">Heads Up</th>
              <th className="py-2 pr-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((event) => (
              <tr key={event.id} className={`border-b border-gray-100 hover:bg-gray-50 ${event.isDuplicate ? "opacity-40" : ""}`}>
                <td className="py-2 pr-3 whitespace-nowrap text-gray-600">
                  {event.eventDateStart?.slice(0, 10) || "—"}
                </td>
                <td className="py-2 pr-3">
                  <div className="font-medium text-gray-900 max-w-xs truncate">
                    {event.isDuplicate ? (
                      <span className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 mr-1.5 align-middle">DUP</span>
                    ) : null}
                    {event.rawTitle}
                  </div>
                  {event.blurb && (
                    <div className="text-xs text-gray-500 truncate max-w-xs">
                      {event.blurb}
                    </div>
                  )}
                  {event.tags?.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {event.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-1.5 py-0.5 rounded-full text-white"
                          style={{ backgroundColor: TAG_COLORS[tag]?.replace("var(--color-tag-", "").replace(")", "") || "#666" }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${SOURCE_BADGES[event.source] || "bg-gray-100 text-gray-700"}`}>
                    {event.source}
                  </span>
                </td>
                <td className="py-2 pr-3 text-center">
                  <input
                    type="checkbox"
                    checked={!!event.isPublished}
                    onChange={() => toggleField(event.id, "is_published", event.isPublished)}
                    className="cursor-pointer"
                  />
                </td>
                <td className="py-2 pr-3 text-center">
                  <input
                    type="checkbox"
                    checked={!!event.isHeadsUp}
                    onChange={() => toggleField(event.id, "is_heads_up", event.isHeadsUp)}
                    className="cursor-pointer"
                  />
                </td>
                <td className="py-2 pr-3">
                  <button
                    onClick={() => editingId === event.id ? setEditingId(null) : startEdit(event)}
                    className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                  >
                    {editingId === event.id ? "Cancel" : "Edit"}
                  </button>
                  {event.sourceUrl && (
                    <a
                      href={event.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-gray-400 hover:text-gray-600 text-xs"
                    >
                      Link
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit panel */}
      {editingId && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg mx-4">
            <h3 className="font-semibold text-lg mb-4">Edit Event</h3>

            <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
            <input
              type="text"
              value={editForm.rawTitle}
              onChange={(e) => setEditForm((f) => ({ ...f, rawTitle: e.target.value }))}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-3"
            />

            <label className="block text-xs font-medium text-gray-600 mb-1">Venue</label>
            <input
              type="text"
              value={editForm.venue}
              onChange={(e) => setEditForm((f) => ({ ...f, venue: e.target.value }))}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-3"
            />

            <label className="block text-xs font-medium text-gray-600 mb-1">
              Blurb <span className="text-gray-400">({editForm.blurb.length}/120)</span>
            </label>
            <textarea
              value={editForm.blurb}
              onChange={(e) => setEditForm((f) => ({ ...f, blurb: e.target.value.slice(0, 120) }))}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-3 resize-none"
              rows={2}
            />

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                <input
                  type="date"
                  value={editForm.eventDateStart}
                  onChange={(e) => setEditForm((f) => ({ ...f, eventDateStart: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                <input
                  type="date"
                  value={editForm.eventDateEnd}
                  onChange={(e) => setEditForm((f) => ({ ...f, eventDateEnd: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>
            </div>

            <label className="block text-xs font-medium text-gray-600 mb-1">
              Tags ({editForm.tags.length}/3)
            </label>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {ALL_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                    editForm.tags.includes(tag)
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditingId(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
