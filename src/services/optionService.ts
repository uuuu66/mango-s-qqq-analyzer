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
  isoDate: string;
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
  profitPotential: number;
  priceProbability: {
    up: number;
    down: number;
    neutral: number;
  };
}

export interface SwingScenario {
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  extensionPrice: number;
  profit: number;
  extensionProfit: number;
  probability: number;
  description: string;
}

export interface TrendForecast {
  period: string;
  direction: "상승" | "하락" | "횡보";
  probability: number;
  description: string;
}

export interface AnalysisResult {
  currentPrice: number;
  dataTimestamp?: string;
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
  swingScenarios?: SwingScenario[];
  trendForecast?: TrendForecast[];
}

export interface TickerTimeSeriesData {
  date: string;
  expectedSupport: number;
  expectedResistance: number;
}

export interface TickerAnalysis {
  symbol: string;
  currentPrice: number;
  beta: number;
  expectedSupport: number;
  expectedResistance: number;
  expectedMin: number;
  expectedMax: number;
  changePercent: number;
  timeSeries?: TickerTimeSeriesData[];
  swingScenarios?: SwingScenario[];
}

export const fetchTickerAnalysis = async (
  symbol: string,
  qqqPrice: number,
  qqqSupport: number,
  qqqResistance: number,
  qqqMin: number,
  qqqMax: number,
  months: number = 3,
  qqqTimeSeries?: TimeSeriesData[],
  qqqSwingScenarios?: SwingScenario[]
): Promise<TickerAnalysis> => {
  const response = await fetch(`/api/ticker-analysis`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      symbol,
      qqqPrice,
      qqqSupport,
      qqqResistance,
      qqqMin,
      qqqMax,
      months,
      qqqTimeSeries,
      qqqSwingScenarios,
    }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "티커 분석 실패");
  }
  return response.json();
};

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
