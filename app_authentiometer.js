// ---------- UI helpers ----------
const $ = (id) => document.getElementById(id);

function setStatus(msg, kind = "info") {
  const el = $("status");
  el.textContent = msg || "";
  el.className = kind === "ok" ? "ok" : "muted";
}

function setError(msg) {
  $("err").textContent = msg || "";
}

function show(el, yes) {
  el.classList.toggle("hidden", !yes);
}

function safeJsonParse(s) {
  const t = (s || "").trim();
  if (!t.startsWith("{") || !t.endsWith("}")) throw new Error("Response is not a JSON object");
  return JSON.parse(t);
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

function buildOptions() {
  return {
    includeAuthenticity: $("optAuth").checked,
    includeFactChecking: $("optFact").checked,
    includeScientificSoundness: $("optSci").checked,
    cautiousMode: $("optCautious").checked
  };
}

function renderSummary(out) {
  const tp = out?.trustProfile;
  const ru = out?.recommendedUse;

  const lines = [];
  if (tp?.authenticity) {
    lines.push(`<div><b>Authenticity</b> : ${tp.authenticity.verdict} <span class="pill">${tp.authenticity.confidence}</span></div>`);
  }
  if (tp?.factChecking) {
    lines.push(`<div><b>Fact-checking</b> : ${tp.factChecking.verdict} <span class="pill">${tp.factChecking.confidence}</span></div>`);
  }
  if (tp?.scientificSoundness) {
    lines.push(`<div><b>Scientific soundness</b> : ${tp.scientificSoundness.verdict} <span class="pill">${tp.scientificSoundness.confidence}</span></div>`);
  }
  if (ru) {
    lines.push(`<hr/>`);
    lines.push(`<div><b>Usage recommandé</b></div>`);
    lines.push(`<div>• Témoignage : <span class="pill">${ru.testimonial}</span></div>`);
    lines.push(`<div>• Décision factuelle : <span class="pill">${ru.factualDecision}</span></div>`);
    lines.push(`<div>• Apprentissage scientifique : <span class="pill">${ru.scienceLearning}</span></div>`);
  }

  $("summary").innerHTML = lines.join("\n") || `<div class="muted">Aucun résumé disponible.</div>`;
}

// ---------- Prompt templates ----------
function systemRulesText() {
  return `
You are Authentiometer, an epistemic decision-support tool for viewers analyzing a single YouTube video.

NON-NEGOTIABLE RULES:
- Output MUST be valid JSON only. No markdown, no comments, no trailing text.
- Do NOT claim certainty. Avoid "true/fals" verdicts. Use probabilistic language.
- If you lack evidence, say "uncertain" and explain why.
- Do NOT invent sources, quotes, or timestamps.
- Do NOT browse the web. Use only the information you are given.
- Separate three independent dimensions:
  1) Authenticity (sincerity/performativity signals)
  2) Fact-checking (plausibility of claims; suggest how to verify)
  3) Scientific soundness (reasoning quality; methodological norms)
- Be "declared hybrid":
  - Descriptive layer: what you observe in the provided material.
  - Normative layer: explicit standards for scientific reasoning (correlation vs causation, overgeneralization, cherry-picking, proportional conclusions, uncertainty handling).

SAFETY / FAIRNESS:
- No harassment, no moral judgment of the creator.
- Focus on content-level signals.
- Provide uncertainty and limitations.

Return JSON matching exactly the schema requested by the user message.
  `.trim();
}

function userSchemaText() {
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
- Extract 5 to 10 claims max (in extractedClaims and factChecking.claims).
- Do NOT output any additional keys.
- If an option includeX is false, set the corresponding verdict to "not_assessed" and keep other fields minimal but valid.
- If cautiousMode is true: increase uncertainty; prefer "uncertain" over strong assertions.
- Keep each bullet string short (max ~180 chars).
  `.trim();
}

function buildAnalyzePrompt({ mode, options, videoMeta, youtubeUrl, freeText }) {
  const inputObj = {
    mode,
    options,
    videoMeta: {
      title: videoMeta.title || "",
      description: videoMeta.description || "",
      channelTitle: videoMeta.channelTitle || "",
      publishedAt: videoMeta.publishedAt || "",
      url: youtubeUrl || ""
    },
    transcriptText: freeText || ""
  };

  const contextBlock =
    mode === "gemini"
      ? `Analyze the YouTube video at this URL (use its transcript/content as available to you):\n${youtubeUrl}\n`
      : `YouTube URL context (may help topic):\n${youtubeUrl || "(none)"}\n`;

  return `
${contextBlock}
Analyze the following input. Produce STRICT JSON matching the schema below.

INPUT:
${JSON.stringify(inputObj, null, 2)}

${userSchemaText()}
  `.trim();
}

// ---------- Gemini: ListModels ----------
async function listGeminiModels(apiKey) {
  // Official "Models" endpoint exists in v1beta. :contentReference[oaicite:2]{index=2}
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models";
  const resp = await fetch(endpoint, {
    method: "GET",
    headers: { "x-goog-api-key": apiKey }
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`ListModels HTTP ${resp.status}: ${t.slice(0, 400)}`);
  }

  const data = await resp.json();
  const models = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map(m => (m.name || "").replace(/^models\//, ""))
    .filter(Boolean);

  // Small preference ordering: flash first, then pro (if present)
  models.sort((a, b) => {
    const score = (x) => (x.includes("flash") ? 0 : 10) + (x.includes("pro") ? 1 : 5) + (x.includes("preview") ? 9 : 0);
    return score(a) - score(b);
  });

  return models;
}

function populateGeminiModels(models) {
  const select = $("modelChoice");

  // Remove existing Gemini optgroup (label="Gemini (auto)") and recreate it
  const oldGroups = Array.from(select.querySelectorAll("optgroup"));
  for (const g of oldGroups) {
    if ((g.getAttribute("label") || "").startsWith("Gemini")) g.remove();
  }

  const group = document.createElement("optgroup");
  group.label = "Gemini (auto)";
  if (!models.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— Aucun modèle Gemini disponible (generateContent) —";
    group.appendChild(opt);
  } else {
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      group.appendChild(opt);
    }
  }

  // Insert Gemini group at top
  select.insertBefore(group, select.firstChild);

  // Auto-select first Gemini model if we are in gemini mode
  if ($("mode").value === "gemini" && models.length) {
    select.value = models[0];
  }
}

// ---------- Providers ----------
async function callGeminiJsonStrict({ apiKey, model, systemText, userText }) {
  // Gemini API uses x-goog-api-key header. :contentReference[oaicite:3]{index=3}
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: { temperature: 0.2 }
  };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Gemini HTTP ${resp.status}: ${t.slice(0, 800)}`);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ?? "";
  return safeJsonParse(text);
}

async function callGroqJsonStrict({ apiKey, model, systemText, userText }) {
  const endpoint = "https://api.groq.com/openai/v1/chat/completions";
  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemText },
      { role: "user", content: userText }
    ]
  };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Groq HTTP ${resp.status}: ${t.slice(0, 800)}`);
  }

  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return safeJsonParse(text);
}

async function callWithJsonRetry(fn, args) {
  try {
    return await fn(args);
  } catch (e1) {
    const msg = String(e1?.message || e1);
    if (!/JSON|not a JSON|Unexpected token|Response is not/i.test(msg)) throw e1;

    const hardenedSystem = args.systemText + "\n\nCRITICAL: Output ONLY valid JSON. No extra text. No markdown.";
    const hardenedUser = args.userText + "\n\nREMINDER: Output MUST be a single JSON object only.";

    return await fn({ ...args, systemText: hardenedSystem, userText: hardenedUser });
  }
}

// ---------- Mode / model picking ----------
function pickModelForMode(mode) {
  const choice = $("modelChoice").value;

  if (mode === "gemini") {
    if (!choice) throw new Error("Choisis un modèle Gemini (bouton 'Charger modèles Gemini').");
    return choice;
  }
  // groq
  if (!choice || choice.startsWith("gemini-")) return "llama-3.1-70b-versatile";
  return choice;
}

function updateModeUI() {
  const mode = $("mode").value;
  show($("groqTextBlock"), mode === "groq");
  $("loadModelsBtn").disabled = mode !== "gemini";
  $("modelsHint").textContent = mode === "gemini"
    ? "Clique 'Charger modèles Gemini' après avoir collé la clé."
    : "Mode Groq: sélectionne un modèle Groq dans la liste.";
  $("apiKey").placeholder = mode === "gemini" ? "Clé Gemini (AI Studio)" : "Clé Groq";
}

$("mode").addEventListener("change", updateModeUI);

$("toggleKey").addEventListener("click", () => {
  const input = $("apiKey");
  const btn = $("toggleKey");
  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "🙈 Masquer";
  } else {
    input.type = "password";
    btn.textContent = "👁️ Afficher";
  }
});

$("clearBtn").addEventListener("click", () => {
  $("youtubeUrl").value = "";
  $("apiKey").value = "";
  $("freeText").value = "";
  $("rawJson").textContent = "{}";
  $("summary").innerHTML = "";
  setError("");
  setStatus("");
});

$("loadModelsBtn").addEventListener("click", async () => {
  setError("");
  setStatus("Chargement des modèles Gemini…");
  try {
    const apiKey = $("apiKey").value.trim();
    if (!apiKey) throw new Error("Colle d’abord ta clé Gemini.");

    const models = await listGeminiModels(apiKey);
    populateGeminiModels(models);

    setStatus(models.length ? `OK ✅ ${models.length} modèles Gemini chargés.` : "Aucun modèle Gemini compatible trouvé.", models.length ? "ok" : "info");
  } catch (e) {
    setStatus("");
    setError(String(e?.message || e));
  }
});

$("analyzeBtn").addEventListener("click", async () => {
  setError("");
  setStatus("Préparation…");
  $("summary").innerHTML = "";
  $("rawJson").textContent = "{}";

  const mode = $("mode").value;
  const apiKey = $("apiKey").value.trim();
  const youtubeUrl = $("youtubeUrl").value.trim();
  const freeText = $("freeText").value;
  const options = buildOptions();

  if (!apiKey) { setError("Clé API manquante."); setStatus(""); return; }
  if (!youtubeUrl && mode === "gemini") { setError("En mode Gemini, l’URL YouTube est requise."); setStatus(""); return; }

  const videoMeta = { title: "", description: "", channelTitle: "", publishedAt: "" };
  const systemText = systemRulesText();
  const userText = buildAnalyzePrompt({ mode, options, videoMeta, youtubeUrl, freeText });

  try {
    const model = pickModelForMode(mode);
    setStatus(`Analyse en cours via ${mode === "gemini" ? "Gemini" : "Groq"} (${model})…`);

    const out = mode === "gemini"
      ? await callWithJsonRetry(callGeminiJsonStrict, { apiKey, model, systemText, userText })
      : await callWithJsonRetry(callGroqJsonStrict, { apiKey, model, systemText, userText });

    $("rawJson").textContent = pretty(out);
    renderSummary(out);
    setStatus("Terminé ✅", "ok");
  } catch (e) {
    setStatus("");
    setError(String(e?.message || e));
  }
});

// Init
updateModeUI();
setStatus("Prêt. Colle une clé Gemini puis clique 'Charger modèles Gemini'.");
