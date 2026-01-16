import YahooFinance from "yahoo-finance2";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  calculateExpectedMoveRange,
  calculateGammaAdjustedExpectedPrice,
  calculatePriceProbabilities,
  calculateSentiment,
  findTrueGammaFlip,
  generateRecommendations,
  processOption,
  VOLATILITY_TRIGGER_RATIO,
  type OptionDataInput,
  type ProcessedOption,
  type PriceProbability,
  type Recommendation,
} from "../api/analysis/metrics.js";

dayjs.extend(utc);
dayjs.extend(timezone);

type QuotePoint = {
  date: string;
  close: number;
};

type ExpirationSnapshot = {
  expirationDate: Date;
  calls: OptionDataInput[];
  puts: OptionDataInput[];
};

type ExpirationAnalysis = {
  date: string;
  isoDate: string;
  callResistance: number;
  putSupport: number;
  gammaFlip: number;
  volTrigger: number;
  callGex: number;
  putGex: number;
  totalGex: number;
  pcrFiltered: number;
  sentiment: number;
  expectedUpper: number;
  expectedLower: number;
  expectedPrice: number;
  priceProbability: PriceProbability;
  options: ProcessedOption[];
};

type DailyAnalysis = {
  date: string;
  price: number;
  status: Recommendation;
  sentiment: number;
  upProb: number;
};

type PerformanceSummary = {
  trades: number;
  winRate: number;
  avgReturn: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  mdd: number;
};

type TimeframeResult = {
  label: string;
  start: string;
  end: string;
  samples: number;
  metricsBySignal: Record<string, Record<number, PerformanceSummary>>;
  roc: Record<string, Record<number, { auc: number | null; brier: number | null; samples: number }>>;
};

const yahooFinance = new YahooFinance({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
});

const parseArgs = () => {
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const direct = args.find((arg) => arg.startsWith(`--${name}=`));
    if (direct) return direct.split("=").slice(1).join("=");
    const idx = args.indexOf(`--${name}`);
    if (idx !== -1 && args[idx + 1]) return args[idx + 1];
    return undefined;
  };

  const months = Number(getArg("months") || 24);
  const start = getArg("start");
  const end = getArg("end");
  const horizons =
    getArg("horizons")?.split(",").map((v) => Number(v.trim())) || [1, 3, 5];
  const expCount = Number(getArg("exp-count") || 5);
  const maxExpirations = Number(getArg("max-expirations") || 12);
  const output = getArg("output") || "reports/backtest-qqq.md";

  return {
    months,
    start,
    end,
    horizons,
    expCount,
    maxExpirations,
    output,
  };
};

const buildQuotes = (
  quotes: { date: Date; close?: number | null; adjclose?: number | null }[]
): QuotePoint[] => {
  return quotes
    .map((q) => ({
      date: dayjs(q.date).utc().format("YYYY-MM-DD"),
      close: Number(q.adjclose ?? q.close ?? 0),
    }))
    .filter((q) => isFinite(q.close) && q.close > 0);
};

const fetchExpirationSnapshots = async (
  expirationDates: Date[]
): Promise<ExpirationSnapshot[]> => {
  const snapshots: ExpirationSnapshot[] = [];
  for (const expirationDate of expirationDates) {
    const details = await yahooFinance.options("QQQ", { date: expirationDate });
    const expirationData = details?.options?.[0];
    if (!expirationData) continue;
    snapshots.push({
      expirationDate,
      calls: (expirationData.calls || []).map((opt) => ({
        ...opt,
        expiration: expirationDate,
      })) as OptionDataInput[],
      puts: (expirationData.puts || []).map((opt) => ({
        ...opt,
        expiration: expirationDate,
      })) as OptionDataInput[],
    });
  }
  return snapshots;
};

const buildExpirationAnalysis = ({
  spot,
  date,
  snapshot,
}: {
  spot: number;
  date: string;
  snapshot: ExpirationSnapshot;
}): ExpirationAnalysis | null => {
  const filterRange = 0.1;
  const currentPrice = spot;
  const expDateStr = dayjs(snapshot.expirationDate).utc().format("YYYY-MM-DD");
  const expDateObj = dayjs
    .tz(expDateStr, "America/New_York")
    .hour(16)
    .minute(0)
    .second(0);
  const baseDateObj = dayjs.tz(date, "America/New_York").hour(16).minute(0).second(0);

  const timeToExpiration = expDateObj.diff(baseDateObj, "year", true);
  if (!isFinite(timeToExpiration) || timeToExpiration <= 0) return null;

  const filteredCallsRaw = snapshot.calls.filter(
    (opt) =>
      opt.strike > currentPrice * (1 - filterRange) &&
      opt.strike < currentPrice * (1 + filterRange)
  );
  const filteredPutsRaw = snapshot.puts.filter(
    (opt) =>
      opt.strike > currentPrice * (1 - filterRange) &&
      opt.strike < currentPrice * (1 + filterRange)
  );
  if (filteredCallsRaw.length === 0 && filteredPutsRaw.length === 0) {
    return null;
  }

  const calls = filteredCallsRaw.map((opt) =>
    processOption(opt as OptionDataInput, "call", currentPrice, timeToExpiration)
  );
  const puts = filteredPutsRaw.map((opt) =>
    processOption(opt as OptionDataInput, "put", currentPrice, timeToExpiration)
  );

  const filteredCallOI = calls.reduce((acc, opt) => acc + (opt.openInterest || 0), 0);
  const filteredPutOI = puts.reduce((acc, opt) => acc + (opt.openInterest || 0), 0);

  const callOptions = calls.filter((c) => c.strike >= currentPrice);
  const callWall =
    callOptions.length > 0
      ? callOptions.reduce((p, c) => ((c.openInterest ?? 0) > (p.openInterest ?? 0) ? c : p), callOptions[0])
          .strike
      : currentPrice * 1.02;

  const putOptions = puts.filter((p) => p.strike <= currentPrice);
  const putWall =
    putOptions.length > 0
      ? putOptions.reduce((p, c) => ((c.openInterest ?? 0) > (p.openInterest ?? 0) ? c : p), putOptions[0])
          .strike
      : currentPrice * 0.98;

  const callGex = calls.reduce((acc, opt) => acc + (opt.gex || 0), 0);
  const putGex = puts.reduce((acc, opt) => acc + (opt.gex || 0), 0);
  const totalGex = callGex + putGex;

  const sentiment = calculateSentiment(callGex, putGex);
  const gammaFlip = findTrueGammaFlip([...calls, ...puts], currentPrice, timeToExpiration);
  const volTrigger = gammaFlip * VOLATILITY_TRIGGER_RATIO;

  const priceProbability = calculatePriceProbabilities({
    calls,
    puts,
    filteredCallOI,
    filteredPutOI,
  });

  const { expectedUpper, expectedLower } = calculateExpectedMoveRange({
    currentPrice,
    calls,
    puts,
    timeToExpiration,
  });

  const realisticSupport = Math.max(putWall, expectedLower);
  const realisticResistance = Math.min(callWall, expectedUpper);
  const rangeMid = (realisticSupport + realisticResistance) / 2;
  const rangeHalf = (realisticResistance - realisticSupport) / 2;
  const expectedPrice = calculateGammaAdjustedExpectedPrice({
    rangeMid,
    rangeHalf,
    sentiment,
    gammaFlip,
    totalGex,
  });

  return {
    date: expDateStr.split("-").slice(1).join("/"),
    isoDate: expDateObj.toISOString(),
    callResistance: callWall,
    putSupport: putWall,
    gammaFlip,
    volTrigger,
    callGex,
    putGex,
    totalGex,
    pcrFiltered: filteredCallOI > 0 ? filteredPutOI / filteredCallOI : 0,
    sentiment,
    expectedUpper,
    expectedLower,
    expectedPrice,
    priceProbability,
    options: [...calls, ...puts],
  };
};

const calculateWeightedLevel = (
  items: ExpirationAnalysis[],
  key: "putSupport" | "callResistance" | "expectedLower" | "expectedUpper",
  referenceDate: string
) => {
  let wSum = 0;
  let vSum = 0;
  const nowTs = dayjs.tz(referenceDate, "America/New_York").valueOf();
  for (const r of items) {
    const t = Math.max(
      (dayjs(r.isoDate).tz("America/New_York").valueOf() - nowTs) /
        (1000 * 60 * 60 * 24 * 365),
      1 / 365
    );
    const w = 1 / Math.sqrt(t);
    wSum += w;
    vSum += r[key] * w;
  }
  return vSum / wSum;
};

const getStatus = (price: number, recommendations: Recommendation[]): Recommendation => {
  return (
    recommendations.find((rec) => price >= rec.min && price < rec.max) ||
    recommendations[recommendations.length - 1]
  );
};

const computePerformance = (returns: number[]): PerformanceSummary => {
  if (returns.length === 0) {
    return {
      trades: 0,
      winRate: 0,
      avgReturn: 0,
      avgWin: 0,
      avgLoss: 0,
      expectancy: 0,
      mdd: 0,
    };
  }

  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r <= 0);
  const winRate = wins.length / returns.length;
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;

  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const r of returns) {
    equity *= 1 + r;
    if (equity > peak) peak = equity;
    const drawdown = (equity - peak) / peak;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  }

  return {
    trades: returns.length,
    winRate,
    avgReturn,
    avgWin,
    avgLoss,
    expectancy,
    mdd: maxDrawdown,
  };
};

const computeAuc = (scores: number[], labels: number[]): number | null => {
  const pairs = scores.map((score, idx) => ({ score, label: labels[idx] }));
  const positives = pairs.filter((p) => p.label === 1);
  const negatives = pairs.filter((p) => p.label === 0);
  if (positives.length === 0 || negatives.length === 0) return null;

  let wins = 0;
  let ties = 0;
  for (const pos of positives) {
    for (const neg of negatives) {
      if (pos.score > neg.score) wins += 1;
      else if (pos.score === neg.score) ties += 1;
    }
  }
  return (wins + ties * 0.5) / (positives.length * negatives.length);
};

const computeBrier = (scores: number[], labels: number[]): number | null => {
  if (scores.length === 0) return null;
  const mse =
    scores.reduce((acc, score, idx) => acc + Math.pow(score - labels[idx], 2), 0) /
    scores.length;
  return mse;
};

const formatPercent = (value: number) => `${(value * 100).toFixed(2)}%`;

const run = async () => {
  const { months, start, end, horizons, expCount, maxExpirations, output } = parseArgs();
  const endDate = end ? dayjs(end) : dayjs();
  const startDate = start ? dayjs(start) : endDate.subtract(months, "month");

  const chart = await yahooFinance.chart("QQQ", {
    period1: startDate.format("YYYY-MM-DD"),
    period2: endDate.format("YYYY-MM-DD"),
    interval: "1d",
  });

  const quotes = buildQuotes(chart.quotes || []);
  if (quotes.length === 0) {
    throw new Error("No historical price data returned from Yahoo Finance.");
  }

  const optionChain = await yahooFinance.options("QQQ");
  const expirationDates = (optionChain?.expirationDates || [])
    .map((d) => new Date(d as Date))
    .sort((a, b) => a.getTime() - b.getTime())
    .slice(0, Math.max(expCount, maxExpirations));

  const snapshots = await fetchExpirationSnapshots(expirationDates);
  const snapshotMap = new Map(
    snapshots.map((snapshot) => [snapshot.expirationDate.toISOString(), snapshot])
  );

  const horizonsSorted = [...new Set(horizons.filter((h) => h > 0))].sort((a, b) => a - b);
  const analyses: DailyAnalysis[] = [];
  const labelsByHorizon = new Map<number, number[]>();
  const upScoresByHorizon = new Map<number, number[]>();
  const sentimentScoresByHorizon = new Map<number, number[]>();

  for (const horizon of horizonsSorted) {
    labelsByHorizon.set(horizon, []);
    upScoresByHorizon.set(horizon, []);
    sentimentScoresByHorizon.set(horizon, []);
  }

  for (let i = 0; i < quotes.length; i++) {
    const { date, close: price } = quotes[i];
    const expCandidates = expirationDates.filter((d) =>
      dayjs(d).utc().isAfter(dayjs(date).utc().subtract(1, "day"))
    );
    const targetExpirations = expCandidates.slice(0, expCount);
    const results = targetExpirations
      .map((expDate) => snapshotMap.get(expDate.toISOString()))
      .filter((snapshot): snapshot is ExpirationSnapshot => Boolean(snapshot))
      .map((snapshot) => buildExpirationAnalysis({ spot: price, date, snapshot }))
      .filter((result): result is ExpirationAnalysis => Boolean(result));

    if (results.length === 0) continue;

    const aggSupport = calculateWeightedLevel(results, "putSupport", date);
    const aggResistance = calculateWeightedLevel(results, "callResistance", date);
    const aggExpLower = calculateWeightedLevel(results, "expectedLower", date);
    const aggExpUpper = calculateWeightedLevel(results, "expectedUpper", date);

    const realisticSupport = Math.max(aggSupport, aggExpLower);
    const realisticResistance = Math.min(aggResistance, aggExpUpper);

    const allOptions = results.flatMap((r) => r.options);
    const globalGammaFlip = findTrueGammaFlip(allOptions, price, 0.1);
    const globalVolTrigger = globalGammaFlip * VOLATILITY_TRIGGER_RATIO;
    if (!isFinite(globalVolTrigger)) continue;

    const recommendations = generateRecommendations(realisticSupport, realisticResistance, price);
    const status = getStatus(price, recommendations);

    const front = results[0];
    const sentiment = front.sentiment;
    const upProb = front.priceProbability.up / 100;

    analyses.push({
      date,
      price,
      status,
      sentiment,
      upProb,
    });

    for (const horizon of horizonsSorted) {
      const future = quotes[i + horizon];
      if (!future) continue;
      const label = future.close > price ? 1 : 0;
      labelsByHorizon.get(horizon)?.push(label);
      upScoresByHorizon.get(horizon)?.push(upProb);
      sentimentScoresByHorizon
        .get(horizon)
        ?.push(Math.max(0, Math.min(1, (sentiment + 100) / 200)));
    }
  }

  const timeframes = [
    { label: "6M", start: endDate.subtract(6, "month") },
    { label: "12M", start: endDate.subtract(12, "month") },
    { label: "24M", start: endDate.subtract(24, "month") },
  ];

  const resultsByTimeframe: TimeframeResult[] = [];

  for (const timeframe of timeframes) {
    const startStr = timeframe.start.format("YYYY-MM-DD");
    const endStr = endDate.format("YYYY-MM-DD");
    const slice = analyses.filter((a) => a.date >= startStr && a.date <= endStr);
    const metricsBySignal: TimeframeResult["metricsBySignal"] = {};
    const roc: TimeframeResult["roc"] = {};

    const signalGroups = {
      "Strong Buy": slice.filter((a) => a.status.status === "Strong Buy"),
      Buy: slice.filter((a) => a.status.status === "Buy"),
      "Strong Buy + Buy": slice.filter(
        (a) => a.status.status === "Strong Buy" || a.status.status === "Buy"
      ),
    };

    for (const [signalName, signalRows] of Object.entries(signalGroups)) {
      metricsBySignal[signalName] = {};
      for (const horizon of horizonsSorted) {
        const returns: number[] = [];
        for (const row of signalRows) {
          const idx = quotes.findIndex((q) => q.date === row.date);
          const future = quotes[idx + horizon];
          if (!future) continue;
          returns.push(future.close / row.price - 1);
        }
        metricsBySignal[signalName][horizon] = computePerformance(returns);
      }
    }

    for (const horizon of horizonsSorted) {
      const labels = labelsByHorizon.get(horizon) || [];
      const upScores = upScoresByHorizon.get(horizon) || [];
      const sentimentScores = sentimentScoresByHorizon.get(horizon) || [];

      const aucUp = computeAuc(upScores, labels);
      const brierUp = computeBrier(upScores, labels);
      const aucSent = computeAuc(sentimentScores, labels);
      const brierSent = computeBrier(sentimentScores, labels);

      if (!roc.UpProb) roc.UpProb = {};
      if (!roc.Sentiment) roc.Sentiment = {};

      roc.UpProb[horizon] = { auc: aucUp, brier: brierUp, samples: labels.length };
      roc.Sentiment[horizon] = { auc: aucSent, brier: brierSent, samples: labels.length };
    }

    resultsByTimeframe.push({
      label: timeframe.label,
      start: startStr,
      end: endStr,
      samples: slice.length,
      metricsBySignal,
      roc,
    });
  }

  const lines: string[] = [];
  lines.push("# QQQ Backtest Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Period: ${startDate.format("YYYY-MM-DD")} ~ ${endDate.format("YYYY-MM-DD")}`);
  lines.push(`Horizons: ${horizonsSorted.join(", ")} trading days`);
  lines.push(`Expiration windows: ${expCount} (max loaded ${expirationDates.length})`);
  lines.push("");
  lines.push("## Data limitations");
  lines.push(
    "- Yahoo Finance does not provide historical option chain snapshots."
  );
  lines.push(
    "- This report uses current option chains with historical prices (proxy backtest)."
  );
  lines.push(
    "- Results are illustrative only; do not treat as tradeable statistics."
  );
  lines.push("");

  for (const timeframe of resultsByTimeframe) {
    lines.push(`## Performance (${timeframe.label})`);
    lines.push(`Date range: ${timeframe.start} ~ ${timeframe.end}`);
    lines.push("");
    for (const horizon of horizonsSorted) {
      lines.push(`### Horizon: +${horizon} trading days`);
      lines.push("");
      lines.push(
        "| Signal | Trades | Win Rate | Avg Return | Avg Win | Avg Loss | Expectancy | MDD |"
      );
      lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
      for (const [signalName, horizonMap] of Object.entries(timeframe.metricsBySignal)) {
        const metrics = horizonMap[horizon];
        if (!metrics || metrics.trades === 0) {
          lines.push(`| ${signalName} | 0 | - | - | - | - | - | - |`);
          continue;
        }
        lines.push(
          `| ${signalName} | ${metrics.trades} | ${formatPercent(metrics.winRate)} | ${formatPercent(
            metrics.avgReturn
          )} | ${formatPercent(metrics.avgWin)} | ${formatPercent(metrics.avgLoss)} | ${formatPercent(
            metrics.expectancy
          )} | ${formatPercent(metrics.mdd)} |`
        );
      }
      lines.push("");
    }

    lines.push("### Predictive Metrics");
    lines.push("");
    lines.push("| Metric | Horizon | Samples | ROC AUC | Brier Score |");
    lines.push("| --- | ---: | ---: | ---: | ---: |");
    for (const horizon of horizonsSorted) {
      const up = timeframe.roc.UpProb?.[horizon];
      const sent = timeframe.roc.Sentiment?.[horizon];
      if (up) {
        lines.push(
          `| UpProb | ${horizon} | ${up.samples} | ${
            up.auc === null ? "N/A" : up.auc.toFixed(3)
          } | ${up.brier === null ? "N/A" : up.brier.toFixed(3)} |`
        );
      }
      if (sent) {
        lines.push(
          `| Sentiment | ${horizon} | ${sent.samples} | ${
            sent.auc === null ? "N/A" : sent.auc.toFixed(3)
          } | ${sent.brier === null ? "N/A" : sent.brier.toFixed(3)} |`
        );
      }
    }
    lines.push("");
  }

  const outputPath = path.resolve(output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, lines.join("\n"));
  console.log(`Report written to ${outputPath}`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
