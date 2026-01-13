import express, { Request, Response } from "express";
import cors from "cors";
import YahooFinance from "yahoo-finance2";
import { BlackScholes } from "@uqee/black-scholes";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

// dayjs 설정 (ESM/CJS 호환성을 위해 .js 확장자 명시 권장되는 경우 대응)
dayjs.extend(utc);
dayjs.extend(timezone);

const yahooFinance = new YahooFinance({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
});
const blackScholes = new BlackScholes();

const app = express();

app.use(cors());
app.use(express.json());

const RISK_FREE_RATE = 0.043;
const DIVIDEND_YIELD = 0.006;

// ✅ 하이퍼파라미터 안전한 기본값 보장
const VOLATILITY_TRIGGER_RATIO = 0.985;
const NEUTRAL_PROB_WEIGHT = 1.5;
const NEUTRAL_PROB_BASE_OFFSET = 20;
const IV_CLAMP_MIN = 0.0001;
const IV_CLAMP_MAX = 5.0;

/**
 * 수치 안전화 헬퍼 (NaN 방지)
 */
const safeNum = (val: unknown, fallback: number = 0): number => {
  return typeof val === "number" && isFinite(val) ? val : fallback;
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

/**
 * 정통 Gamma Flip 산출을 위한 Net GEX 계산 함수 (특정 Spot 기준)
 */
const calculateNetGexAtSpot = (
  options: ProcessedOption[],
  spot: number,
  time: number
): number => {
  return options.reduce((acc, opt) => {
    try {
      const adjustedSpot = spot * Math.exp(-DIVIDEND_YIELD * time);

      // ✅ IV 방어 로직 통일 (processOption과 동일)
      const ivRaw = opt.impliedVolatility;
      const sigma =
        typeof ivRaw === "number" && isFinite(ivRaw) && ivRaw > 0 ? ivRaw : 0.2;

      const result = blackScholes.option({
        rate: RISK_FREE_RATE,
        sigma: sigma,
        strike: opt.strike,
        time: Math.max(time, 0.0001),
        type: opt.type,
        underlying: adjustedSpot,
      });

      const gex =
        (opt.type === "call" ? 1 : -1) *
        result.gamma *
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

/**
 * Spot 스캔 방식의 진짜 Gamma Flip (Zero Gamma Level) 탐색 함수 (이진 탐색 최적화)
 */
const findTrueGammaFlip = (
  options: ProcessedOption[],
  currentSpot: number,
  time: number
): number => {
  if (options.length === 0) return currentSpot;

  const scanRange = 0.15; // ±15% 범위로 확장
  let low = currentSpot * (1 - scanRange);
  let high = currentSpot * (1 + scanRange);

  // 1) 양 끝점의 GEX 부호 확인
  const gexLow = calculateNetGexAtSpot(options, low, time);
  const gexHigh = calculateNetGexAtSpot(options, high, time);

  // 부호가 같다면 (범위 내에 Flip이 없다면) 더 가까운 쪽 혹은 현재가 반환
  if (gexLow * gexHigh > 0) {
    return Math.abs(gexLow) < Math.abs(gexHigh) ? low : high;
  }

  // 2) 이진 탐색 (Binary Search)으로 0 지점 정밀 추적 (최대 15회 반복으로 충분히 정밀함)
  for (let i = 0; i < 15; i++) {
    const mid = (low + high) / 2;
    const gexMid = calculateNetGexAtSpot(options, mid, time);

    if (Math.abs(gexMid) < 0.1) return mid; // 충분히 0에 가까우면 반환

    if (gexLow * gexMid <= 0) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return (low + high) / 2;
};

interface OptionDataInput {
  strike: number;
  impliedVolatility: number;
  openInterest?: number;
  lastPrice: number;
  change: number;
  percentChange?: number;
  volume?: number;
  expiration: Date;
}

interface ProcessedOption extends Omit<OptionDataInput, "expiration"> {
  type: "call" | "put";
  gamma: number;
  gex: number;
  expirationDate: Date;
}

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
  priceProbability: {
    up: number;
    down: number;
    neutral: number;
  };
  options: ProcessedOption[];
}

interface TickerTimeSeriesData {
  date: string;
  expectedSupport: number;
  expectedResistance: number;
  profitPotential: number;
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
  changePercent: number;
  timeSeries?: TickerTimeSeriesData[];
  swingScenarios?: SwingScenario[];
}

interface DiagnosticDetail {
  date: string;
  status: string;
  error?: string;
  callsProcessed?: number;
  putsProcessed?: number;
}

interface Recommendation {
  status: string;
  description: string;
  min: number;
  max: number;
  color: string;
}

interface Diagnostics {
  step: string;
  currentPrice: number | null;
  expirationsCount: number;
  details: DiagnosticDetail[];
  serverLogs: string[]; // 프론트엔드로 보낼 서버 로그 저장용
}

const generateRecommendations = (
  support: number,
  resistance: number,
  currentPrice: number
): Recommendation[] => {
  // 지지선과 저항선이 뒤집혀 있거나 동일한 경우 보정
  let low = Math.min(support, resistance);
  let high = Math.max(support, resistance);

  // ✅ 최소 폭 보정: 0.5% -> 2% (ATR 기반 느낌으로 확장)
  // 너무 좁은 구간은 매매 실익이 없으므로 최소 2%의 변동 범위를 강제로 확보
  const minWidth = currentPrice * 0.02;
  if (high - low < minWidth) {
    const center = (low + high) / 2;
    low = center - minWidth / 2;
    high = center + minWidth / 2;
  }

  const mid = (low + high) / 2;

  // Neutral과 Sell의 경계선을 정할 때 비율 기반 안전장치
  const neutralEnd = mid + (high - mid) * 0.6;

  // 리서치 및 사용자 제언 반영: 지지선이 뚫린 후 일정 수준(예: 3%) 이상 하락하면 'Extreme Risk'로 판단
  const panicLevel = low * 0.97;

  return [
    {
      status: "Extreme Risk",
      description: "지지선 완전 붕괴: 패닉 셀링 및 바닥 미확인 구간 (관망)",
      min: 0,
      max: panicLevel,
      color: "#475569", // 진한 회색 (위험/관망)
    },
    {
      status: "Strong Buy",
      description: "과매도/지지선 부근: 기술적 반등 기대 및 분할 매수",
      min: panicLevel,
      max: low,
      color: "#22c55e",
    },
    {
      status: "Buy",
      description: "지지선 ~ 중간값: 안정적 매수 구간",
      min: low,
      max: mid,
      color: "#86efac",
    },
    {
      status: "Neutral",
      description: "중간 영역: 추세 관망 및 보유 구간",
      min: mid,
      max: neutralEnd,
      color: "#94a3b8",
    },
    {
      status: "Sell",
      description: "저항선 근접: 분할 매도 수익 실현",
      min: neutralEnd,
      max: high,
      color: "#fca5a5",
    },
    {
      status: "Strong Sell",
      description: "저항선(Resistance) 이상: 강력한 매도 주의 구간",
      min: high,
      max: high + 10, // 리서치 제언: 너무 넓은 범위를 구체적으로 제한 ($630-640 수준)
      color: "#ef4444",
    },
  ];
};

/**
 * Newton-Raphson 방식을 이용한 내재 변동성(IV) 역산 함수
 */
const calculateImpliedVolatility = (
  targetPrice: number,
  params: {
    strike: number;
    time: number;
    type: "call" | "put";
    underlying: number;
    rate: number;
  }
): number => {
  let sigma = 0.2; // 초기 추정값 (20%)
  const maxIterations = 20;
  const precision = 0.0001;

  for (let i = 0; i < maxIterations; i++) {
    const result = blackScholes.option({
      ...params,
      sigma,
    });

    const diff = result.price - targetPrice;
    if (Math.abs(diff) < precision) return sigma;

    // 베가(Vega) 계산: 변동성이 1% 변할 때 옵션 가격의 변화
    // 직접적인 베가 함수가 없을 경우 수치 미분으로 근사
    const epsilon = 0.001;
    const resultNext = blackScholes.option({
      ...params,
      sigma: sigma + epsilon,
    });
    const vega = (resultNext.price - result.price) / epsilon;

    if (Math.abs(vega) < 0.00001) break; // 계산 불능 시 중단

    sigma = sigma - diff / vega;
    if (sigma <= 0) sigma = 0.0001; // 변동성은 음수가 될 수 없음
    if (sigma > 5) sigma = 5; // 과도한 변동성 방지
  }

  return sigma;
};

const processOption = (
  option: OptionDataInput,
  type: "call" | "put",
  spotPrice: number,
  timeToExpiration: number
): ProcessedOption => {
  // console.log(`[PROCESS] calling blackscholes for strike ${option.strike}`);
  const strike = Number(option.strike);
  // ✅ OI가 0인 경우 거래량(volume)을 일부 참고하여 에너지 계산 가능하도록 보정 (정수화)
  const openInterest =
    Number(option.openInterest) > 0
      ? Math.round(Number(option.openInterest))
      : Number(option.volume) > 0
      ? Math.round(Number(option.volume) * 0.1)
      : 1;

  const adjustedSpot =
    spotPrice * Math.exp(-DIVIDEND_YIELD * timeToExpiration);
  const ivRaw = option.impliedVolatility;

  let impliedVolatility: number;

  // ✅ IV 데이터가 비정상(0.001 미만)인 경우 직접 역산 시도
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

  // ✅ IV 클램핑 (발산 방지)
  impliedVolatility = Math.max(
    IV_CLAMP_MIN,
    Math.min(IV_CLAMP_MAX, impliedVolatility)
  );

  let gamma = 0;
  try {
    const result = blackScholes.option({
      rate: RISK_FREE_RATE,
      sigma: impliedVolatility,
      strike,
      time: Math.max(timeToExpiration, 0.0001),
      type,
      underlying: adjustedSpot,
    });
    gamma = safeNum(result.gamma, 0);
  } catch {
    // gamma = 0
  }

  // Dollar Notional GEX (주가 1% 변동 시 발생하는 명목 노출액)
  // ✅ 주의: OI 기반의 방향 가정(Proxy)이며, 실제 딜러 포지션과 다를 수 있음
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
            .filter((d) => dayjs(d).utc().format("YYYY-MM-DD") >= now.format("YYYY-MM-DD"))
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
          const dateObj = dayjs.tz(expDateStr, "America/New_York").hour(16).minute(0).second(0);
          
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
          
          const sumOI = (options: any[]) => options.reduce(
            (acc, opt) => acc + (opt.openInterest || (opt.volume ? Math.round(opt.volume * 0.1) : 0) || 1), 
            0
          );

          const totalCallOI_All = sumOI(allCallsRaw);
          const totalPutOI_All = sumOI(allPutsRaw);
          
          const pcrAll =
            totalCallOI_All > 0 ? totalPutOI_All / totalCallOI_All : 0;

          // 2) 정밀 분석용 Moneyness ±10% 이내 필터링 (기존 15%에서 강화)
          const filterRange = 0.10;
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

          // 4) 진짜 Gamma Flip (Spot-Scan 방식)
          const gammaFlip = findTrueGammaFlip(
            [...calls, ...puts],
            currentPrice,
            timeToExpiration
          );
          const volTrigger = gammaFlip * VOLATILITY_TRIGGER_RATIO;

          // 5) 옵션 분포 기반 가격 변동 확률 계산
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

          // ✅ 확률 계산 로직 고도화 (Smoothing & Cap 적용)
          if (totalEnergy > 0.0001) {
            const rawUpProb = (totalCallEnergy / totalEnergy) * 100;
            const rawDownProb = (totalPutEnergy / totalEnergy) * 100;

            // 중립 확률 최솟값 보장 (에너지가 쏠려도 최소 15%는 관망세로 설정)
            neutralProb = Math.max(
              15,
              100 - Math.abs(rawUpProb - rawDownProb) * 1.2 - 10
            );
            
            const remaining = 100 - neutralProb;
            const ratio = rawUpProb / (rawUpProb + rawDownProb);
            
            // 방향성 확률이 88%를 넘지 않도록 캡(Cap) 적용 (금융 시장의 불확실성 반영)
            upProb = Math.min(88, remaining * ratio);
            downProb = Math.min(88, remaining * (1 - ratio));
            
            // 캡 적용 후 남는 확률을 다시 중립에 보태줌
            neutralProb = 100 - upProb - downProb;
          }
          // ✅ 2순위: 에너지가 증발했으면 수량(Open Interest) 기반으로 즉시 전환
          else if (filteredCallOI + filteredPutOI > 0) {
            const totalOI = filteredCallOI + filteredPutOI;
            upProb = (filteredCallOI / totalOI) * 100;
            downProb = (filteredPutOI / totalOI) * 100;
            neutralProb = 15;

            const remaining = 100 - neutralProb;
            const ratio = upProb / (upProb + downProb);
            upProb = remaining * ratio;
            downProb = remaining * (1 - ratio);
          }

          const pcrFiltered =
            filteredCallOI > 0 ? filteredPutOI / filteredCallOI : 0;

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
            sentiment:
              Math.abs(callGex) + Math.abs(putGex) > 0
                ? ((callGex + putGex) /
                    (Math.abs(callGex) + Math.abs(putGex))) *
                  100
                : 0,
            profitPotential: ((callWall - putWall) / putWall) * 100,
            priceProbability: {
              up: Math.round(upProb),
              down: Math.round(downProb),
              neutral: Math.round(neutralProb),
            },
            options: [...calls, ...puts],
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
      key: "putSupport" | "callResistance"
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

    // ✅ 시장 전체 통합 감마 플립 산출 (피드백 반영: Aggregation Rule 적용)
    // 모든 유효 만기일의 옵션 데이터를 하나로 합쳐 거대한 GEX Profile 생성
    const allOptions = validResults.flatMap((r) => r.options);
    const globalGammaFlip = findTrueGammaFlip(allOptions, currentPrice, 0.1); // 평균적인 시간 가중치 적용
    const globalVolTrigger = globalGammaFlip * VOLATILITY_TRIGGER_RATIO;

    const recommendations = generateRecommendations(
      aggSupport,
      aggResistance,
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

      // 모든 가능한 [진입일 - 청산일] 조합 탐색 (최대 4일 간격까지)
      const combinations: SwingScenario[] = [];
      for (let i = 0; i < validResults.length; i++) {
        for (let j = i + 1; j < Math.min(i + 4, validResults.length); j++) {
          const entry = validResults[i];
          const exit = validResults[j];

          const entryDay = getDayName(entry.isoDate);
          const exitDay = getDayName(exit.isoDate);
          const duration = j - i;

          const baseTarget = exit.callResistance * 0.99; // 현실적인 1차 목표가 (저항선의 99%)
          const extensionTarget = exit.callResistance; // 2차 확장 목표가 (GEX Wall)

          const profit =
            ((baseTarget - entry.putSupport) / entry.putSupport) * 100;
          const extensionProfit =
            ((extensionTarget - entry.putSupport) / entry.putSupport) * 100;

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
          scenarioProb = Math.round(Math.max(35, Math.min(92, scenarioProb)));

          // 수익률이 0보다 큰 경우만 시나리오에 추가
          if (profit > 0) {
            combinations.push({
              entryDate: `${entry.date}(${entryDay})`,
              exitDate: `${exit.date}(${exitDay})`,
              entryPrice: entry.putSupport,
              exitPrice: baseTarget,
              extensionPrice: extensionTarget,
              profit,
              extensionProfit,
              probability: scenarioProb,
              description: `${duration}일 스윙: ${entryDay}요일 진입 → ${exitDay}요일 목표가 도달 시나리오`,
            });
          }
        }
      }

      // 수익률이 높은 상위 3개 시나리오만 선택
      swingScenarios.push(
        ...combinations.sort((a, b) => b.profit - a.profit).slice(0, 3)
      );
    }

    // 6) 추세 및 확률 예측 로직
    const trendForecast: TrendForecast[] = [];
    if (validResults.length >= 2) {
      const first = validResults[0];
      const last = validResults[validResults.length - 1];

      const sentimentDiff = last.sentiment - first.sentiment;
      const gexDiff = last.totalGex - first.totalGex;

      let direction: "상승" | "하락" | "횡보" = "횡보";
      let prob = 50;
      let desc = "";

      if (sentimentDiff > 10 && gexDiff > 0) {
        direction = "상승";
        prob = Math.min(65 + sentimentDiff / 2, 92);
        desc =
          "심리 지수와 GEX 에너지가 동반 상승 중이며, 매수세가 점진적으로 강화되는 추세입니다.";
      } else if (sentimentDiff < -10 && gexDiff < 0) {
        direction = "하락";
        prob = Math.min(65 + Math.abs(sentimentDiff) / 2, 92);
        desc =
          "심리 지수가 악화되고 GEX 방어력이 약화되고 있어, 매도 압력이 우세한 구간입니다.";
      } else {
        direction = "횡보";
        prob = 70;
        desc =
          "에너지가 특정 방향으로 쏠리지 않고 박스권 내에서 힘겨루기가 진행 중입니다.";
      }

      trendForecast.push({
        period: `${first.date} ~ ${last.date}`,
        direction,
        probability: Math.round(prob),
        description: desc,
      });
    }

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
      marketRegime:
        currentPrice > globalGammaFlip ? "Stabilizing" : "Volatile",
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
        priceProbability: result.priceProbability,
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
    qqqSwingScenarios,
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

    // 타임시리즈 계산 (있는 경우)
    let tickerTimeSeries: TickerTimeSeriesData[] | undefined = undefined;
    if (Array.isArray(qqqTimeSeries)) {
      tickerTimeSeries = qqqTimeSeries.map(
        (q: {
          date: string;
          putSupport: number;
          callResistance: number;
          priceProbability: { up: number; down: number; neutral: number };
        }) => {
          const expectedSupport =
            currentPrice * (1 + beta * (q.putSupport / qPrice - 1));
          const expectedResistance =
            currentPrice * (1 + beta * (q.callResistance / qPrice - 1));

          let profitPotential: number;
          let priceProbability = { ...q.priceProbability };

          if (beta >= 0) {
            // 정방향: (저항선 - 지지선) / 지지선
            profitPotential =
              ((expectedResistance - expectedSupport) / expectedSupport) * 100;
          } else {
            // 역방향: (지지선(실제로는 더 높은 가격) - 저항선(더 낮은 가격)) / 저항선
            // 인버스는 QQQ가 오를 때(저항선) 사서 내릴 때(지지선) 팔아야 함
            profitPotential =
              ((expectedSupport - expectedResistance) / expectedResistance) *
              100;

            // 확률 반전 (QQQ 상승 확률이 인버스 하락 확률이 됨)
            priceProbability = {
              up: q.priceProbability.down,
              down: q.priceProbability.up,
              neutral: q.priceProbability.neutral,
            };
          }

          return {
            date: q.date,
            expectedSupport,
            expectedResistance,
            profitPotential,
            priceProbability,
          };
        }
      );
    }

    // 스윙 시나리오 계산 (있는 경우)
    let tickerSwingScenarios: SwingScenario[] | undefined = undefined;
    if (Array.isArray(qqqSwingScenarios)) {
      tickerSwingScenarios = qqqSwingScenarios.map((s: SwingScenario) => {
        let entryPrice: number;
        let exitPrice: number;
        let extensionPrice: number;

        if (beta >= 0) {
          // 정방향 (QLD, TQQQ 등): QQQ 지지선 진입 -> 저항선 익절
          entryPrice = currentPrice * (1 + beta * (s.entryPrice / qPrice - 1));
          exitPrice = currentPrice * (1 + beta * (s.exitPrice / qPrice - 1));
          extensionPrice =
            currentPrice * (1 + beta * (s.extensionPrice / qPrice - 1));
        } else {
          // 역방향 (SQQQ 등): QQQ 저항선 진입 -> 지지선 익절
          // QQQ가 고점(s.exitPrice)일 때 인버스 진입, 저점(s.entryPrice)일 때 익절
          entryPrice = currentPrice * (1 + beta * (s.exitPrice / qPrice - 1));
          exitPrice = currentPrice * (1 + beta * (s.entryPrice / qPrice - 1));
          // 인버스의 확장 익절은 QQQ가 지지선을 뚫고 더 내려가는 시나리오
          extensionPrice =
            currentPrice * (1 + beta * ((s.entryPrice * 0.98) / qPrice - 1));
        }

        const profit = ((exitPrice - entryPrice) / entryPrice) * 100;
        const extensionProfit =
          ((extensionPrice - entryPrice) / entryPrice) * 100;

        return {
          ...s,
          entryPrice,
          exitPrice,
          extensionPrice,
          profit,
          extensionProfit,
          description:
            beta >= 0
              ? s.description.replace("QQQ", String(symbol).toUpperCase())
              : `${s.entryDate} ~ ${
                  s.exitDate
                } 하락 베팅: QQQ 저항선($${s.exitPrice.toFixed(
                  2
                )}) 부근 진입 시나리오`,
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
      changePercent: quote.regularMarketChangePercent || 0,
      timeSeries: tickerTimeSeries,
      swingScenarios: tickerSwingScenarios,
    };

    res.json(analysis);
  } catch (err: unknown) {
    console.error("Ticker Analysis Error:", err);
    res.status(500).json({ error: "티커 분석 중 오류가 발생했습니다." });
  }
});

export default app;

if (!process.env.VERCEL) {
  const PORT = 3001;
  app.listen(PORT, () => {
    console.log(`🚀 QQQ Daily Flow Server running at http://localhost:3001`);
  });
}
