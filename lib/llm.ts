// TODO: Implement LLM pipeline with Anthropic Claude Haiku

export interface FilterResult {
  include: boolean;
  reason: string;
}

export interface BlurbResult {
  blurb: string;
  tags: string[];
}

export async function filterEvent(_rawTitle: string, _rawDescription: string, _venue: string, _dates: string): Promise<FilterResult> {
  // TODO: Call Claude Haiku with filter prompt from SPEC.md Section 6
  throw new Error("Not implemented");
}

export async function generateBlurbAndTags(_rawTitle: string, _rawDescription: string, _venue: string): Promise<BlurbResult> {
  // TODO: Call Claude Haiku with blurb+tags prompt from SPEC.md Section 6
  throw new Error("Not implemented");
}
