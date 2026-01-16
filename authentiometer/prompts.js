export const Limits = {
  // Hard stops (avoid sending absurd payloads)
  maxUserTextChars: 80_000,        // if user pastes huge text in Groq mode
  maxExtractedTextChars: 12_000,   // extraction output target (Gemini)
  maxAnalysisTextChars: 18_000,    // if extracted > this, condense first
  condensedTargetChars: 8_000,     // condensed text target
};

export function buildOptions() {
  return {
    includeAuthenticity: document.getElementById("optAuth").checked,
    includeFactChecking: document.getElementById("optFact").checked,
    includeScientificSoundness: document.getElementById("optSci").checked,
    cautiousMode: document.getElementById("optCautious").checked
  };
}

export function systemRulesText(lang) {
  const langLine = lang === "fr"
    ? "You MUST write all user-facing strings in French."
    : "You MUST write all user-facing strings in English.";

  return `
You are Authentiometer, an epistemic decision-support tool.

${langLine}

NON-NEGOTIABLE RULES:
- Output MUST be valid JSON only. No markdown, no comments, no trailing text.
- Do NOT claim certainty. Avoid "true/false" verdicts. Use probabilistic language.
- If you lack evidence, say "uncertain" and explain why.
- Do NOT invent sources, quotes, or timestamps.
- Do NOT browse the web. Use only the information you are given.
- Separate three independent dimensions:
  1) Authenticity (sincerity/performativity signals)
  2) Fact-checking (plausibility of claims; suggest how to verify)
  3) Scientific soundness (reasoning quality; methodological norms)
- Be declared-hybrid:
  - Descriptive layer: what you observe in the provided material.
  - Normative layer: explicit reasoning norms (correlation vs causation, overgeneralization, cherry-picking, proportional conclusions, uncertainty handling).
- If the provided text is partial/condensed, you MUST state it in limitations and lower confidence.

Return JSON matching exactly the schema in the user message.
  `.trim();
}

export function schemaText() {
  return `
OUTPUT JSON SCHEMA (MUST MATCH KEYS EXACTLY):
{
  "video": {
    "title": "string",
    "channelTitle": "string",
    "publishedAt": "string",
    "url": "string"
  },
  "trustProfile": {
    "authenticity": {
      "verdict": "high|medium|fragile|not_assessed",
      "confidence": "low|medium|high",
      "signalsFor": ["string"],
      "signalsAgainst": ["string"],
      "flags": ["string"],
      "notes": "string"
    },
    "factChecking": {
      "verdict": "mostly_reliable|uncertain|risky|not_assessed",
      "confidence": "low|medium|high",
      "claims": [
        {
          "claim": "string",
          "claimType": "quantitative|historical|medical|scientific|policy|other",
          "status": "plausible|uncertain|probably_wrong",
          "why": "string",
          "howToCheck": ["string"]
        }
      ],
      "overallNotes": "string"
    },
    "scientificSoundness": {
      "verdict": "solid|mixed|fragile|not_assessed",
      "confidence": "low|medium|high",
      "strengths": ["string"],
      "weaknesses": ["string"],
      "methodFlags": [
        "correlation_vs_causation",
        "overgeneralization",
        "cherry_picking",
        "misleading_statistics",
        "appeal_to_authority",
        "uncertainty_missing",
        "anecdote_over_evidence",
        "non_falsifiable_claims",
        "none"
      ],
      "notes": "string"
    }
  },
  "recommendedUse": {
    "testimonial": "ok|caution|avoid",
    "factualDecision": "ok|caution|avoid",
    "scienceLearning": "ok|caution|avoid"
  },
  "extractedClaims": ["string"],
  "limitations": ["string"]
}

CONSTRAINTS:
- Extract 5 to 10 claims max.
- Do NOT output any additional keys.
- Keep each bullet short (max ~180 chars).
  `.trim();
}

export function buildAnalyzeUserPrompt({ lang, options, youtubeUrl, transcriptText }) {
  const instruction = lang === "fr"
    ? "Analyse le contenu ci-dessous selon la charte Authentiometer."
    : "Analyze the content below following the Authentiometer charter.";

  const inputObj = {
    options,
    videoMeta: {
      title: "",
      description: "",
      channelTitle: "",
      publishedAt: "",
      url: youtubeUrl || ""
    },
    transcriptText: transcriptText || ""
  };

  return `
${instruction}

INPUT:
${JSON.stringify(inputObj, null, 2)}

${schemaText()}
  `.trim();
}

export function geminiExtractSystem(lang) {
  const langLine = lang === "fr"
    ? "You MUST write all user-facing strings in French."
    : "You MUST write all user-facing strings in English.";

  return `
You are a video-to-text extractor.

${langLine}

RULES:
- Output MUST be valid JSON only.
- Do NOT invent timestamps or quotes.
- If you cannot access the video's content (restrictions/permissions/region), say so.
- Your goal: produce a transcript-like text (or dense content text) from what you can access.
- Keep transcriptText under ${Limits.maxExtractedTextChars} characters.
- If content is long, summarize densely but indicate coverage=partial and list limitations.
  `.trim();
}

export function geminiExtractUserPrompt(lang, youtubeUrl) {
  const schema = `
OUTPUT JSON SCHEMA (MUST MATCH KEYS EXACTLY):
{
  "access": "ok|partial|blocked",
  "coverage": "full|partial|none",
  "contentLanguage": "string",
  "transcriptText": "string",
  "notes": "string",
  "limitations": ["string"]
}
CONSTRAINTS:
- transcriptText max ${Limits.maxExtractedTextChars} chars.
- No extra keys.
  `.trim();

  const instruction = lang === "fr"
    ? "Extrais le contenu parlé/texte de cette vidéo YouTube. Si tu ne peux pas obtenir une transcription complète, fournis un texte dense basé sur le contenu réellement accessible."
    : "Extract spoken content/text from this YouTube video. If full transcript is not possible, provide dense content text from what you can access.";

  return `${instruction}\n\nYouTube URL:\n${youtubeUrl}\n\n${schema}`.trim();
}

export function buildCondenseSystem(lang) {
  const langLine = lang === "fr"
    ? "You MUST write all user-facing strings in French."
    : "You MUST write all user-facing strings in English.";

  return `
You are a condenser. ${langLine}
Output MUST be valid JSON only. No markdown. No extra keys.
Do not invent facts. If input is partial, say so.
  `.trim();
}

export function buildCondenseUserPrompt({ lang, text, targetChars }) {
  const schema = `
OUTPUT JSON SCHEMA:
{
  "condensedText": "string",
  "notes": "string",
  "limitations": ["string"]
}
CONSTRAINTS:
- condensedText must be <= ${targetChars} characters.
- No extra keys.
  `.trim();

  const instruction = lang === "fr"
    ? "Condense le texte suivant en un résumé dense et factuel, en préservant les affirmations importantes et le raisonnement."
    : "Condense the following text into a dense factual summary preserving key claims and reasoning.";

  return `${instruction}\n\nTEXT:\n${text}\n\n${schema}`.trim();
}
