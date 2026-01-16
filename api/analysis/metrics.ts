import { BlackScholes } from "@uqee/black-scholes";

export const RISK_FREE_RATE = 0.043;
export const DIVIDEND_YIELD = 0.006;
export const VOLATILITY_TRIGGER_RATIO = 0.985;
export const IV_CLAMP_MIN = 0.0001;
export const IV_CLAMP_MAX = 5.0;
export const SCALP_SD_MULTIPLIER = 0.4;

const blackScholes = new BlackScholes();

export interface OptionDataInput {
  strike: number;
  impliedVolatility: number;
  openInterest?: number;
  lastPrice: number;
  change: number;
  percentChange?: number;
  volume?: number;
  expiration: Date;
}

export interface ProcessedOption extends Omit<OptionDataInput, "expiration"> {
  type: "call" | "put";
  gamma: number;
  gex: number;
  expirationDate: Date;
}

export interface PriceProbability {
  up: number;
  down: number;
  neutral: number;
}

export interface Recommendation {
  status: string;
  description: string;
  min: number;
  max: number;
  color: string;
}

export const safeNum = (val: unknown, fallback: number = 0): number => {
  return typeof val === "number" && isFinite(val) ? val : fallback;
};

export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

export const calculateGammaAdjustedExpectedPrice = ({
  rangeMid,
  rangeHalf,
  sentiment,
  gammaFlip,
  totalGex,
}: {
  rangeMid: number;
  rangeHalf: number;
  sentiment: number;
  gammaFlip: number;
  totalGex: number;
}): number => {
  if (!isFinite(rangeHalf) || rangeHalf <= 0) {
    return rangeMid;
  }

  const sentimentBias = (sentiment / 100) * 0.3;
  const gammaBiasRaw = isFinite(gammaFlip)
    ? clamp((gammaFlip - rangeMid) / rangeHalf, -1, 1)
    : 0;
  const gammaSign = totalGex >= 0 ? 1 : -1;
  const gammaBias = gammaBiasRaw * gammaSign * 0.2;

  const combinedBias = clamp(sentimentBias + gammaBias, -0.35, 0.35);
  return rangeMid + rangeHalf * combinedBias;
};

export const calculateImpliedVolatility = (
  targetPrice: number,
  params: {
    strike: number;
    time: number;
    type: "call" | "put";
    underlying: number;
    rate: number;
  }
): number => {
  let sigma = 0.2;
  const maxIterations = 20;
  const precision = 0.0001;

  for (let i = 0; i < maxIterations; i++) {
    const result = blackScholes.option({
      ...params,
      sigma,
    });

    const diff = result.price - targetPrice;
    if (Math.abs(diff) < precision) return sigma;

    const epsilon = 0.001;
    const resultNext = blackScholes.option({
      ...params,
      sigma: sigma + epsilon,
    });
    const vega = (resultNext.price - result.price) / epsilon;

    if (Math.abs(vega) < 0.00001) break;

    sigma = sigma - diff / vega;
    if (sigma <= 0) sigma = 0.0001;
    if (sigma > 5) sigma = 5;
  }

  return sigma;
};

export const processOption = (
  option: OptionDataInput,
  type: "call" | "put",
  spotPrice: number,
  timeToExpiration: number
): ProcessedOption => {
  const strike = Number(option.strike);
  const openInterest =
    Number(option.openInterest) > 0
      ? Math.round(Number(option.openInterest))
      : Number(option.volume) > 0
      ? Math.round(Number(option.volume) * 0.1)
      : 1;

  const adjustedSpot = spotPrice * Math.exp(-DIVIDEND_YIELD * timeToExpiration);
  const ivRaw = option.impliedVolatility;

  let impliedVolatility: number;
  if (typeof ivRaw !== "number" || !isFinite(ivRaw) || ivRaw < 0.001) {
    impliedVolatility = calculateImpliedVolatility(option.lastPrice, {
      strike,
      time: Math.max(timeToExpiration, 0.0001),
      type,
      underlying: adjustedSpot,
      rate: RISK_FREE_RATE,
    });
  } else {
    impliedVolatility = ivRaw;
  }

  impliedVolatility = Math.max(
    IV_CLAMP_MIN,
    Math.min(IV_CLAMP_MAX, impliedVolatility)
  );

  const greekSigma = Math.max(0.1, impliedVolatility);

  let gamma = 0;
  try {
    const result = blackScholes.option({
      rate: RISK_FREE_RATE,
      sigma: greekSigma,
      strike,
      time: Math.max(timeToExpiration, 0.0001),
      type,
      underlying: adjustedSpot,
    });
    gamma = Math.abs(safeNum(result.gamma, 0));
  } catch {
    // gamma = 0
  }

  const gammaExposure = safeNum(
    (type === "call" ? 1 : -1) *
      gamma *
      openInterest *
      100 *
      (spotPrice * spotPrice) *
      0.01,
    0
  );

  return {
    ...option,
    strike,
    impliedVolatility,
    openInterest,
    type,
    gamma,
    gex: gammaExposure,
    expirationDate: option.expiration,
  };
};

export const calculateNetGexAtSpot = (
  options: ProcessedOption[],
  spot: number,
  time: number
): number => {
  return options.reduce((acc, opt) => {
    try {
      const adjustedSpot = spot * Math.exp(-DIVIDEND_YIELD * time);
      const ivRaw = opt.impliedVolatility;
      const sigma =
        typeof ivRaw === "number" && isFinite(ivRaw)
          ? Math.max(0.1, ivRaw)
          : 0.2;

      const result = blackScholes.option({
        rate: RISK_FREE_RATE,
        sigma: sigma,
        strike: opt.strike,
        time: Math.max(time, 0.0001),
        type: opt.type,
        underlying: adjustedSpot,
      });

      const gamma = Math.abs(safeNum(result.gamma, 0));
      const gex =
        (opt.type === "call" ? 1 : -1) *
        gamma *
        (opt.openInterest || 0) *
        100 *
        (spot * spot) *
        0.01;
      return acc + gex;
    } catch {
      return acc;
    }
  }, 0);
};

export const findTrueGammaFlip = (
  options: ProcessedOption[],
  currentSpot: number,
  time: number
): number => {
  if (options.length === 0) return currentSpot;

  const scanRange = 0.1;
  let low = currentSpot * (1 - scanRange);
  let high = currentSpot * (1 + scanRange);

  const gexLow = calculateNetGexAtSpot(options, low, time);
  const gexHigh = calculateNetGexAtSpot(options, high, time);

  if (gexLow * gexHigh > 0) {
    return Math.abs(gexLow) < Math.abs(gexHigh) ? low : high;
  }

  for (let i = 0; i < 15; i++) {
    const mid = (low + high) / 2;
    const gexMid = calculateNetGexAtSpot(options, mid, time);

    if (Math.abs(gexMid) < 0.1) return mid;

    if (gexLow * gexMid <= 0) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return (low + high) / 2;
};

export const calculateSentiment = (callGex: number, putGex: number): number => {
  return Math.abs(callGex) + Math.abs(putGex) > 0
    ? ((callGex + putGex) / (Math.abs(callGex) + Math.abs(putGex))) * 100
    : 0;
};

export const calculatePriceProbabilities = ({
  calls,
  puts,
  filteredCallOI,
  filteredPutOI,
}: {
  calls: ProcessedOption[];
  puts: ProcessedOption[];
  filteredCallOI: number;
  filteredPutOI: number;
}): PriceProbability => {
  const totalCallEnergy = calls.reduce(
    (acc, opt) => acc + Math.max(0, opt.gex),
    0
  );
  const totalPutEnergy = puts.reduce(
    (acc, opt) => acc + Math.abs(Math.min(0, opt.gex)),
    0
  );
  const totalEnergy = totalCallEnergy + totalPutEnergy;

  let upProb = 50;
  let downProb = 50;
  let neutralProb = 0;

  if (totalEnergy > 0.0001) {
    const rawUpProb = (totalCallEnergy / totalEnergy) * 100;
    const rawDownProb = (totalPutEnergy / totalEnergy) * 100;

    neutralProb = Math.max(
      15,
      100 - Math.abs(rawUpProb - rawDownProb) * 1.2 - 10
    );

    const remaining = 100 - neutralProb;
    const ratio = rawUpProb / (rawUpProb + rawDownProb);

    upProb = Math.min(80, remaining * ratio);
    downProb = Math.min(80, remaining * (1 - ratio));
    neutralProb = 100 - upProb - downProb;
  } else if (filteredCallOI + filteredPutOI > 0) {
    const totalOI = filteredCallOI + filteredPutOI;
    upProb = (filteredCallOI / totalOI) * 100;
    downProb = (filteredPutOI / totalOI) * 100;
    neutralProb = 15;

    const remaining = 100 - neutralProb;
    const ratio = upProb / (upProb + downProb);
    upProb = Math.min(80, remaining * ratio);
    downProb = Math.min(80, remaining * (1 - ratio));
    neutralProb = 100 - upProb - downProb;
  }

  return {
    up: Math.round(upProb),
    down: Math.round(downProb),
    neutral: Math.round(neutralProb),
  };
};

export const calculateExpectedMoveRange = ({
  currentPrice,
  calls,
  puts,
  timeToExpiration,
}: {
  currentPrice: number;
  calls: ProcessedOption[];
  puts: ProcessedOption[];
  timeToExpiration: number;
}): { expectedUpper: number; expectedLower: number; avgIv: number } => {
  const nearAtmOptions = [...calls, ...puts].filter(
    (opt) => Math.abs(opt.strike - currentPrice) / currentPrice < 0.05
  );
  const avgIv =
    nearAtmOptions.length > 0
      ? nearAtmOptions.reduce((acc, opt) => acc + opt.impliedVolatility, 0) /
        nearAtmOptions.length
      : 0.25;

  const expectedMove =
    currentPrice *
    avgIv *
    Math.sqrt(Math.max(timeToExpiration, 1 / 365)) *
    SCALP_SD_MULTIPLIER;

  return {
    expectedUpper: currentPrice + expectedMove,
    expectedLower: currentPrice - expectedMove,
    avgIv,
  };
};

export const generateRecommendations = (
  support: number,
  resistance: number,
  currentPrice: number
): Recommendation[] => {
  let low = Math.min(support, resistance);
  let high = Math.max(support, resistance);

  const minWidth = currentPrice * 0.02;
  if (high - low < minWidth) {
    const center = (low + high) / 2;
    low = center - minWidth / 2;
    high = center + minWidth / 2;
  }

  const mid = (low + high) / 2;
  const range = high - low;

  const neutralStart = mid - range * 0.1;
  const neutralEnd = mid + range * 0.1;
  const panicLevel = low * 0.97;

  return [
    {
      status: "Extreme Risk",
      description:
        "Support breakdown: panic risk zone (avoid / wait for base)",
      min: 0,
      max: panicLevel,
      color: "#475569",
    },
    {
      status: "Strong Buy",
      description: "Oversold near support: staged accumulation zone",
      min: panicLevel,
      max: low,
      color: "#22c55e",
    },
    {
      status: "Buy",
      description: "Support to lower neutral: staged buy zone",
      min: low,
      max: neutralStart,
      color: "#86efac",
    },
    {
      status: "Neutral",
      description: "Mid range: wait / hold zone",
      min: neutralStart,
      max: neutralEnd,
      color: "#94a3b8",
    },
    {
      status: "Sell",
      description: "Upper neutral to resistance: staged sell zone",
      min: neutralEnd,
      max: high,
      color: "#fca5a5",
    },
    {
      status: "Strong Sell",
      description: "Above resistance: overheating sell zone",
      min: high,
      max: high + 20,
      color: "#ef4444",
    },
  ];
};
