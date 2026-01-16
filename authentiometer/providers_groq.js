import { safeJsonParse } from "./ui.js";

export async function groqListModels(apiKey) {
  const resp = await fetch("https://api.groq.com/openai/v1/models", {
    method: "GET",
    headers: { "Authorization": `Bearer ${apiKey}` }
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Groq ListModels HTTP ${resp.status}: ${t.slice(0, 400)}`);
  }
  const data = await resp.json();
  const models = (data.data || []).map(m => m.id).filter(Boolean).sort((a,b)=>a.localeCompare(b));
  return models;
}

export async function groqCallJsonStrict({ apiKey, model, systemText, userText }) {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemText },
        { role: "user", content: userText }
      ]
    })
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Groq HTTP ${resp.status}: ${t.slice(0, 900)}`);
  }

  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return safeJsonParse(text);
}

export async function groqCallJsonWithRetry(args) {
  try {
    return await groqCallJsonStrict(args);
  } catch (e) {
    const msg = String(e?.message || e);
    if (!/JSON|not a JSON|Unexpected token|Response is not/i.test(msg)) throw e;

    const hardenedSystem = args.systemText + "\n\nCRITICAL: Output ONLY valid JSON. No extra text. No markdown.";
    const hardenedUser = (args.userText || "") + "\n\nREMINDER: Output MUST be a single JSON object only.";
    return await groqCallJsonStrict({ ...args, systemText: hardenedSystem, userText: hardenedUser });
  }
}
