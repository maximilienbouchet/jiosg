export const ALL_TAGS = [
  "live & loud",
  "culture fix",
  "go see",
  "game on",
  "screen time",
  "taste test",
  "touch grass",
  "free lah",
  "last call",
  "bring someone",
  "once only",
  "try lah",
] as const;

export const TAG_COLORS: Record<string, string> = {
  "live & loud": "var(--color-tag-live-loud)",
  "culture fix": "var(--color-tag-culture-fix)",
  "go see": "var(--color-tag-go-see)",
  "game on": "var(--color-tag-game-on)",
  "screen time": "var(--color-tag-screen-time)",
  "taste test": "var(--color-tag-taste-test)",
  "touch grass": "var(--color-tag-touch-grass)",
  "free lah": "var(--color-tag-free-lah)",
  "last call": "var(--color-tag-last-call)",
  "bring someone": "var(--color-tag-bring-someone)",
  "once only": "var(--color-tag-once-only)",
  "try lah": "var(--color-tag-try-lah)",
};

// Literal hex values for contexts without the site's CSS variables (admin
// inline styles, emails). Keep in sync with the --color-tag-* definitions in
// app/globals.css.
export const TAG_HEX: Record<string, string> = {
  "live & loud": "#3B82F6",
  "culture fix": "#9F67FF",
  "go see": "#D97706",
  "game on": "#22C55E",
  "screen time": "#EF4444",
  "taste test": "#F2568B",
  "touch grass": "#84CC16",
  "free lah": "#EAB308",
  "last call": "#F97316",
  "bring someone": "#EC4899",
  "once only": "#D1D5DB",
  "try lah": "#14B8A6",
};

export const TAG_DESCRIPTIONS: Record<string, string> = {
  "live & loud": "Concerts, live music, DJ sets",
  "culture fix": "Theatre, ballet, orchestra, opera",
  "go see": "Exhibitions, art shows, galleries",
  "game on": "Sports events, tournaments",
  "screen time": "Film screenings, cinema events",
  "taste test": "Food festivals, wine tastings",
  "touch grass": "Outdoor activities, runs, walks",
  "free lah": "No cost events",
  "last call": "Ending within 7 days",
  "bring someone": "Great for a date or with friends",
  "once only": "One-time, limited, rare",
  "try lah": "Something outside your comfort zone",
};
