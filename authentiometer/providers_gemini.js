import { safeJsonParse } from "./ui.js";

export async function geminiListModels(apiKey) {
  const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    method: "GET",
    headers: { "x-goog-api-key": apiKey }
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Gemini ListModels HTTP ${resp.status}: ${t.slice(0, 400)}`);
  }
  const data = await resp.json();
  const models = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map(m => (m.name || "").replace(/^models\//, ""))
    .filter(Boolean);

  models.sort((a,b) => a.localeCompare(b));
  return models;
}

async function geminiGenerateContent({ apiKey, model, body }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Gemini HTTP ${resp.status}: ${t.slice(0, 900)}`);
  }
  return await resp.json();
}

function textFromGemini(data) {
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ?? "";
}

export async function geminiCallJsonStrict({ apiKey, model, systemText, userText, parts }) {
  const usedParts = parts?.length ? parts : [{ text: userText }];
  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: "user", parts: usedParts }],
    generationConfig: { temperature: 0.2 }
  };
  const data = await geminiGenerateContent({ apiKey, model, body });
  const text = textFromGemini(data);
  return safeJsonParse(text);
}

// One retry if JSON formatting fails
export async function geminiCallJsonWithRetry(args) {
  try {
    return await geminiCallJsonStrict(args);
  } catch (e) {
    const msg = String(e?.message || e);
    if (!/JSON|not a JSON|Unexpected token|Response is not/i.test(msg)) throw e;

    const hardenedSystem = args.systemText + "\n\nCRITICAL: Output ONLY valid JSON. No extra text. No markdown.";
    const hardenedUser = (args.userText || "") + "\n\nREMINDER: Output MUST be a single JSON object only.";
    return await geminiCallJsonStrict({ ...args, systemText: hardenedSystem, userText: hardenedUser });
  }
}
