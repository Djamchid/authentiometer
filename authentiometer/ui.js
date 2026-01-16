export const $ = (id) => document.getElementById(id);

export function show(el, yes) {
  el.classList.toggle("hidden", !yes);
}

export function setStatus(msg, kind = "info") {
  const el = $("status");
  el.textContent = msg || "";
  el.className = kind === "ok" ? "muted ok" : "muted";
}

export function setError(msg) {
  $("err").textContent = msg || "";
}

export function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

export function safeJsonParse(s) {
  const t = (s || "").trim();
  if (!t.startsWith("{") || !t.endsWith("}")) throw new Error("Response is not a JSON object");
  return JSON.parse(t);
}

export function renderSummary(out) {
  const tp = out?.trustProfile;
  const ru = out?.recommendedUse;

  const lines = [];
  const pill = (x) => `<span class="pill">${x}</span>`;

  if (tp?.authenticity) lines.push(`<div><b>Authenticity</b> : ${tp.authenticity.verdict} ${pill(tp.authenticity.confidence)}</div>`);
  if (tp?.factChecking) lines.push(`<div><b>Fact-checking</b> : ${tp.factChecking.verdict} ${pill(tp.factChecking.confidence)}</div>`);
  if (tp?.scientificSoundness) lines.push(`<div><b>Scientific soundness</b> : ${tp.scientificSoundness.verdict} ${pill(tp.scientificSoundness.confidence)}</div>`);

  if (ru) {
    lines.push(`<hr/>`);
    lines.push(`<div><b>Usage recommandé</b></div>`);
    lines.push(`<div>• Témoignage : ${pill(ru.testimonial)}</div>`);
    lines.push(`<div>• Décision factuelle : ${pill(ru.factualDecision)}</div>`);
    lines.push(`<div>• Apprentissage scientifique : ${pill(ru.scienceLearning)}</div>`);
  }

  $("summary").innerHTML = lines.join("\n") || `<div class="muted">Aucun résumé disponible.</div>`;
}

export function togglePassword(inputEl) {
  inputEl.type = inputEl.type === "password" ? "text" : "password";
}
