export const ASSET_TABS = ["QQQ", "GLD", "SLV", "VXX", "UVXY", "BTC"] as const;

export const API_SYMBOL_MAP: Record<(typeof ASSET_TABS)[number], string> = {
  QQQ: "QQQ",
  GLD: "GLD",
  SLV: "SLV",
  VXX: "VXX",
  UVXY: "UVXY",
  BTC: "IBIT",
};
