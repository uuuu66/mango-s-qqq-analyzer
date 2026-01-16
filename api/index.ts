import express, { Request, Response } from "express";
import cors from "cors";
import YahooFinance from "yahoo-finance2";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
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
} from "./analysis/metrics.ts";

// dayjs 설정 (ESM/CJS 호환성을 위해 .js 확장자 명시 권장되는 경우 대응)
dayjs.extend(utc);
dayjs.extend(timezone);

const yahooFinance = new YahooFinance({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
});
const app = express();

app.use(cors());
app.use(express.json());

const formatExpirationDate = (date: Date) =>
  dayjs(date).utc().format("YYYY-MM-DD");

const isThirdFriday = (date: Date) => {
  const d = dayjs(date).utc();
  return d.day() === 5 && d.date() >= 15 && d.date() <= 21;
};

const isWeeklyExpiration = (date: Date) => {
  const d = dayjs(date).utc();
  return d.day() === 5 && !isThirdFriday(date);
};

const isMonthlyExpiration = (date: Date) => {
  const d = dayjs(date).utc();
  return d.day() === 5 && isThirdFriday(date);
};

/**
 * 사용자 지정 기간 히스토리 데이터를 기반으로 베타계수 직접 계산
 */
const calculateManualBeta = async (
  symbol: string,
  benchmarkSymbol: string = "QQQ",
  months: number = 3
): Promise<number> => {
  const now = dayjs().tz("America/New_York");
  const ago = now.subtract(months, "month");

  try {
    // 티커와 벤치마크(QQQ)의 지정 기간 종가 데이터 가져오기
    const period1 = ago.format("YYYY-MM-DD");
    const period2 = now.format("YYYY-MM-DD");

    const [tickerResult, benchmarkResult] = await Promise.all([
      yahooFinance.chart(symbol, {
        period1,
        period2,
        interval: "1d",
      }),
      yahooFinance.chart(benchmarkSymbol, {
        period1,
        period2,
        interval: "1d",
      }),
    ]);

    const tickerQuotes = tickerResult.quotes || [];
    const benchmarkQuotes = benchmarkResult.quotes || [];

    // 날짜별로 매칭되는 데이터 필터링 (adjclose 사용)
    const tickerMap = new Map(
      tickerQuotes.map((q) => [
        q.date.toISOString().split("T")[0],
        q.adjclose ?? q.close ?? undefined,
      ])
    );
    const commonData: { ticker: number; benchmark: number }[] = [];

    benchmarkQuotes.forEach((b) => {
      const dateStr = b.date.toISOString().split("T")[0];
      const tClose = tickerMap.get(dateStr);
      const bClose = b.adjclose ?? b.close ?? undefined;
      if (tClose !== undefined && bClose !== undefined) {
        commonData.push({ ticker: tClose, benchmark: bClose });
      }
    });

    if (commonData.length < 10) return 1.0; // 데이터가 너무 적으면 기본값 (1개월 분석 대응을 위해 20 -> 10으로 하향)

    // 일일 수익률 계산
    const tickerReturns: number[] = [];
    const benchmarkReturns: number[] = [];

    for (let i = 1; i < commonData.length; i++) {
      tickerReturns.push(
        (commonData[i].ticker - commonData[i - 1].ticker) /
          commonData[i - 1].ticker
      );
      benchmarkReturns.push(
        (commonData[i].benchmark - commonData[i - 1].benchmark) /
          commonData[i - 1].benchmark
      );
    }

    // 베타 계산: Cov(r_t, r_b) / Var(r_b)
    const avgB =
      benchmarkReturns.reduce((a, b) => a + b, 0) / benchmarkReturns.length;
    const avgT =
      tickerReturns.reduce((a, b) => a + b, 0) / tickerReturns.length;

    let covariance = 0;
    let varianceB = 0;

    for (let i = 0; i < tickerReturns.length; i++) {
      const diffB = benchmarkReturns[i] - avgB;
      const diffT = tickerReturns[i] - avgT;
      covariance += diffB * diffT;
      varianceB += diffB * diffB;
    }

    return varianceB === 0 ? 1.0 : covariance / varianceB;
  } catch (err) {
    console.error("Manual Beta Calculation Error:", err);
    return 1.0;
  }
};

interface ExpirationAnalysis {
  date: string;
  isoDate: string; // ISO 형식의 전체 날짜 (요일 계산용)
  callResistance: number;
  putSupport: number;
  gammaFlip: number;
  volTrigger: number;
  callGex: number;
  putGex: number;
  totalGex: number;
  pcrAll: number; // 전체 스트라이크 기준
  pcrFiltered: number; // 필터링(±15%) 기준
  sentiment: number;
  profitPotential: number; // 기대 수익률 (%)
  expectedPrice: number; // 예상 종가
  priceProbability: {
    up: number;
    down: number;
    neutral: number;
  };
  options: ProcessedOption[];
  expectedUpper: number; // 1-SD 상단
  expectedLower: number; // 1-SD 하단
}

interface TickerTimeSeriesData {
  date: string;
  isoDate: string;
  expectedSupport: number;
  expectedResistance: number;
  expectedUpper: number;
  expectedLower: number;
  profitPotential: number;
  sentiment: number;
  totalGex: number;
  expectedPrice: number;
  priceProbability: {
    up: number;
    down: number;
    neutral: number;
  };
}

interface TickerAnalysis {
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
  trendForecast?: TrendForecast[]; // ✅ 추가된 필드
}

interface DiagnosticDetail {
  date: string;
  status: string;
  error?: string;
  callsProcessed?: number;
  putsProcessed?: number;
}

interface Diagnostics {
  step: string;
  currentPrice: number | null;
  expirationsCount: number;
  details: DiagnosticDetail[];
  serverLogs: string[]; // 프론트엔드로 보낼 서버 로그 저장용
}

interface SwingScenario {
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number; // Base Target (현실적 목표)
  extensionPrice: number; // Extension Target (최대 목표)
  profit: number; // Base Profit (%)
  extensionProfit: number; // Extension Profit (%)
  probability: number; // 시나리오 성공 확률 (%)
  description: string;
}

interface TrendForecast {
  period: string;
  direction: "상승" | "하락" | "횡보";
  probability: number;
  description: string;
}

interface SegmentedTrend {
  startDate: string;
  endDate: string;
  startPrice: number;
  endPrice: number;
  direction: "상승" | "하락" | "횡보";
  description: string;
}

interface SentimentRoadmap {
  date: string;
  sentiment: number;
  label: string;
  timeLabel: string;
}

interface TickerOptionSummary {
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

interface TickerOptionRow {
  strike: number;
  lastPrice: number;
  openInterest: number;
  volume: number;
  impliedVolatility: number;
  inTheMoney: boolean;
}

app.get("/api/analysis", async (_request: Request, response: Response) => {
  const diagnostics: Diagnostics = {
    step: "init",
    currentPrice: null,
    expirationsCount: 0,
    details: [],
    serverLogs: [],
  };

  const addLog = (msg: string) => {
    console.log(msg);
    diagnostics.serverLogs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  };

  try {
    diagnostics.step = "fetch_quote";
    addLog("QQQ 시세 데이터 가져오는 중...");
    const quote = await yahooFinance.quote("QQQ");
    const currentPrice = quote.regularMarketPrice || 0;
    const dataTimestamp = quote.regularMarketTime
      ? new Date(quote.regularMarketTime).toISOString()
      : new Date().toISOString();
    diagnostics.currentPrice = currentPrice;
    addLog(`현재가: $${currentPrice.toFixed(2)}`);

    diagnostics.step = "fetch_expiration_dates";
    addLog("QQQ 옵션 만기일 목록 가져오는 중...");
    const optionChain = await yahooFinance.options("QQQ");

    if (
      !optionChain ||
      !optionChain.expirationDates ||
      optionChain.expirationDates.length === 0
    ) {
      throw new Error("QQQ 만기일 데이터를 가져오지 못했습니다.");
    }

    const rawExpirationDates = optionChain.expirationDates;
    diagnostics.expirationsCount = rawExpirationDates.length;
    addLog(`총 ${rawExpirationDates.length}개의 만기일 발견`);

    const now = dayjs().tz("America/New_York");
    const todayStart = now.startOf("day");
    const filterLimit = todayStart.add(30, "day");

    // ✅ 진단 로그 강화
    const buildVersion = "2026-01-13-v3";
    addLog(`[System] Version: ${buildVersion}`);
    addLog(`[System] NY Current: ${now.format("YYYY-MM-DD HH:mm:ss")}`);

    const targetExpirations = rawExpirationDates
      .filter((d) => {
        // ✅ Yahoo의 d는 UTC 자정입니다. 이를 문자열로 변환하여 뉴욕 오늘 날짜와 직접 비교합니다.
        const expStr = dayjs(d).utc().format("YYYY-MM-DD");
        const todayStr = now.format("YYYY-MM-DD");
        // 과거 날짜(오늘 이전)는 무조건 제외
        return expStr >= todayStr;
      })
      .filter((d) => {
        const expStr = dayjs(d).utc().format("YYYY-MM-DD");
        const limitStr = filterLimit.format("YYYY-MM-DD");
        // 30일 이내 데이터만 우선 타겟팅
        return expStr <= limitStr;
      });

    // 만약 30일 이내 데이터가 너무 적으면, 오늘 이후의 데이터 중 상위 5개를 선택
    const finalExpirations =
      targetExpirations.length >= 5
        ? targetExpirations
        : rawExpirationDates
            .filter(
              (d) =>
                dayjs(d).utc().format("YYYY-MM-DD") >= now.format("YYYY-MM-DD")
            )
            .slice(0, 5);

    diagnostics.step = "process_expirations";
    const results = await Promise.all(
      finalExpirations.map(async (d) => {
        const originalDate = d; // ✅ 야후 API 호출용 원본 객체 보존
        const dateString = String(originalDate);
        try {
          // ✅ 날짜 문자열(YYYY-MM-DD)을 추출하여 뉴욕 시간대의 16:00으로 설정
          // 이렇게 해야 UTC 자정(NY 전날 저녁) 문제를 방지하고 정확한 오늘 만기를 계산합니다.
          const expDateStr = dayjs(originalDate).utc().format("YYYY-MM-DD");
          const dateObj = dayjs
            .tz(expDateStr, "America/New_York")
            .hour(16)
            .minute(0)
            .second(0);

          const details = await yahooFinance.options("QQQ", {
            date: originalDate, // ✅ 야후 API에는 원래의 Date 객체 전달
          });

          const expirationData = details?.options?.[0];

          if (
            !expirationData ||
            (!expirationData.calls?.length && !expirationData.puts?.length)
          ) {
            diagnostics.details.push({ date: dateString, status: "no_data" });
            return null;
          }

          // ✅ 잔존 만기 계산 (0DTE 대응)
          const timeDiff = dateObj.diff(now, "year", true);

          // 이미 만료된 경우 (시간이 마감 시간을 지난 경우) 에너지를 0으로 만들기 위해 아주 작은 값 부여 또는 제외
          const isExpired = timeDiff <= 0;
          const timeToExpiration = isExpired ? 0.000001 : timeDiff;

          // 1) 전체 데이터 기준 PCR 계산 (보정 로직 적용)
          const allCallsRaw = expirationData.calls || [];
          const allPutsRaw = expirationData.puts || [];

          const sumOI = (
            options: {
              openInterest?: number | string;
              volume?: number | string;
            }[]
          ) =>
            options.reduce(
              (acc, opt) =>
                acc +
                (Number(opt.openInterest) ||
                  (opt.volume ? Math.round(Number(opt.volume) * 0.1) : 0) ||
                  1),
              0
            );

          const totalCallOI_All = sumOI(allCallsRaw);
          const totalPutOI_All = sumOI(allPutsRaw);

          const pcrAll =
            totalCallOI_All > 0 ? totalPutOI_All / totalCallOI_All : 0;

          // 2) 정밀 분석용 Moneyness ±10% 이내 필터링 (기존 15%에서 강화)
          const filterRange = 0.1;
          const filteredCallsRaw = allCallsRaw.filter(
            (opt: { strike: number }) =>
              opt.strike > currentPrice * (1 - filterRange) &&
              opt.strike < currentPrice * (1 + filterRange)
          );
          const filteredPutsRaw = allPutsRaw.filter(
            (opt: { strike: number }) =>
              opt.strike > currentPrice * (1 - filterRange) &&
              opt.strike < currentPrice * (1 + filterRange)
          );

          if (filteredCallsRaw.length === 0 && filteredPutsRaw.length === 0) {
            diagnostics.details.push({
              date: dateString,
              status: "filtered_out",
            });
            return null;
          }

          // 옵션 처리 및 GEX 계산
          const calls = filteredCallsRaw.map((opt: unknown) =>
            processOption(
              opt as OptionDataInput,
              "call",
              currentPrice,
              timeToExpiration
            )
          );
          const puts = filteredPutsRaw.map((opt: unknown) =>
            processOption(
              opt as OptionDataInput,
              "put",
              currentPrice,
              timeToExpiration
            )
          );

          // 필터링된 데이터 기준 OI (확률 계산 및 Wall 추출용)
          const filteredCallOI = calls.reduce(
            (acc, opt) => acc + (opt.openInterest || 0),
            0
          );
          const filteredPutOI = puts.reduce(
            (acc, opt) => acc + (opt.openInterest || 0),
            0
          );

          // 3) 주요 매물대(Wall) 추출 - 수량(Open Interest) 및 에너지 복합 분석
          // ✅ Call Wall: 현재가보다 높은 행사가 중 미결제약정(OI)이 가장 큰 지점 (강한 저항선)
          const callOptions = calls.filter((c) => c.strike >= currentPrice);
          const callWall =
            callOptions.length > 0
              ? callOptions.reduce(
                  (p, c) =>
                    (c.openInterest ?? 0) > (p.openInterest ?? 0) ? c : p,
                  callOptions[0]
                ).strike
              : currentPrice * 1.02;

          // ✅ Put Wall: 현재가보다 낮은 행사가 중 미결제약정(OI)이 가장 큰 지점 (강한 지지선)
          const putOptions = puts.filter((p) => p.strike <= currentPrice);
          const putWall =
            putOptions.length > 0
              ? putOptions.reduce(
                  (p, c) =>
                    (c.openInterest ?? 0) > (p.openInterest ?? 0) ? c : p,
                  putOptions[0]
                ).strike
              : currentPrice * 0.98;

          const callGex = calls.reduce((acc, opt) => acc + (opt.gex || 0), 0);
          const putGex = puts.reduce((acc, opt) => acc + (opt.gex || 0), 0);
          const totalGex = callGex + putGex;

          // 심리 지수(Sentiment) 계산
          const sentiment = calculateSentiment(callGex, putGex);

          // 4) 진짜 Gamma Flip (Spot-Scan 방식)
          const gammaFlip = findTrueGammaFlip(
            [...calls, ...puts],
            currentPrice,
            timeToExpiration
          );
          const volTrigger = gammaFlip * VOLATILITY_TRIGGER_RATIO;

          // 5) 옵션 분포 기반 가격 변동 확률 계산
          const priceProbability = calculatePriceProbabilities({
            calls,
            puts,
            filteredCallOI,
            filteredPutOI,
          });

          const pcrFiltered =
            filteredCallOI > 0 ? filteredPutOI / filteredCallOI : 0;

          // 6) 표준편차 기반 기대 변동폭(Expected Move) 산출
          const { expectedUpper, expectedLower } = calculateExpectedMoveRange({
            currentPrice,
            calls,
            puts,
            timeToExpiration,
          });

          // ✅ 진단 로그 추가 (Step 1)
          const zeroGexCalls = calls.filter((c) => c.gex === 0).length;
          const zeroGexPuts = puts.filter((p) => p.gex === 0).length;

          console.log(
            `[EXP] ${dateString} | calls: ${calls.length}, puts: ${
              puts.length
            } | zeroGex: ${zeroGexCalls}/${zeroGexPuts} | callWall: ${callWall.toFixed(
              2
            )}, putWall: ${putWall.toFixed(2)} | flip: ${gammaFlip.toFixed(
              2
            )} | totalGex: ${(totalGex / 1e9).toFixed(2)}B`
          );

          diagnostics.details.push({
            date: dateString,
            status: "success",
            callsProcessed: calls.length,
            putsProcessed: puts.length,
          });

          // 7) 심리 지수 + 감마 플립을 반영한 예상 종가 산출
          // 단순히 중간값이 아니라, 에너지가 쏠린 방향으로 편향(Bias) 부여
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
            date: expDateStr.split("-").slice(1).join("/"), // "MM/DD" 형식으로 직접 추출
            isoDate: dateObj.toISOString(),
            callResistance: callWall,
            putSupport: putWall,
            gammaFlip,
            volTrigger,
            callGex,
            putGex,
            totalGex,
            pcrAll,
            pcrFiltered,
            sentiment,
            profitPotential:
              ((Math.min(callWall, expectedUpper) -
                Math.max(putWall, expectedLower)) /
                Math.max(putWall, expectedLower)) *
              100,
            expectedPrice,
            priceProbability,
            options: [...calls, ...puts],
            expectedUpper,
            expectedLower,
          };
        } catch (e: unknown) {
          diagnostics.details.push({
            date: dateString,
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
          return null;
        }
      })
    );

    const validResults = results.filter(
      (r): r is ExpirationAnalysis => r !== null
    );
    if (validResults.length === 0)
      throw {
        message: "분석 가능한 유효 옵션 데이터가 없습니다.",
        diagnostics,
      };

    // ✅ 가중 평균 레벨 산출 (Step 2)
    // 단일 만기(0DTE 등)에 의존하지 않고, 전체 만기의 레벨을 시간 가중치(1/sqrt(T))로 통합
    const calculateWeightedLevel = (
      items: ExpirationAnalysis[],
      key: "putSupport" | "callResistance" | "expectedLower" | "expectedUpper"
    ) => {
      let wSum = 0;
      let vSum = 0;
      const nowTs = dayjs().tz("America/New_York").valueOf();

      for (const r of items) {
        const t = Math.max(
          (dayjs(r.isoDate).tz("America/New_York").valueOf() - nowTs) /
            (1000 * 60 * 60 * 24 * 365),
          1 / 365
        );
        const w = 1 / Math.sqrt(t); // 가까운 만기일수록 큰 가중치
        wSum += w;
        vSum += r[key] * w;
      }
      return vSum / wSum;
    };

    const aggSupport = calculateWeightedLevel(validResults, "putSupport");
    const aggResistance = calculateWeightedLevel(
      validResults,
      "callResistance"
    );
    const aggExpLower = calculateWeightedLevel(validResults, "expectedLower");
    const aggExpUpper = calculateWeightedLevel(validResults, "expectedUpper");

    // ✅ 현실적인 통합 레벨 (Wall과 1-SD 기대범위의 교집합)
    const realisticSupport = Math.max(aggSupport, aggExpLower);
    const realisticResistance = Math.min(aggResistance, aggExpUpper);

    // ✅ 시장 전체 통합 감마 플립 산출 (피드백 반영: Aggregation Rule 적용)
    // 모든 유효 만기일의 옵션 데이터를 하나로 합쳐 거대한 GEX Profile 생성
    const allOptions = validResults.flatMap((r) => r.options);
    const globalGammaFlip = findTrueGammaFlip(allOptions, currentPrice, 0.1); // 평균적인 시간 가중치 적용
    const globalVolTrigger = globalGammaFlip * VOLATILITY_TRIGGER_RATIO;

    const recommendations = generateRecommendations(
      realisticSupport,
      realisticResistance,
      currentPrice
    );

    // 5) 복합 일자별 스윙 시나리오 도출 (다양한 기간 조합 탐색)
    const swingScenarios: SwingScenario[] = [];
    if (validResults.length >= 2) {
      // 요일 계산 헬퍼
      const getDayName = (isoDate: string) => {
        const days = ["일", "월", "화", "수", "목", "금", "토"];
        try {
          const date = new Date(isoDate);
          return days[date.getDay()];
        } catch {
          return "";
        }
      };

      // 모든 가능한 [진입일 - 청산일] 조합 탐색 (최대 4일 간격까지, 5일 이내 데이터로 제한)
      const combinations: SwingScenario[] = [];
      const scenarioLimit = 5;
      const targetResults = validResults.slice(0, scenarioLimit);

      for (let i = 0; i < targetResults.length; i++) {
        for (let j = i + 1; j < targetResults.length; j++) {
          const entry = targetResults[i];
          const exit = targetResults[j];

          const entryDay = getDayName(entry.isoDate);
          const exitDay = getDayName(exit.isoDate);
          const duration = j - i;

          // ✅ 현실적인 진입/청산가 산출 (Wall과 1-SD 기대값의 보수적 조합)
          // 지지선(entry): Wall과 1-SD 중 현재가에 더 가까운(높은) 값을 선택
          // 저항선(exit): Wall과 1-SD 중 현재가에 더 가까운(낮은) 값을 선택
          const realisticEntry = Math.max(
            entry.putSupport,
            entry.expectedLower
          );
          const realisticExit = Math.min(
            exit.callResistance,
            exit.expectedUpper
          );

          const baseTarget = realisticExit * 0.995; // 현실적인 1차 목표가
          const extensionTarget = realisticExit;

          const profit = ((baseTarget - realisticEntry) / realisticEntry) * 100;
          const extensionProfit =
            ((extensionTarget - realisticEntry) / realisticEntry) * 100;

          // ✅ 시나리오 확률 계산
          // 1) 청산 시점의 상승 확률 반영
          // 2) 진입-청산 간 심리 지수 개선도 반영
          // 3) GEX 에너지 증가 여부 반영
          const sentimentImprovement = exit.sentiment - entry.sentiment;
          const gexTrend = exit.totalGex > entry.totalGex ? 5 : -5;
          let scenarioProb =
            55 +
            sentimentImprovement * 0.4 +
            gexTrend +
            (exit.priceProbability.up - exit.priceProbability.down) * 0.2;

          // 기간이 길어질수록 불확실성 증가 (보정)
          scenarioProb -= duration * 2;
          scenarioProb = Math.round(Math.max(35, Math.min(80, scenarioProb)));

          // 수익률이 0보다 큰 경우만 시나리오에 추가
          if (profit > 0) {
            combinations.push({
              entryDate: `${entry.date}(${entryDay})`,
              exitDate: `${exit.date}(${exitDay})`,
              entryPrice: realisticEntry,
              exitPrice: baseTarget,
              extensionPrice: extensionTarget,
              profit,
              extensionProfit,
              probability: scenarioProb,
              description: `${duration}일 스윙: ${entryDay}요일 진입($${realisticEntry.toFixed(
                2
              )}) → ${exitDay}요일 목표($${baseTarget.toFixed(
                2
              )}) 시나리오 (1-SD 범위 기반)`,
            });
          }
        }
      }

      // 수익률이 높은 상위 3개 시나리오만 선택 (단기 우선 정렬 추가)
      swingScenarios.push(
        ...combinations
          .sort((a, b) => {
            // 확률 70% 이상인 것들을 최우선
            if (a.probability >= 70 && b.probability < 70) return -1;
            if (b.probability >= 70 && a.probability < 70) return 1;
            return b.profit - a.profit;
          })
          .slice(0, 3)
      );
    }
    // ✅ 세부 구간별 상승/하락 추세 도출 (가격 레벨 이동 기준 반영)
    const getPriceLevel = (r: ExpirationAnalysis) =>
      (Math.max(r.putSupport, r.expectedLower) +
        Math.min(r.callResistance, r.expectedUpper)) /
      2;
    // 6) 추세 및 확률 예측 로직
    const trendForecast: TrendForecast[] = [];
    const segmentedTrends: SegmentedTrend[] = [];

    if (validResults.length >= 2) {
      const forecastLimit = 5;
      const first = validResults[0];
      const last =
        validResults[Math.min(validResults.length, forecastLimit) - 1];

      const sentimentDiff = last.sentiment - first.sentiment;

      // 전체 가격 변동 확인
      const lastPriceLevel = getPriceLevel(last);
      const totalRelDiff = (lastPriceLevel - currentPrice) / currentPrice;

      let direction: "상승" | "하락" | "횡보" = "횡보";
      let prob = 50;
      let desc = "";

      // 가격 변동과 심리 지수를 복합하여 전체 추세 결정
      if (totalRelDiff > 0.005 && sentimentDiff > 5) {
        direction = "상승";
        prob = Math.min(65 + sentimentDiff / 2, 80);
        desc =
          "전체적인 가격 레벨이 상승 추세에 있으며, 매수 심리 또한 점진적으로 개선되고 있습니다.";
      } else if (totalRelDiff < -0.005 && sentimentDiff < -5) {
        direction = "하락";
        prob = Math.min(65 + Math.abs(sentimentDiff) / 2, 80);
        desc =
          "전체적인 가격 레벨이 하향 조정 중이며, 매도 압력이 우세한 구간입니다.";
      } else {
        direction = "횡보";
        prob = 70;
        desc =
          "가격 변동폭이 제한적이거나 에너지 방향이 엇갈리고 있어, 박스권 내 힘겨루기가 진행 중입니다.";
      }

      trendForecast.push({
        period: `${first.date} ~ ${last.date}`,
        direction,
        probability: Math.round(prob),
        description: desc,
      });

      const trendPoints = [
        {
          date: "현재",
          price: currentPrice,
          sentiment: validResults[0].sentiment,
        }, // 기준점
        ...validResults.slice(0, 5).map((r) => ({
          date: r.date,
          price: getPriceLevel(r),
          sentiment: r.sentiment,
        })),
      ];

      let currentStartIdx = 0;
      for (let i = 1; i < trendPoints.length; i++) {
        const prev = trendPoints[i - 1];
        const curr = trendPoints[i];

        const priceDiff = curr.price - prev.price;
        const sDiff = curr.sentiment - prev.sentiment;

        let segmentDir: "상승" | "하락" | "횡보" = "횡보";
        // 가격 이동을 최우선으로 판정 (0.1% 이상 변동 시)
        if (priceDiff > currentPrice * 0.001) {
          segmentDir = sDiff > -5 ? "상승" : "횡보"; // 가격은 오르는데 심리가 너무 꺾이면 횡보로 보정
        } else if (priceDiff < -currentPrice * 0.001) {
          segmentDir = sDiff < 5 ? "하락" : "횡보"; // 가격은 내리는데 심리가 살아나면 횡보(눌림목)로 보정
        }

        const isLast = i === trendPoints.length - 1;
        // 다음 지점의 방향 확인 (루프 통합을 위해)
        let nextDir: "상승" | "하락" | "횡보" | null = null;
        if (!isLast) {
          const nextPriceDiff = trendPoints[i + 1].price - curr.price;
          const nextSDiff = trendPoints[i + 1].sentiment - curr.sentiment;
          if (nextPriceDiff > currentPrice * 0.001)
            nextDir = nextSDiff > -5 ? "상승" : "횡보";
          else if (nextPriceDiff < -currentPrice * 0.001)
            nextDir = nextSDiff < 5 ? "하락" : "횡보";
          else nextDir = "횡보";
        }

        if (isLast || segmentDir !== nextDir) {
          segmentedTrends.push({
            startDate:
              trendPoints[currentStartIdx].date === "현재"
                ? "현재"
                : trendPoints[currentStartIdx].date,
            endDate: curr.date,
            startPrice: trendPoints[currentStartIdx].price,
            endPrice: curr.price,
            direction: segmentDir,
            description:
              segmentDir === "상승"
                ? `가격 레벨 상향 및 매수세 강화 구간`
                : segmentDir === "하락"
                ? `가격 레벨 하향 및 매도 압력 구간`
                : `에너지 균형 및 박스권 구간`,
          });
          currentStartIdx = i;
        }
      }
    }

    // ✅ 감마 심리 로드맵 (Sentiment Roadmap) 산출
    const sentimentRoadmap: SentimentRoadmap[] = validResults.map((r, idx) => {
      const score = r.sentiment;
      let label = "혼조/중립";
      if (score > 40) label = "강력한 매수 우위";
      else if (score > 20) label = "상승 강세 전환";
      else if (score > 10) label = "상승 우세 시작";
      else if (score < -40) label = "강력한 매도 우위";
      else if (score < -20) label = "하락 강세 전환";
      else if (score < -10) label = "하락 우세 시작";

      let timeLabel = "";
      if (idx === 0) timeLabel = "오늘";
      else if (idx === 1) timeLabel = "내일/단기";
      else if (idx < 4) timeLabel = "이번 주";
      else if (idx < 7) timeLabel = "다음 주";
      else timeLabel = "중기 전망";

      return {
        date: r.date,
        sentiment: score,
        label,
        timeLabel,
      };
    });

    response.json({
      currentPrice,
      dataTimestamp,
      warning:
        Math.abs(aggSupport - aggResistance) < currentPrice * 0.001
          ? "Support/Resistance collapsed. Check IV or Option data availability."
          : null,
      options: validResults[0].options,
      totalNetGEX: `${(validResults[0].totalGex / 1e9).toFixed(2)}B USD/1%`,
      // 리서치 제언: 가격이 감마 플립보다 위에 있으면 안정(Stabilizing), 아래면 변동(Volatile)
      marketRegime: currentPrice > globalGammaFlip ? "Stabilizing" : "Volatile",
      gammaFlip: globalGammaFlip, // ✅ 통합 글로벌 플립 적용
      volTrigger: globalVolTrigger, // ✅ 통합 글로벌 트리거 적용
      timeSeries: validResults.map((result) => ({
        date: result.date,
        isoDate: result.isoDate,
        callResistance: result.callResistance,
        putSupport: result.putSupport,
        gammaFlip: result.gammaFlip,
        volTrigger: result.volTrigger,
        callGex: result.callGex,
        putGex: result.putGex,
        totalGex: result.totalGex,
        pcrAll: result.pcrAll,
        pcrFiltered: result.pcrFiltered,
        sentiment: result.sentiment,
        profitPotential: result.profitPotential,
        expectedPrice: result.expectedPrice,
        priceProbability: result.priceProbability,
        expectedUpper: result.expectedUpper,
        expectedLower: result.expectedLower,
      })),
      callResistance: aggResistance,
      putSupport: aggSupport,
      totalGex: validResults[0].totalGex,
      recommendations: recommendations.map((rec) => ({
        ...rec,
        priceRange: `${rec.min.toFixed(2)} - ${rec.max.toFixed(2)}`,
      })),
      swingScenarios,
      trendForecast,
      segmentedTrends, // ✅ 추가된 필드
      sentimentRoadmap, // ✅ 추가된 필드
      diagnostics,
    });
  } catch (err: unknown) {
    console.error("Analysis Error:", err);
    const errorMsg = err instanceof Error ? err.message : String(err);

    // 최소한의 응답 보장
    response.status(500).json({
      error: errorMsg,
      diagnostics: diagnostics,
    });
  }
});

/**
 * Yahoo Finance 원본 데이터 TXT 다운로드용
 */
app.get("/api/yahoo-raw", async (_request: Request, response: Response) => {
  try {
    const quote = await yahooFinance.quote("QQQ");
    const optionChain = await yahooFinance.options("QQQ");

    if (!optionChain || !optionChain.expirationDates?.length) {
      return response.status(500).json({ error: "만기일 데이터를 가져오지 못했습니다." });
    }

    const rawExpirationDates = optionChain.expirationDates;
    const now = dayjs().tz("America/New_York");
    const todayStr = now.format("YYYY-MM-DD");
    const filterLimit = now.startOf("day").add(30, "day").format("YYYY-MM-DD");

    const targetExpirations = rawExpirationDates
      .filter((d) => {
        const expStr = dayjs(d).utc().format("YYYY-MM-DD");
        return expStr >= todayStr && expStr <= filterLimit;
      });

    const finalExpirations =
      targetExpirations.length >= 5
        ? targetExpirations
        : rawExpirationDates
            .filter((d) => dayjs(d).utc().format("YYYY-MM-DD") >= todayStr)
            .slice(0, 5);

    const optionsByExpiration = await Promise.all(
      finalExpirations.map(async (d) => {
        const details = await yahooFinance.options("QQQ", { date: d });
        return {
          expirationDate: dayjs(d).utc().format("YYYY-MM-DD"),
          details,
        };
      })
    );

    response.json({
      fetchedAt: new Date().toISOString(),
      quote,
      optionChain,
      optionsByExpiration,
    });
  } catch (err: unknown) {
    console.error("Yahoo Raw Data Error:", err);
    const errorMsg = err instanceof Error ? err.message : String(err);
    response.status(500).json({ error: errorMsg });
  }
});

/**
 * 티커별 베타 기반 기대 지지/저항선 분석 API
 */
app.post("/api/ticker-analysis", async (req: Request, res: Response) => {
  const {
    symbol,
    qqqPrice,
    qqqSupport,
    qqqResistance,
    qqqMin,
    qqqMax,
    months,
    qqqTimeSeries,

    qqqSegmentedTrends,
    qqqSentimentRoadmap,
    qqqTrendForecast, // ✅ 추가된 필드
  } = req.body;

  if (!symbol) {
    return res.status(400).json({ error: "티커 심볼이 필요합니다." });
  }

  try {
    const quote = await yahooFinance.quote(String(symbol));

    if (!quote) {
      return res.status(404).json({ error: "티커 정보를 찾을 수 없습니다." });
    }

    const currentPrice = quote.regularMarketPrice || 0;

    // 1) 지정 기간 히스토리 기반 베타 직접 계산 (사용자 선택 반영)
    const betaMonths = Number(months) || 3;
    const beta = await calculateManualBeta(String(symbol), "QQQ", betaMonths);

    // QQQ 데이터가 쿼리로 오지 않으면 기본 분석 수행 (또는 에러)
    const qPrice = Number(qqqPrice);
    const qSupport = Number(qqqSupport);
    const qResistance = Number(qqqResistance);
    const qMin = Number(qqqMin);
    const qMax = Number(qqqMax);

    if (!qPrice || !qSupport || !qResistance) {
      return res.status(400).json({ error: "QQQ 기준 데이터가 필요합니다." });
    }

    // 베타 보정 공식 적용
    // Expected Target = Current * (1 + Beta * (QQQ Target / QQQ Current - 1))
    const expectedSupport = currentPrice * (1 + beta * (qSupport / qPrice - 1));
    const expectedResistance =
      currentPrice * (1 + beta * (qResistance / qPrice - 1));
    const expectedMin = qMin
      ? currentPrice * (1 + beta * (qMin / qPrice - 1))
      : expectedSupport * 0.97;
    const expectedMax = qMax
      ? currentPrice * (1 + beta * (qMax / qPrice - 1))
      : expectedResistance + 10;

    // ✅ 티커 예상 종가 산출 (QQQ의 첫 번째 만기 예상 종가 기준)
    let tickerExpectedPrice: number | undefined = undefined;
    if (Array.isArray(qqqTimeSeries) && qqqTimeSeries.length > 0) {
      tickerExpectedPrice =
        currentPrice * (1 + beta * (qqqTimeSeries[0].expectedPrice / qPrice - 1));
    }

    // 타임시리즈 계산 (있는 경우)
    let tickerTimeSeries: TickerTimeSeriesData[] | undefined = undefined;
    if (Array.isArray(qqqTimeSeries)) {
      tickerTimeSeries = qqqTimeSeries.map(
        (q: {
          date: string;
          isoDate: string;
          putSupport: number;
          callResistance: number;
          expectedUpper: number;
          expectedLower: number;
          gammaFlip: number;
          sentiment: number;
          totalGex: number;
          expectedPrice: number;
          priceProbability: { up: number; down: number; neutral: number };
        }) => {
          // ✅ 1. QQQ 주요 지점에서의 티커 예상 가격 계산 (베타 적용)
          const tAtQSupport =
            currentPrice * (1 + beta * (q.putSupport / qPrice - 1));
          const tAtQResistance =
            currentPrice * (1 + beta * (q.callResistance / qPrice - 1));
          const tAtQUpper =
            currentPrice * (1 + beta * (q.expectedUpper / qPrice - 1));
          const tAtQLower =
            currentPrice * (1 + beta * (q.expectedLower / qPrice - 1));
          const tAtQGammaFlip =
            currentPrice * (1 + beta * (q.gammaFlip / qPrice - 1));

          // ✅ 2. 티커 기준의 상단(Upside)과 하단(Downside) 정의
          // 정방향: Upside(저항선), Downside(지지선)
          // 역방향: Upside(QQQ 하락시 가격상승), Downside(QQQ 상승시 가격하락)
          let tUpsideWall: number,
            tDownsideWall: number,
            tUpsideLimit: number,
            tDownsideLimit: number;

          if (beta >= 0) {
            tUpsideWall = tAtQResistance;
            tDownsideWall = tAtQSupport;
            tUpsideLimit = tAtQUpper;
            tDownsideLimit = tAtQLower;
          } else {
            tUpsideWall = tAtQSupport; // QQQ 저점 -> 인버스 고점
            tDownsideWall = tAtQResistance; // QQQ 고점 -> 인버스 저점
            tUpsideLimit = tAtQLower; // QQQ 하단 -> 인버스 상단
            tDownsideLimit = tAtQUpper; // QQQ 상단 -> 인버스 하단
          }

          // ✅ 3. 현실적인 지지/저항 (보수적 접근: Wall과 1-SD 중 현재가에 더 가까운 것 선택)
          const realisticSupport = Math.max(tDownsideWall, tDownsideLimit);
          const realisticResistance = Math.min(tUpsideWall, tUpsideLimit);
          
          // 심리 + 감마 플립 반영 예상 종가 산출
          const rangeMid = (realisticSupport + realisticResistance) / 2;
          const rangeHalf = (realisticResistance - realisticSupport) / 2;
          const expectedPrice = calculateGammaAdjustedExpectedPrice({
            rangeMid,
            rangeHalf,
            sentiment: beta < 0 ? -q.sentiment : q.sentiment,
            gammaFlip: tAtQGammaFlip,
            totalGex: beta < 0 ? -q.totalGex : q.totalGex,
          });

          const profitPotential =
            ((realisticResistance - realisticSupport) / realisticSupport) * 100;

          let priceProbability = { ...q.priceProbability };

          if (beta < 0) {
            // 확률 반전 (QQQ 상승 확률이 인버스 하락 확률이 됨)
            priceProbability = {
              up: q.priceProbability.down,
              down: q.priceProbability.up,
              neutral: q.priceProbability.neutral,
            };
          }

          return {
            date: q.date,
            isoDate: q.isoDate,
            expectedSupport: realisticSupport,
            expectedResistance: realisticResistance,
            expectedUpper: tUpsideLimit,
            expectedLower: tDownsideLimit,
            profitPotential,
            expectedPrice,
            sentiment: q.sentiment,
            totalGex: q.totalGex,
            priceProbability,
          };
        }
      );
    }

    // ✅ 티커 스윙 시나리오 독자 계산 (QQQ 시나리오 반전이 아닌 티커 데이터 기준 직접 도출)
    let tickerSwingScenarios: SwingScenario[] | undefined = undefined;
    if (Array.isArray(tickerTimeSeries) && tickerTimeSeries.length >= 2) {
      const combinations: SwingScenario[] = [];
      const scenarioLimit = 5;
      const targetResults = tickerTimeSeries.slice(0, scenarioLimit);

      // 요일 계산 헬퍼
      const getDayName = (isoDate: string) => {
        const days = ["일", "월", "화", "수", "목", "금", "토"];
        try {
          const date = new Date(isoDate);
          return days[date.getDay()];
        } catch {
          return "";
        }
      };

      for (let i = 0; i < targetResults.length; i++) {
        for (let j = i + 1; j < targetResults.length; j++) {
          const entry = targetResults[i];
          const exit = targetResults[j];

          const entryDay = getDayName(entry.isoDate);
          const exitDay = getDayName(exit.isoDate);
          const duration = j - i;

          const entryPrice = entry.expectedSupport;
          const exitPrice = exit.expectedResistance;
          const targetPrice = exitPrice * 0.995; // 보수적 목표가

          const profit = ((targetPrice - entryPrice) / entryPrice) * 100;

          if (profit > 0.1) {
            // 해당 티커 입장에서 수익이 나는 구간만 추출
            const sentimentImprovement = exit.sentiment - entry.sentiment;
            const gexTrend = exit.totalGex > entry.totalGex ? 5 : -5;

            // 방향성 보정: 인버스의 경우 QQQ 심리가 하락할 때 SQQQ는 상승
            const effectiveSentimentImprovement =
              beta < 0 ? -sentimentImprovement : sentimentImprovement;

            let scenarioProb =
              55 +
              effectiveSentimentImprovement * 0.4 +
              gexTrend +
              (exit.priceProbability.up - exit.priceProbability.down) * 0.2;

            scenarioProb -= duration * 2;
            scenarioProb = Math.round(Math.max(35, Math.min(80, scenarioProb)));

            combinations.push({
              entryDate: `${entry.date}(${entryDay})`,
              exitDate: `${exit.date}(${exitDay})`,
              entryPrice,
              exitPrice: targetPrice,
              extensionPrice: exitPrice,
              profit,
              extensionProfit: ((exitPrice - entryPrice) / entryPrice) * 100,
              probability: scenarioProb,
              description:
                beta < 0
                  ? `${duration}일 하락 베팅 스윙: QQQ 하향 추세를 활용한 ${String(
                      symbol
                    ).toUpperCase()} 진입 시나리오`
                  : `${duration}일 스윙: ${entryDay}요일 진입 → ${exitDay}요일 목표 도달 시나리오`,
            });
          }
        }
      }
      tickerSwingScenarios = combinations
        .sort((a, b) => {
          if (a.probability >= 70 && b.probability < 70) return -1;
          if (b.probability >= 70 && a.probability < 70) return 1;

          // 확률이 비슷하면 수익률 높은 순
          return b.profit - a.profit;
        })
        .slice(0, 3);
    }

    // ✅ 세부 구간별 상승/하락 추세 계산 (인버스 완벽 대응)
    let tickerSegmentedTrends: SegmentedTrend[] | undefined = undefined;
    if (Array.isArray(qqqSegmentedTrends)) {
      tickerSegmentedTrends = qqqSegmentedTrends.map((s: SegmentedTrend) => {
        let direction = s.direction;
        let description = s.description;

        // ✅ 가격 레벨 베타 보정 (해당 티커의 가격으로 변환)
        const tStartPrice =
          currentPrice * (1 + beta * (s.startPrice / qPrice - 1));
        const tEndPrice = currentPrice * (1 + beta * (s.endPrice / qPrice - 1));

        if (beta < 0) {
          // 인버스 종목은 방향 및 심리 완벽 반전
          if (direction === "상승") direction = "하락";
          else if (direction === "하락") direction = "상승";

          description = description
            .replace("매수 우위", "TMP_BUY")
            .replace("매도 압력", "매수 우위")
            .replace("TMP_BUY", "매도 압력")
            .replace("상향", "TMP_UP")
            .replace("하향", "상향")
            .replace("TMP_UP", "하향");
        }

        return {
          ...s,
          startPrice: tStartPrice,
          endPrice: tEndPrice,
          direction,
          description: description
            .replace("지지선", "기대 지지선")
            .replace("저항선", "기대 저항선"),
        };
      });
    }

    // ✅ 감마 심리 로드맵 계산 (인버스 완벽 대응)
    let tickerSentimentRoadmap: SentimentRoadmap[] | undefined = undefined;
    if (Array.isArray(qqqSentimentRoadmap)) {
      tickerSentimentRoadmap = qqqSentimentRoadmap.map(
        (s: SentimentRoadmap) => {
          let label = s.label;
          if (beta < 0) {
            // 인버스 종목은 심리 라벨 반전 (상승/하락 및 매수/매도)
            label = label
              .replace("매수", "TMP_BUY")
              .replace("매도", "매수")
              .replace("TMP_BUY", "매도")
              .replace("상승", "TMP_UP")
              .replace("하락", "상승")
              .replace("TMP_UP", "하락");
          }
          return { ...s, label };
        }
      );
    }

    // ✅ 전체 추세 예측 계산 (인버스 완벽 대응)
    let tickerTrendForecast: TrendForecast[] | undefined = undefined;
    if (Array.isArray(qqqTrendForecast)) {
      tickerTrendForecast = qqqTrendForecast.map((f: TrendForecast) => {
        let direction = f.direction;
        let description = f.description;

        if (beta < 0) {
          if (direction === "상승") direction = "하락";
          else if (direction === "하락") direction = "상승";

          description = description
            .replace("매수세", "TMP_BUY")
            .replace("매도 압력", "매수세")
            .replace("TMP_BUY", "매도 압력")
            .replace("강화", "TMP_STR")
            .replace("약화", "강화")
            .replace("TMP_STR", "약화")
            .replace("상승", "TMP_UP")
            .replace("하락", "상승")
            .replace("TMP_UP", "하락");
        }

        return {
          ...f,
          direction,
          description,
        };
      });
    }

    const analysis: TickerAnalysis = {
      symbol: String(symbol).toUpperCase(),
      currentPrice,
      beta,
      expectedSupport,
      expectedResistance,
      expectedMin,
      expectedMax,
      expectedPrice: tickerExpectedPrice,
      changePercent: quote.regularMarketChangePercent || 0,
      timeSeries: tickerTimeSeries,
      swingScenarios: tickerSwingScenarios,
      segmentedTrends: tickerSegmentedTrends,
      sentimentRoadmap: tickerSentimentRoadmap,
      trendForecast: tickerTrendForecast, // ✅ 추가된 필드
    };

    res.json(analysis);
  } catch (err: unknown) {
    console.error("Ticker Analysis Error:", err);
    res.status(500).json({ error: "티커 분석 중 오류가 발생했습니다." });
  }
});

/**
 * 티커 옵션 만기일 목록 조회
 */
app.get("/api/ticker-options/expirations", async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || "").trim();
  const type = String(req.query.type || "weekly").trim().toLowerCase();
  if (!symbol) {
    return res.status(400).json({ error: "티커 심볼이 필요합니다." });
  }

  try {
    const optionChain = await yahooFinance.options(symbol);
    const expirationFilter =
      type === "monthly" ? isMonthlyExpiration : isWeeklyExpiration;
    const expirations = (optionChain?.expirationDates || [])
      .filter((d) => expirationFilter(d as Date))
      .map((d) => formatExpirationDate(d as Date));

    res.json({
      symbol: symbol.toUpperCase(),
      type,
      expirations,
    });
  } catch (err: unknown) {
    console.error("Ticker Options Expirations Error:", err);
    res.status(500).json({ error: "옵션 만기일 조회 중 오류가 발생했습니다." });
  }
});

/**
 * 티커 옵션 체인 및 요약 분석
 */
app.get("/api/ticker-options/expiration", async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || "").trim();
  const date = String(req.query.date || "").trim();
  const type = String(req.query.type || "weekly").trim().toLowerCase();

  if (!symbol || !date) {
    return res.status(400).json({ error: "티커 심볼과 만기일이 필요합니다." });
  }

  try {
    const optionChain = await yahooFinance.options(symbol);
    const expirationDates = optionChain?.expirationDates || [];
    const expirationFilter =
      type === "monthly" ? isMonthlyExpiration : isWeeklyExpiration;
    const targetDate = expirationDates.find(
      (d) =>
        expirationFilter(d as Date) && formatExpirationDate(d as Date) === date
    );

    if (!targetDate) {
      return res.status(404).json({ error: "해당 만기일을 찾을 수 없습니다." });
    }

    const details = await yahooFinance.options(symbol, {
      date: targetDate as Date,
    });
    const expirationData = details?.options?.[0];

    if (!expirationData) {
      return res.status(404).json({ error: "옵션 데이터를 찾을 수 없습니다." });
    }

    const calls = expirationData.calls || [];
    const puts = expirationData.puts || [];

    const sumBy = (
      items: { openInterest?: number | string; volume?: number | string }[],
      key: "openInterest" | "volume"
    ) =>
      items.reduce((acc, item) => acc + Number(item[key] || 0), 0);

    const callOi = sumBy(calls, "openInterest");
    const putOi = sumBy(puts, "openInterest");
    const callVolume = sumBy(calls, "volume");
    const putVolume = sumBy(puts, "volume");
    const pcr = callOi > 0 ? putOi / callOi : 0;

    const pickWall = (
      items: { openInterest?: number | string; strike?: number }[]
    ) =>
      items.length > 0
        ? items.reduce((p, c) =>
            Number(c.openInterest || 0) > Number(p.openInterest || 0) ? c : p
          ).strike ?? null
        : null;

    const callWall = pickWall(calls);
    const putWall = pickWall(puts);

    const quote = await yahooFinance.quote(symbol);
    const spotPrice = quote?.regularMarketPrice || null;

    let avgIv: number | null = null;
    if (spotPrice) {
      const nearAtm = [...calls, ...puts].filter((opt) => {
        const strike = Number(opt.strike || 0);
        return Math.abs(strike - spotPrice) / spotPrice < 0.05;
      });
      if (nearAtm.length > 0) {
        avgIv =
          nearAtm.reduce(
            (acc, opt) => acc + Number(opt.impliedVolatility || 0),
            0
          ) / nearAtm.length;
      }
    }

    const mapOptionRow = (opt: {
      strike?: number;
      lastPrice?: number;
      openInterest?: number;
      volume?: number;
      impliedVolatility?: number;
      inTheMoney?: boolean;
    }): TickerOptionRow => ({
      strike: Number(opt.strike || 0),
      lastPrice: Number(opt.lastPrice || 0),
      openInterest: Number(opt.openInterest || 0),
      volume: Number(opt.volume || 0),
      impliedVolatility: Number(opt.impliedVolatility || 0),
      inTheMoney: Boolean(opt.inTheMoney),
    });

    const responsePayload = {
      symbol: symbol.toUpperCase(),
      expirationDate: date,
      summary: {
        callOi,
        putOi,
        callVolume,
        putVolume,
        pcr,
        callWall,
        putWall,
        avgIv,
        spotPrice,
      } as TickerOptionSummary,
      calls: calls.map(mapOptionRow).sort((a, b) => a.strike - b.strike),
      puts: puts.map(mapOptionRow).sort((a, b) => a.strike - b.strike),
      links: {
        overview: `https://optioncharts.io/options/${symbol.toUpperCase()}`,
        expiration: `https://optioncharts.io/options/${symbol.toUpperCase()}/option-chain?expiration_dates=${date}:${
          type === "monthly" ? "m" : "w"
        }`,
      },
    };

    res.json(responsePayload);
  } catch (err: unknown) {
    console.error("Ticker Options Chain Error:", err);
    res.status(500).json({ error: "옵션 체인 조회 중 오류가 발생했습니다." });
  }
});

export default app;

if (!process.env.VERCEL) {
  const PORT = 3001;
  app.listen(PORT, () => {
    console.log(`🚀 QQQ Daily Flow Server running at http://localhost:3001`);
  });
}
