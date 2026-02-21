"use client";

import { useState } from "react";
import { cn } from "../lib/utils";

export function SubscribeForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "loading" || status === "success") return;

    setStatus("loading");
    setErrorMessage("");

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.message || "Something went wrong.");
        return;
      }

      setStatus("success");
      setEmail("");
    } catch {
      setStatus("error");
      setErrorMessage("Something went wrong. Try again.");
    }
  };

  if (status === "success") {
    return (
      <p className="text-center text-[var(--color-accent)] font-medium">
        You&apos;re in.
      </p>
    );
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex gap-2 max-w-md mx-auto">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          required
          disabled={status === "loading"}
          className={cn(
            "flex-1 bg-[var(--color-surface-2)] border border-white/[0.07] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] rounded-lg px-4 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-accent)]",
            status === "loading" && "opacity-50"
          )}
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className={cn(
            "bg-[var(--color-accent)] text-black px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity",
            status === "loading" && "opacity-50"
          )}
        >
          {status === "loading" ? "..." : "\u2192"}
        </button>
      </form>
      {status === "error" && (
        <p className="text-center text-red-400 text-sm mt-2">{errorMessage}</p>
      )}
    </div>
  );
}
