import { createContext, useContext } from "react";
import { QUALITY, type QualityConfig } from "./tiers.js";

const QualityContext = createContext<QualityConfig>(QUALITY.high);

export const QualityProvider = QualityContext.Provider;

/** Current effective quality config (tier + reduced-motion already applied). */
export function useQuality(): QualityConfig {
  return useContext(QualityContext);
}
