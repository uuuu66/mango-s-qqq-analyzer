export interface OptionData {
  strike: number;
  type: "call" | "put";
  lastPrice: number;
  change: number;
  percentChange: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  expiration: Date;
  gamma?: number;
  gex?: number;
}

export interface AnalysisResult {
  currentPrice: number;
  options: OptionData[];
  callResistance: number;
  putSupport: number;
  totalGex: number;
  recommendations: {
    status: string;
    description: string;
    priceRange: string;
    color: string;
  }[];
}

export const fetchQQQData = async (): Promise<AnalysisResult> => {
  try {
    // Vercel serverless function endpoint
    const response = await fetch("/api/analysis");
    if (!response.ok) {
      throw new Error("Failed to fetch from server");
    }
    const data = await response.json();

    // Convert expiration strings back to Date objects
    data.options = data.options.map((option: unknown) => ({
      ...(option as {
        strike: number;
        type: "call" | "put";
        lastPrice: number;
        change: number;
        percentChange: number;
        volume: number;
        openInterest: number;
        impliedVolatility: number;
        expiration: string;
        gamma?: number;
        gex?: number;
      }),
      expiration: new Date((option as { expiration: string }).expiration),
    }));

    return data;
  } catch (error) {
    console.error("Error fetching QQQ data:", error);
    throw error;
  }
};
