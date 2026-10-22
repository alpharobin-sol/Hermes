// lib/helpers/risk.ts

export type RiskLevel = "low" | "moderate" | "high";

export interface RiskStats {
  level: RiskLevel;
  label: string;
  colorClass: string;     // Tailwind text color
  bgClass: string;        // Optional: for badge background
}

// The backend riskScore is a safety score: higher means safer
export const getRiskStats = (riskScore: number): RiskStats => {
  const score = Math.max(0, Math.min(100, Math.round(riskScore)));

  if (score >= 67) {
    return {
      level: "low",
      label: "Low Risk",
      colorClass: "text-green-400",
      bgClass: "bg-green-500/20 border border-green-500/30",
    };
  }

  if (score >= 34) {
    return {
      level: "moderate",
      label: "Moderate Risk",
      colorClass: "text-yellow-400",
      bgClass: "bg-yellow-500/20 border border-yellow-500/30",
    };
  }

  return {
    level: "high",
    label: "High Risk",
    colorClass: "text-red-400",
    bgClass: "bg-red-500/20 border border-red-500/30",
  };
};