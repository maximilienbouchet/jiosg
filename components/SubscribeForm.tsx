"use client";

// TODO: Implement email subscribe form — POST to /api/subscribe

import { useState } from "react";

export function SubscribeForm() {
  const [email, setEmail] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: POST to /api/subscribe, show success/error state
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 max-w-md mx-auto">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        required
        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)]"
      />
      <button
        type="submit"
        className="bg-[var(--color-accent)] text-black px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
      >
        &rarr;
      </button>
    </form>
  );
}
