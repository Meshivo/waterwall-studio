const readOptionalUrl = (key: string, fallback: string) => {
  const value = import.meta.env[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

/**
 * Public creator links are supplied at build time. Missing links are omitted
 * instead of pointing visitors at guessed or placeholder destinations.
 */
export const CREATOR_LINKS = {
  github: readOptionalUrl("VITE_MESHIVO_GITHUB", "https://github.com/Meshivo"),
  telegram: readOptionalUrl("VITE_MESHIVO_TELEGRAM", "https://t.me/Meshivo"),
  website: readOptionalUrl("VITE_MESHIVO_WEBSITE", "https://meshivo.link"),
  email: readOptionalUrl("VITE_MESHIVO_EMAIL", "meshivo@proton.me"),
};
