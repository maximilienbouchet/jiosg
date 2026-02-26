"use client";

import { useState, useEffect } from "react";
import { EventList } from "../../components/admin/EventList";
import { AddEventForm } from "../../components/admin/AddEventForm";
import { ScraperHealth } from "../../components/admin/ScraperHealth";
import { SubscriberList } from "../../components/admin/SubscriberList";

type Tab = "events" | "add" | "health" | "subscribers";

export default function AdminPage() {
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("events");

  useEffect(() => {
    fetch("/api/admin/auth")
      .then((res) => res.json())
      .then((data) => setIsAuthed(data.authenticated))
      .catch(() => setIsAuthed(false));
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (data.authenticated) {
      setIsAuthed(true);
      setPassword("");
    } else {
      setError(data.message || "Invalid password");
    }
  }

  async function handleLogout() {
    await fetch("/api/admin/auth", { method: "DELETE" });
    setIsAuthed(false);
  }

  // Loading state
  if (isAuthed === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Checking auth...</p>
      </div>
    );
  }

  // Login form
  if (!isAuthed) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <form onSubmit={handleLogin} className="w-full max-w-xs">
          <h1 className="text-2xl font-bold mb-6 text-center font-[family-name:var(--font-space-grotesk)]">
            jio admin
          </h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
          <button
            type="submit"
            className="w-full bg-gray-900 text-white rounded py-2 text-sm font-medium hover:bg-gray-800"
          >
            Log in
          </button>
        </form>
      </div>
    );
  }

  // Authenticated — tabbed interface
  const tabs: { key: Tab; label: string }[] = [
    { key: "events", label: "Events" },
    { key: "add", label: "Add Event" },
    { key: "health", label: "Scraper Health" },
    { key: "subscribers", label: "Subscribers" },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold font-[family-name:var(--font-space-grotesk)]">
          jio admin
        </h1>
        <button
          onClick={handleLogout}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Logout
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "events" && <EventList />}
      {activeTab === "add" && <AddEventForm />}
      {activeTab === "health" && <ScraperHealth />}
      {activeTab === "subscribers" && <SubscriberList />}
    </div>
  );
}
