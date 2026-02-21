"use client";

import { useState } from "react";
import { ALL_TAGS } from "../../lib/tags";

interface Preview {
  rawTitle: string;
  rawDescription: string | null;
  venue: string;
  blurb: string;
  tags: string[];
}

export function AddEventForm() {
  const [url, setUrl] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processError, setProcessError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);

  // Editable fields after preview
  const [editTitle, setEditTitle] = useState("");
  const [editVenue, setEditVenue] = useState("");
  const [editBlurb, setEditBlurb] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editDateStart, setEditDateStart] = useState("");
  const [editDateEnd, setEditDateEnd] = useState("");
  const [isAdvanceNotice, setIsAdvanceNotice] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  async function handleProcess() {
    if (!url.trim()) return;
    setIsProcessing(true);
    setProcessError("");
    setSaveMessage("");

    try {
      const res = await fetch("/api/admin/process-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setProcessError(data.message || "Failed to process URL");
        return;
      }

      setPreview(data);
      setEditTitle(data.rawTitle || "");
      setEditVenue(data.venue || "");
      setEditBlurb(data.blurb || "");
      setEditTags(data.tags || []);
      setEditDateStart("");
      setEditDateEnd("");
      setIsAdvanceNotice(false);
    } catch {
      setProcessError("Network error — try again");
    } finally {
      setIsProcessing(false);
    }
  }

  function toggleTag(tag: string) {
    setEditTags((prev) =>
      prev.includes(tag)
        ? prev.filter((t) => t !== tag)
        : prev.length < 3
          ? [...prev, tag]
          : prev
    );
  }

  async function handlePublish() {
    if (!editTitle.trim() || !editDateStart) {
      setSaveMessage("Title and start date are required");
      return;
    }

    setIsSaving(true);
    setSaveMessage("");

    try {
      const res = await fetch("/api/admin/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: url.trim(),
          rawTitle: editTitle.trim(),
          rawDescription: preview?.rawDescription || null,
          venue: editVenue.trim(),
          eventDateStart: editDateStart,
          eventDateEnd: editDateEnd || null,
          blurb: editBlurb.trim() || null,
          tags: editTags,
          isAdvanceNotice,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSaveMessage(data.message || "Failed to save event");
        return;
      }

      // Reset form
      setSaveMessage("Event published!");
      setUrl("");
      setPreview(null);
      setEditTitle("");
      setEditVenue("");
      setEditBlurb("");
      setEditTags([]);
      setEditDateStart("");
      setEditDateEnd("");
      setIsAdvanceNotice(false);
    } catch {
      setSaveMessage("Network error — try again");
    } finally {
      setIsSaving(false);
    }
  }

  function handleDiscard() {
    setPreview(null);
    setProcessError("");
    setSaveMessage("");
  }

  return (
    <div className="max-w-lg">
      {/* URL input */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Event URL
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={!!preview}
          />
          {!preview && (
            <button
              onClick={handleProcess}
              disabled={isProcessing || !url.trim()}
              className="px-4 py-2 text-sm bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {isProcessing ? "Processing..." : "Process"}
            </button>
          )}
        </div>
        {processError && (
          <p className="mt-2 text-sm text-red-500">{processError}</p>
        )}
      </div>

      {/* Preview / Edit form */}
      {preview && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide font-medium">
            LLM Preview — edit before publishing
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Venue</label>
            <input
              type="text"
              value={editVenue}
              onChange={(e) => setEditVenue(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Blurb <span className="text-gray-400">({editBlurb.length}/120)</span>
            </label>
            <textarea
              value={editBlurb}
              onChange={(e) => setEditBlurb(e.target.value.slice(0, 120))}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm resize-none"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Start Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={editDateStart}
                onChange={(e) => setEditDateStart(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
              <input
                type="date"
                value={editDateEnd}
                onChange={(e) => setEditDateEnd(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Tags ({editTags.length}/3)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                    editTags.includes(tag)
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="advance-notice"
              checked={isAdvanceNotice}
              onChange={(e) => setIsAdvanceNotice(e.target.checked)}
              className="cursor-pointer"
            />
            <label htmlFor="advance-notice" className="text-sm text-gray-600 cursor-pointer">
              Plan Ahead Lah (advance notice event)
            </label>
          </div>

          {preview.rawDescription && (
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer hover:text-gray-700">
                Raw description from page
              </summary>
              <p className="mt-2 whitespace-pre-wrap">{preview.rawDescription}</p>
            </details>
          )}

          {saveMessage && (
            <p className={`text-sm ${saveMessage.includes("!") ? "text-green-600" : "text-red-500"}`}>
              {saveMessage}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={handlePublish}
              disabled={isSaving}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Publish"}
            </button>
            <button
              onClick={handleDiscard}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
