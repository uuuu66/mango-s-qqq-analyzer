export interface OptionData {
  strike: number;
  type: "call" | "put";
  lastPrice: number;
  change: number;
  percentChange: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  expirationDate: Date;
  gamma?: number;
  gex?: number;
}

export interface Recommendation {
  status: string;
  description: string;
  priceRange: string;
  color: string;
  min: number;
  max: number;
}

export interface TimeSeriesData {
  date: string;
  callResistance: number;
  putSupport: number;
  gammaFlip: number;
  volTrigger: number;
  callGex: number;
  putGex: number;
  totalGex: number;
  pcrAll: number;
  pcrFiltered: number;
  sentiment: number;
}

export interface AnalysisResult {
  currentPrice: number;
  options: OptionData[];
  timeSeries: TimeSeriesData[];
  callResistance: number;
  putSupport: number;
  totalNetGEX: string;
  marketRegime: string;
  gammaFlip: number;
  volTrigger: number;
  totalGex: number;
  recommendations: Recommendation[];
}

export const fetchQQQData = async (): Promise<AnalysisResult> => {
  try {
    const response = await fetch("/api/analysis");
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw {
        serverStatus: response.status,
        serverStatusText: response.statusText,
        serverUrl: response.url,
        ...(typeof errorData === "object"
          ? errorData
          : { rawError: errorData }),
      };
    }
    const data = await response.json();

    if (data.options) {
      data.options = data.options.map((option: OptionData) => ({
        ...option,
        expirationDate: new Date(option.expirationDate),
      }));
    }

    return data;
  } catch (error) {
    console.error("Error fetching QQQ data:", error);
    throw error;
  }
};
