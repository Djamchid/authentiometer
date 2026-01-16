export const StorageKeys = {
  hideIntro: "authentiometer_hide_intro",
  geminiKey: "authentiometer_gemini_api_key",
  groqKey: "authentiometer_groq_api_key",
  rememberGemini: "authentiometer_remember_gemini",
  rememberGroq: "authentiometer_remember_groq",
};

export function getBool(key, fallback = false) {
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  return v === "1";
}

export function setBool(key, value) {
  localStorage.setItem(key, value ? "1" : "0");
}

export function getStr(key, fallback = "") {
  return localStorage.getItem(key) ?? fallback;
}

export function setStr(key, value) {
  localStorage.setItem(key, value);
}

export function del(key) {
  localStorage.removeItem(key);
}
