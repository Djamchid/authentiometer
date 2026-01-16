// ===================
// Authentiometer (no-backend)
// - Dynamic models: Gemini + Groq
// - LocalStorage API keys (opt-in)
// - Gemini: "YouTube URL as video file part" + 2-step pipeline:
//    1) extract/transcript-like text
//    2) Authentiometer analysis on extracted text
// - Groq: analyze free text only
// ===================

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

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

function safeJsonParse(s) {
  const t = (s || "").trim();
  if (!t.startsWith("{") || !t.endsWith("}")) throw new Error("Response is not a JSON object");
  return JSON.parse(t);
}

function buildOptions() {
  return {
    includeAuthenticity: $("optAuth").checked,
    includeFactChecking: $("optFact").checked,
    includeScientificSoundness: $("optSci").checked,
    cautiousMode: $("optCautious").checked
  };
}

function getMode() {
  return $("mode").value; // gemini | groq
}

function getLang() {
  return $("uiLang").value; // fr | en
}

function getStorageKeyForMode(mode) {
  return mode === "gemini" ? "authentiometer_gemini_api_key" : "authentiometer_groq_api_key";
}

function applyRememberCheckboxFromStorage(mode) {
  const k = getStorageKeyForMode(mode);
  const has = !!localStorage.getItem(k);
  // If stored, we pre-fill and mark checkbox on
  if (has) {
    $("apiKey").value = localStorage.getItem(k) || "";
    $("rememberKey").checked = true;
  } else {
    $("rememberKey").checked = false;
  }
}

function persistKeyIfWanted(mode) {
  const remember = $("rememberKey").checked;
  const k = getStorageKeyForMode(mode);
  if (remember) localStorage.setItem(k, $("apiKey").value.trim());
  else localStorage.removeItem(k);
}

function forgetKey(mode) {
  const k = getStorageKeyForMode(mode);
  localStorage.removeItem(k);
  $("rememberKey").checked = false;
  $("apiKey").value = "";
}

// ---------- Rendering ----------
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

// ---------- Prompting ----------
function systemRulesText(lang) {
  const langLine = lang === "fr"
    ? "You MUST write all user-facing strings in French."
    : "You MUST write all user-facing strings in English.";

  return `
You are Authentiometer, an epistemic decision-support tool for viewers analyzing a single YouTube video.

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

function buildAnalyzePrompt({ lang, options, videoMeta, youtubeUrl, transcriptText }) {
  const inputObj = {
    options,
    videoMeta: {
      title: videoMeta.title || "",
      description: videoMeta.description || "",
      channelTitle: videoMeta.channelTitle || "",
      publishedAt: videoMeta.publishedAt || "",
      url: youtubeUrl || ""
    },
    transcriptText: transcriptText || ""
  };

  const instruction = lang === "fr"
    ? "Analyse le contenu ci-dessous selon la charte Authentiometer."
    : "Analyze the content below following the Authentiometer charter.";

  return `
${instruction}

INPUT:
${JSON.stringify(inputObj, null, 2)}

${userSchemaText()}
  `.trim();
}

// Gemini Step 1: "Extract transcript-like text"
function geminiExtractSystem(lang) {
  const langLine = lang === "fr"
    ? "You MUST write all user-facing strings in French."
    : "You MUST write all user-facing strings in English.";

  return `
You are a video-to-text extractor for a YouTube video.

${langLine}

RULES:
- Output MUST be valid JSON only.
- Do NOT invent timestamps or quotes. Only output what you can actually extract from the video.
- If you cannot access the video's content (permissions/region/restrictions), say so.
- Try to extract a transcript-like text. If full transcript is not possible, extract a dense "content text" capturing the spoken content.
- Keep transcriptText under 12000 characters. Prefer content density over narration.
  `.trim();
}

function geminiExtractUser(lang, youtubeUrl) {
  const schema = `
OUTPUT JSON SCHEMA (MUST MATCH KEYS EXACTLY):
{
  "access": "ok|partial|blocked",
  "contentLanguage": "string",
  "coverage": "full|partial|none",
  "transcriptText": "string",
  "keyQuotes": ["string"],
  "notes": "string",
  "limitations": ["string"]
}
CONSTRAINTS:
- transcriptText: max 12000 characters.
- keyQuotes: 0 to 8 items; each quote max 180 chars.
- No extra keys.
  `.trim();

  const instruction = lang === "fr"
    ? `Extrais le contenu parlé/texte de cette vidéo YouTube. Si tu ne peux pas obtenir une transcription complète, fournis un texte dense basé sur le contenu réellement accessible.`
    : `Extract spoken content/text from this YouTube video. If full transcript is not possible, provide dense content text from what you can access.`;

  return `
${instruction}

YouTube URL:
${youtubeUrl}

${schema}
  `.trim();
}

// ---------- Models loading ----------
async function listGeminiModels(apiKey) {
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models";
  const resp = await fetch(endpoint, {
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

  // Prefer newer flash/pro; you can tweak ranking later
  models.sort((a, b) => {
    const score = (x) =>
      (x.includes("flash") ? 0 : 10) +
      (x.includes("pro") ? 1 : 5) +
      (x.includes("preview") ? 9 : 0);
    return score(a) - score(b);
  });

  return models;
}

async function listGroqModels(apiKey) {
  // Groq supports OpenAI-compatible models endpoint
  const endpoint = "https://api.groq.com/openai/v1/models";
  const resp = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Groq ListModels HTTP ${resp.status}: ${t.slice(0, 400)}`);
  }
  const data = await resp.json();
  const models = (data.data || [])
    .map(m => m.id)
    .filter(Boolean);

  // Keep only likely chat-capable models (heuristic)
  const filtered = models.filter(id =>
    /llama|mistral|gemma|qwen|guard/i.test(id)
  );

  filtered.sort((a, b) => a.localeCompare(b));
  return filtered.length ? filtered : models.sort((a, b) => a.localeCompare(b));
}

function populateModels(models, { keepValue = true } = {}) {
  const select = $("modelChoice");
  const prev = select.value;

  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = models.length ? "— Choisis un modèle —" : "— Aucun modèle trouvé —";
  select.appendChild(placeholder);

  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    select.appendChild(opt);
  }

  if (keepValue && prev && models.includes(prev)) select.value = prev;
  else if (models.length) select.value = models[0];
  else select.value = "";
}

// ---------- Providers ----------
async function callGeminiGenerateContent({ apiKey, model, body }) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

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
    throw new Error(`Gemini HTTP ${resp.status}: ${t.slice(0, 900)}`);
  }
  return await resp.json();
}

function geminiTextFromResponse(data) {
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ?? "";
}

async function callGeminiJsonStrict({ apiKey, model, systemText, userText, parts }) {
  // If parts provided, use them; else use userText as plain text part.
  const contentsParts = parts?.length
    ? parts
    : [{ text: userText }];

  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: "user", parts: contentsParts }],
    generationConfig: { temperature: 0.2 }
  };

  const data = await callGeminiGenerateContent({ apiKey, model, body });
  const text = geminiTextFromResponse(data);
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
    throw new Error(`Groq HTTP ${resp.status}: ${t.slice(0, 900)}`);
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
    const hardenedUser = (args.userText || "") + "\n\nREMINDER: Output MUST be a single JSON object only.";

    return await fn({ ...args, systemText: hardenedSystem, userText: hardenedUser });
  }
}

// ---------- Core flows ----------
function updateModeUI() {
  const mode = getMode();
  show($("groqTextBlock"), mode === "groq");

  $("modelsHint").textContent =
    mode === "gemini"
      ? "Mode Gemini: colle la clé, clique 'Charger modèles', puis choisis un modèle."
      : "Mode Groq: colle la clé, clique 'Charger modèles', puis choisis un modèle.";

  // Prefill remembered key if present
  applyRememberCheckboxFromStorage(mode);
}

function getSelectedModelOrThrow() {
  const model = $("modelChoice").value;
  if (!model) throw new Error("Choisis un modèle (clique d’abord “Charger modèles”).");
  return model;
}

function isValidYouTubeUrl(url) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url || "");
}

async function geminiExtractTextFromYouTube({ apiKey, model, lang, youtubeUrl }) {
  // Pass YouTube URL as a video file part (file_data).
  // This is the “béton” part: do NOT rely on plain text URL.
  const parts = [
    { file_data: { mime_type: "video/mp4", file_uri: youtubeUrl } },
    { text: geminiExtractUser(lang, youtubeUrl) }
  ];

  const out = await callWithJsonRetry(callGeminiJsonStrict, {
    apiKey,
    model,
    systemText: geminiExtractSystem(lang),
    userText: "",   // not used because we pass parts
    parts
  });

  return out;
}

async function geminiAnalyzeAuthentiometer({ apiKey, model, lang, options, youtubeUrl, transcriptText }) {
  const videoMeta = { title: "", description: "", channelTitle: "", publishedAt: "" };
  const systemText = systemRulesText(lang);
  const userText = buildAnalyzePrompt({ lang, options, videoMeta, youtubeUrl, transcriptText });

  const out = await callWithJsonRetry(callGeminiJsonStrict, {
    apiKey,
    model,
    systemText,
    userText
  });

  return out;
}

async function groqAnalyzeAuthentiometer({ apiKey, model, lang, options, youtubeUrl, freeText }) {
  const videoMeta = { title: "", description: "", channelTitle: "", publishedAt: "" };
  const systemText = systemRulesText(lang);

  const transcriptText = freeText || "";
  const userText = buildAnalyzePrompt({ lang, options, videoMeta, youtubeUrl, transcriptText });

  const out = await callWithJsonRetry(callGroqJsonStrict, {
    apiKey,
    model,
    systemText,
    userText
  });

  return out;
}

// ---------- Event handlers ----------
$("mode").addEventListener("change", () => {
  updateModeUI();
  // Clear models on mode switch to avoid mismatches
  populateModels([]);
  $("extractedText").textContent = "(vide)";
  $("rawJson").textContent = "{}";
  $("summary").innerHTML = "";
  setError("");
  setStatus("Mode changé. Charge les modèles.");
});

$("toggleKey").addEventListener("click", () => {
  const input = $("apiKey");
  const btn = $("toggleKey");
  if (input.type === "password") { input.type = "text"; btn.textContent = "🙈 Masquer"; }
  else { input.type = "password"; btn.textContent = "👁️ Afficher"; }
});

$("rememberKey").addEventListener("change", () => {
  persistKeyIfWanted(getMode());
});

$("apiKey").addEventListener("input", () => {
  // If remember checked, keep updated
  if ($("rememberKey").checked) persistKeyIfWanted(getMode());
});

$("forgetKeyBtn").addEventListener("click", () => {
  forgetKey(getMode());
  setStatus("Clé oubliée.");
});

$("clearBtn").addEventListener("click", () => {
  $("youtubeUrl").value = "";
  $("freeText").value = "";
  $("rawJson").textContent = "{}";
  $("summary").innerHTML = "";
  $("extractedText").textContent = "(vide)";
  setError("");
  setStatus("Effacé.");
});

$("loadModelsBtn").addEventListener("click", async () => {
  setError("");
  setStatus("Chargement des modèles…");

  const mode = getMode();
  const apiKey = $("apiKey").value.trim();
  if (!apiKey) { setStatus(""); setError("Colle d’abord la clé API."); return; }

  try {
    persistKeyIfWanted(mode);

    if (mode === "gemini") {
      const models = await listGeminiModels(apiKey);
      populateModels(models);
      setStatus(models.length ? `Gemini ✅ ${models.length} modèles chargés.` : "Gemini: aucun modèle trouvé.", models.length ? "ok" : "info");
    } else {
      const models = await listGroqModels(apiKey);
      populateModels(models);
      setStatus(models.length ? `Groq ✅ ${models.length} modèles chargés.` : "Groq: aucun modèle trouvé.", models.length ? "ok" : "info");
    }
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
  $("extractedText").textContent = "(vide)";

  const mode = getMode();
  const lang = getLang();
  const apiKey = $("apiKey").value.trim();
  const youtubeUrl = $("youtubeUrl").value.trim();
  const options = buildOptions();
  const freeText = $("freeText").value || "";

  if (!apiKey) { setStatus(""); setError("Clé API manquante."); return; }
  persistKeyIfWanted(mode);

  let model;
  try { model = getSelectedModelOrThrow(); }
  catch (e) { setStatus(""); setError(String(e?.message || e)); return; }

  try {
    if (mode === "gemini") {
      if (!youtubeUrl) throw new Error("En mode Gemini, l’URL YouTube est requise.");
      if (!isValidYouTubeUrl(youtubeUrl)) throw new Error("URL YouTube invalide (youtube.com / youtu.be).");

      setStatus(`Étape 1/2: extraction du texte depuis la vidéo (Gemini: ${model})…`);

      const extracted = await geminiExtractTextFromYouTube({
        apiKey,
        model,
        lang,
        youtubeUrl
      });

      const transcriptText = (extracted?.transcriptText || "").trim();
      $("extractedText").textContent =
        transcriptText ? transcriptText : "(aucun texte extrait)";

      // If blocked/none, still attempt analysis but it should be honest about limitations
      setStatus(`Étape 2/2: analyse Authentiometer (Gemini: ${model})…`);

      const analyzed = await geminiAnalyzeAuthentiometer({
        apiKey,
        model,
        lang,
        options,
        youtubeUrl,
        transcriptText
      });

      // Merge some extraction limitations into final output (without changing schema: append into limitations if present)
      try {
        if (Array.isArray(analyzed.limitations)) {
          const add = []
            .concat(extracted?.limitations || [])
            .concat(extracted?.notes ? [extracted.notes] : [])
            .filter(Boolean);

          // de-dupe
          const merged = Array.from(new Set([...analyzed.limitations, ...add]));
          analyzed.limitations = merged.slice(0, 20);
        }
      } catch {}

      $("rawJson").textContent = pretty(analyzed);
      renderSummary(analyzed);
      setStatus("Terminé ✅", "ok");
      return;
    }

    // Groq mode
    setStatus(`Analyse Authentiometer (Groq: ${model})…`);
    const analyzed = await groqAnalyzeAuthentiometer({
      apiKey,
      model,
      lang,
      options,
      youtubeUrl: youtubeUrl || "",
      freeText
    });

    $("rawJson").textContent = pretty(analyzed);
    renderSummary(analyzed);
    setStatus("Terminé ✅", "ok");
  } catch (e) {
    setStatus("");
    setError(String(e?.message || e));
  }
});

// ---------- Init ----------
updateModeUI();
populateModels([]);
setStatus("Prêt. Colle ta clé, clique “Charger modèles”, puis analyse.");
