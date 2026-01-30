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
  callWallOI?: number; // Call Wall의 OI
  putWallOI?: number; // Put Wall의 OI
  gammaFlip: number;
  volTrigger: number;
  callGex: number;
  putGex: number;
  totalGex: number;
  pcrAll: number;
  pcrFiltered: number;
  sentiment: number;
  profitPotential: number;
  expectedPrice: number;
  priceProbability: {
    up: number;
    down: number;
    neutral: number;
  };
  expectedUpper: number;
  expectedLower: number;
  vix?: number | null; // VIX 지수 추가
  trapWarning?: {
    isNearCallWall: boolean;
    putOIDominance: boolean;
    message: string;
  }; // 트랩 경고
  oiChange?: {
    callWallOIChange: number | null;
    putWallOIChange: number | null;
    totalCallOIChange: number | null;
    totalPutOIChange: number | null;
  }; // 전일 대비 OI 변화율
  volumeOIRatio?: {
    callWall: number;
    putWall: number;
    totalCall: number;
    totalPut: number;
  }; // Volume/OI 비율
}

export interface IBZone {
  high: number;
  low: number;
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

export interface SegmentedTrend {
  startDate: string;
  endDate: string;
  startPrice: number;
  endPrice: number;
  direction: "상승" | "하락" | "횡보";
  description: string;
}

export interface SentimentRoadmap {
  date: string;
  sentiment: number;
  label: string;
  timeLabel: string;
}

export interface AnalysisResult {
  symbol?: string;
  currentPrice: number;
  changePercent?: number;
  dataTimestamp?: string;
  nasdaqFuturesPrice?: number | null;
  qqqToNasdaqFuturesRatio?: number | null;
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
  segmentedTrends?: SegmentedTrend[];
  sentimentRoadmap?: SentimentRoadmap[];
  ibZone?: IBZone | null; // IB 영역 (장 시작 30분 고점/저점)
}

export interface TickerTimeSeriesData {
  date: string;
  isoDate: string;
  expectedSupport: number;
  expectedResistance: number;
  expectedUpper: number;
  expectedLower: number;
  profitPotential: number;
  sentiment: number;
  totalGex: number;
  expectedPrice?: number;
  priceProbability: {
    up: number;
    down: number;
    neutral: number;
  };
}

export interface TickerAnalysis {
  symbol: string;
  currentPrice: number;
  beta: number;
  expectedSupport: number;
  expectedResistance: number;
  expectedMin: number;
  expectedMax: number;
  expectedPrice?: number;
  changePercent: number;
  timeSeries?: TickerTimeSeriesData[];
  swingScenarios?: SwingScenario[];
  segmentedTrends?: SegmentedTrend[];
  sentimentRoadmap?: SentimentRoadmap[];
  trendForecast?: TrendForecast[];
}

export interface TickerOptionExpirationList {
  symbol: string;
  expirations: string[];
}

export interface TickerOptionChainSummary {
  callOi: number;
  putOi: number;
  callVolume: number;
  putVolume: number;
  pcr: number;
  callWall: number | null;
  putWall: number | null;
  avgIv: number | null;
  spotPrice: number | null;
}

export interface TickerOptionRow {
  strike: number;
  lastPrice: number;
  openInterest: number;
  volume: number;
  impliedVolatility: number;
  inTheMoney: boolean;
}

export interface TickerOptionChain {
  symbol: string;
  expirationDate: string;
  summary: TickerOptionChainSummary;
  calls: TickerOptionRow[];
  puts: TickerOptionRow[];
  links: {
    overview: string;
    expiration: string;
  };
}

export const fetchTickerAnalysis = async (
  symbol: string,
  benchmarkSymbol: string,
  qqqPrice: number,
  qqqSupport: number,
  qqqResistance: number,
  qqqMin: number,
  qqqMax: number,
  months: number = 3,
  qqqTimeSeries?: TimeSeriesData[],
  qqqSwingScenarios?: SwingScenario[],
  qqqSegmentedTrends?: SegmentedTrend[],
  qqqSentimentRoadmap?: SentimentRoadmap[],
  qqqTrendForecast?: TrendForecast[]
): Promise<TickerAnalysis> => {
  const response = await fetch(`/api/ticker-analysis`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      symbol,
      benchmarkSymbol,
      qqqPrice,
      qqqSupport,
      qqqResistance,
      qqqMin,
      qqqMax,
      months,
      qqqTimeSeries,
      qqqSwingScenarios,
      qqqSegmentedTrends,
      qqqSentimentRoadmap,
      qqqTrendForecast,
    }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "티커 분석 실패");
  }
  return response.json();
};

export const fetchAnalysisData = async (
  symbol: string = "QQQ"
): Promise<AnalysisResult> => {
  try {
    const response = await fetch(
      `/api/analysis?symbol=${encodeURIComponent(symbol)}`
    );
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

export const fetchTickerOptionExpirations = async (
  symbol: string,
  type: "daily" | "weekly" | "monthly"
): Promise<TickerOptionExpirationList> => {
  const response = await fetch(
    `/api/ticker-options/expirations?symbol=${encodeURIComponent(
      symbol
    )}&type=${type}`
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "옵션 만기일 조회 실패");
  }
  return response.json();
};

export const fetchTickerOptionChain = async (
  symbol: string,
  date: string,
  type: "daily" | "weekly" | "monthly"
): Promise<TickerOptionChain> => {
  const response = await fetch(
    `/api/ticker-options/expiration?symbol=${encodeURIComponent(
      symbol
    )}&date=${encodeURIComponent(date)}&type=${type}`
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "옵션 체인 조회 실패");
  }
  return response.json();
};
