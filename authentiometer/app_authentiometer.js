import { $, show, setStatus, setError, pretty, renderSummary, togglePassword } from "./ui.js";
import { StorageKeys, getBool, setBool, getStr, setStr, del } from "./storage.js";
import {
  Limits,
  buildOptions,
  systemRulesText,
  buildAnalyzeUserPrompt,
  geminiExtractSystem,
  geminiExtractUserPrompt,
  buildCondenseSystem,
  buildCondenseUserPrompt
} from "./prompts.js";
import { geminiListModels, geminiCallJsonWithRetry } from "./providers_gemini.js";
import { groqListModels, groqCallJsonWithRetry } from "./providers_groq.js";

function mode() { return $("mode").value; }
function lang() { return $("uiLang").value; }

function isValidYouTubeUrl(url) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url || "");
}

function readKeys() {
  return {
    gemini: $("geminiKey").value.trim(),
    groq: $("groqKey").value.trim()
  };
}

function applyIntroVisibility() {
  const hide = getBool(StorageKeys.hideIntro, false);
  show($("introCard"), !hide);
  $("hideIntroChk").checked = hide;
}

function applyRememberedKeysToUI() {
  const remG = getBool(StorageKeys.rememberGemini, false);
  const remR = getBool(StorageKeys.rememberGroq, false);
  $("rememberGemini").checked = remG;
  $("rememberGroq").checked = remR;
  if (remG) $("geminiKey").value = getStr(StorageKeys.geminiKey, "");
  if (remR) $("groqKey").value = getStr(StorageKeys.groqKey, "");
}

function persistKeysIfOptIn() {
  if ($("rememberGemini").checked) setStr(StorageKeys.geminiKey, $("geminiKey").value.trim());
  if ($("rememberGroq").checked) setStr(StorageKeys.groqKey, $("groqKey").value.trim());
  setBool(StorageKeys.rememberGemini, $("rememberGemini").checked);
  setBool(StorageKeys.rememberGroq, $("rememberGroq").checked);
}

function populateSelect(selectEl, models) {
  selectEl.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = models.length ? "— Choisis un modèle —" : "— Aucun modèle —";
  selectEl.appendChild(ph);

  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    selectEl.appendChild(opt);
  }
  if (models.length) selectEl.value = models[0];
}

function selectedGeminiModel() { return $("modelsGemini").value; }
function selectedGroqModel() { return $("modelsGroq").value; }

function updateModeUX() {
  const m = mode();
  show($("groqTextBlock"), m === "groq");
  $("modelsHint").textContent =
    m === "gemini"
      ? "Mode Gemini : charge les modèles Gemini, choisis un modèle, puis analyse une URL YouTube."
      : "Mode Groq : charge les modèles Groq, choisis un modèle, colle un texte, puis analyse.";
}

function openHelp() {
  const d = $("helpDialog");
  if (typeof d.showModal === "function") d.showModal();
  else alert("Aide: ce navigateur ne supporte pas <dialog>.");
}

function closeHelp() {
  const d = $("helpDialog");
  if (typeof d.close === "function") d.close();
}

// --------- Long content handling (béton) ---------
async function condenseIfNeeded({ provider, apiKey, model, text, langCode }) {
  if (!text) return { finalText: "", notes: [], limitations: [] };

  // Hard stop if the user pasted something massive
  if (text.length > Limits.maxUserTextChars) {
    throw new Error(
      langCode === "fr"
        ? `Texte trop long (${text.length} caractères). Colle un résumé plus court (<= ${Limits.maxUserTextChars}).`
        : `Text too long (${text.length} chars). Please paste a shorter summary (<= ${Limits.maxUserTextChars}).`
    );
  }

  // If analysis text too long -> condense to target
  if (text.length <= Limits.maxAnalysisTextChars) {
    return { finalText: text, notes: [], limitations: [] };
  }

  const systemText = buildCondenseSystem(langCode);
  const userText = buildCondenseUserPrompt({ lang: langCode, text, targetChars: Limits.condensedTargetChars });

  setStatus(langCode === "fr" ? "Texte long → condensation…" : "Long text → condensing…");

  if (provider === "gemini") {
    const out = await geminiCallJsonWithRetry({
      apiKey,
      model,
      systemText,
      userText
    });
    return {
      finalText: out.condensedText || "",
      notes: [out.notes].filter(Boolean),
      limitations: (out.limitations || []).filter(Boolean)
    };
  } else {
    const out = await groqCallJsonWithRetry({
      apiKey,
      model,
      systemText,
      userText
    });
    return {
      finalText: out.condensedText || "",
      notes: [out.notes].filter(Boolean),
      limitations: (out.limitations || []).filter(Boolean)
    };
  }
}

// Gemini extraction using "video file part" approach
async function geminiExtractFromYouTube({ apiKey, model, langCode, youtubeUrl }) {
  const parts = [
    // The robust way: pass YouTube URL as file_data (video).
    { file_data: { mime_type: "video/mp4", file_uri: youtubeUrl } },
    { text: geminiExtractUserPrompt(langCode, youtubeUrl) }
  ];

  const out = await geminiCallJsonWithRetry({
    apiKey,
    model,
    systemText: geminiExtractSystem(langCode),
    userText: "",
    parts
  });

  // If blocked/none -> return empty but with limitations
  const transcriptText = (out.transcriptText || "").trim();

  // Enforce max extraction size even if model misbehaves
  const clipped = transcriptText.length > Limits.maxExtractedTextChars
    ? transcriptText.slice(0, Limits.maxExtractedTextChars)
    : transcriptText;

  return {
    access: out.access || "partial",
    coverage: out.coverage || (clipped ? "partial" : "none"),
    transcriptText: clipped,
    notes: out.notes || "",
    limitations: (out.limitations || []).filter(Boolean)
  };
}

// --------- Main analysis flows ---------
async function runGemini() {
  const langCode = lang();
  const youtubeUrl = $("youtubeUrl").value.trim();
  const { gemini: apiKey } = readKeys();
  if (!apiKey) throw new Error(langCode === "fr" ? "Clé Gemini manquante." : "Missing Gemini API key.");
  if (!youtubeUrl) throw new Error(langCode === "fr" ? "URL YouTube requise." : "YouTube URL required.");
  if (!isValidYouTubeUrl(youtubeUrl)) throw new Error(langCode === "fr" ? "URL YouTube invalide." : "Invalid YouTube URL.");

  const model = selectedGeminiModel();
  if (!model) throw new Error(langCode === "fr" ? "Choisis un modèle Gemini." : "Select a Gemini model.");

  persistKeysIfOptIn();

  setStatus(langCode === "fr" ? "Étape 1/2 : extraction du texte…" : "Step 1/2: extracting text…");

  const extracted = await geminiExtractFromYouTube({ apiKey, model, langCode, youtubeUrl });

  // If no usable text, stop cleanly with clear message (béton)
  if (!extracted.transcriptText) {
    $("usedText").textContent = "(aucun texte extrait)";
    throw new Error(
      langCode === "fr"
        ? "Impossible d’extraire le contenu (vidéo trop longue, restrictions, ou accès partiel). Essaie une autre vidéo ou utilise le mode Groq + texte."
        : "Unable to extract content (too long, restricted, or partial access). Try another video or use Groq + text mode."
    );
  }

  // Condense if needed (belt-and-suspenders)
  const condensed = await condenseIfNeeded({
    provider: "gemini",
    apiKey,
    model,
    text: extracted.transcriptText,
    langCode
  });

  $("usedText").textContent = condensed.finalText || "(vide)";

  setStatus(langCode === "fr" ? "Étape 2/2 : analyse Authentiometer…" : "Step 2/2: Authentiometer analysis…");

  const options = buildOptions();
  const systemText = systemRulesText(langCode);
  const userText = buildAnalyzeUserPrompt({
    lang: langCode,
    options,
    youtubeUrl,
    transcriptText: condensed.finalText
  });

  const analyzed = await geminiCallJsonWithRetry({
    apiKey,
    model,
    systemText,
    userText
  });

  // Merge limitations (without changing schema)
  const lim = new Set([...(analyzed.limitations || [])]);
  for (const x of extracted.limitations || []) lim.add(x);
  for (const x of condensed.limitations || []) lim.add(x);
  if (extracted.coverage === "partial") lim.add(langCode === "fr" ? "Texte partiel (couverture partielle de la vidéo)." : "Partial text coverage of the video.");
  if (condensed.finalText && condensed.finalText.length < extracted.transcriptText.length) lim.add(langCode === "fr" ? "Texte condensé avant analyse (perte de détails possible)." : "Text was condensed before analysis (possible detail loss).");
  analyzed.limitations = Array.from(lim).slice(0, 25);

  return analyzed;
}

async function runGroq() {
  const langCode = lang();
  const youtubeUrl = $("youtubeUrl").value.trim(); // optional context
  const freeText = $("freeText").value || "";
  const { groq: apiKey } = readKeys();
  if (!apiKey) throw new Error(langCode === "fr" ? "Clé Groq manquante." : "Missing Groq API key.");

  const model = selectedGroqModel();
  if (!model) throw new Error(langCode === "fr" ? "Choisis un modèle Groq." : "Select a Groq model.");

  persistKeysIfOptIn();

  if (!freeText.trim()) {
    throw new Error(
      langCode === "fr"
        ? "En mode Groq, colle un texte (transcription/résumé)."
        : "In Groq mode, please paste some text (transcript/summary)."
    );
  }

  const condensed = await condenseIfNeeded({
    provider: "groq",
    apiKey,
    model,
    text: freeText,
    langCode
  });

  $("usedText").textContent = condensed.finalText || "(vide)";

  setStatus(langCode === "fr" ? "Analyse Authentiometer (Groq)…" : "Authentiometer analysis (Groq)…");

  const options = buildOptions();
  const systemText = systemRulesText(langCode);
  const userText = buildAnalyzeUserPrompt({
    lang: langCode,
    options,
    youtubeUrl,
    transcriptText: condensed.finalText
  });

  const analyzed = await groqCallJsonWithRetry({
    apiKey,
    model,
    systemText,
    userText
  });

  // Merge limitations
  const lim = new Set([...(analyzed.limitations || [])]);
  for (const x of condensed.limitations || []) lim.add(x);
  if (condensed.finalText && condensed.finalText.length < freeText.length) lim.add(langCode === "fr" ? "Texte condensé avant analyse (perte de détails possible)." : "Text was condensed before analysis (possible detail loss).");
  analyzed.limitations = Array.from(lim).slice(0, 25);

  return analyzed;
}

// --------- Wire UI ---------
async function loadGeminiModels() {
  setError("");
  const apiKey = $("geminiKey").value.trim();
  if (!apiKey) { setError(lang() === "fr" ? "Colle la clé Gemini." : "Paste Gemini key."); return; }
  persistKeysIfOptIn();

  setStatus(lang() === "fr" ? "Chargement modèles Gemini…" : "Loading Gemini models…");
  const models = await geminiListModels(apiKey);
  populateSelect($("modelsGemini"), models);
  setStatus(models.length ? "OK ✅" : "Aucun modèle Gemini.", models.length ? "ok" : "info");
}

async function loadGroqModels() {
  setError("");
  const apiKey = $("groqKey").value.trim();
  if (!apiKey) { setError(lang() === "fr" ? "Colle la clé Groq." : "Paste Groq key."); return; }
  persistKeysIfOptIn();

  setStatus(lang() === "fr" ? "Chargement modèles Groq…" : "Loading Groq models…");
  const models = await groqListModels(apiKey);
  populateSelect($("modelsGroq"), models);
  setStatus(models.length ? "OK ✅" : "Aucun modèle Groq.", models.length ? "ok" : "info");
}

async function analyze() {
  setError("");
  setStatus(lang() === "fr" ? "Préparation…" : "Preparing…");
  $("rawJson").textContent = "{}";
  $("summary").innerHTML = "";
  $("usedText").textContent = "(vide)";

  try {
    const out = (mode() === "gemini") ? await runGemini() : await runGroq();
    $("rawJson").textContent = pretty(out);
    renderSummary(out);
    setStatus(lang() === "fr" ? "Terminé ✅" : "Done ✅", "ok");
  } catch (e) {
    setStatus("");
    setError(String(e?.message || e));
  }
}

function clearAll() {
  $("youtubeUrl").value = "";
  $("freeText").value = "";
  $("rawJson").textContent = "{}";
  $("summary").innerHTML = "";
  $("usedText").textContent = "(vide)";
  setError("");
  setStatus("");
}

function init() {
  // Intro persistence
  applyIntroVisibility();
  $("hideIntroChk").addEventListener("change", () => {
    setBool(StorageKeys.hideIntro, $("hideIntroChk").checked);
    applyIntroVisibility();
  });

  // Help modal
  $("helpBtn").addEventListener("click", openHelp);
  $("closeHelp").addEventListener("click", closeHelp);

  // Password toggles
  $("toggleGeminiKey").addEventListener("click", () => togglePassword($("geminiKey")));
  $("toggleGroqKey").addEventListener("click", () => togglePassword($("groqKey")));

  // Remember keys
  applyRememberedKeysToUI();
  $("rememberGemini").addEventListener("change", persistKeysIfOptIn);
  $("rememberGroq").addEventListener("change", persistKeysIfOptIn);
  $("geminiKey").addEventListener("input", () => { if ($("rememberGemini").checked) persistKeysIfOptIn(); });
  $("groqKey").addEventListener("input", () => { if ($("rememberGroq").checked) persistKeysIfOptIn(); });

  $("forgetGemini").addEventListener("click", () => {
    del(StorageKeys.geminiKey);
    setBool(StorageKeys.rememberGemini, false);
    $("rememberGemini").checked = false;
    $("geminiKey").value = "";
    setStatus(lang() === "fr" ? "Clé Gemini oubliée." : "Gemini key cleared.");
  });

  $("forgetGroq").addEventListener("click", () => {
    del(StorageKeys.groqKey);
    setBool(StorageKeys.rememberGroq, false);
    $("rememberGroq").checked = false;
    $("groqKey").value = "";
    setStatus(lang() === "fr" ? "Clé Groq oubliée." : "Groq key cleared.");
  });

  // Mode UI
  $("mode").addEventListener("change", () => {
    updateModeUX();
    clearAll();
    setStatus(lang() === "fr" ? "Mode changé." : "Mode changed.");
  });
  updateModeUX();

  // Load models
  $("loadGeminiModels").addEventListener("click", () => loadGeminiModels().catch(err => setError(String(err?.message || err))));
  $("loadGroqModels").addEventListener("click", () => loadGroqModels().catch(err => setError(String(err?.message || err))));

  // Actions
  $("analyzeBtn").addEventListener("click", analyze);
  $("clearBtn").addEventListener("click", clearAll);
}

init();
