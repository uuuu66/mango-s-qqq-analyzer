import express, { Request, Response } from "express";
import cors from "cors";
import YahooFinance from "yahoo-finance2";
import { BlackScholes } from "@uqee/black-scholes";

const yahooFinance = new YahooFinance({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
});
const blackScholes = new BlackScholes();

const app = express();

app.use(cors());

const RISK_FREE_RATE = 0.0364; // 2026 SOFR 기준 3.64% 반영
const DIVIDEND_YIELD = 0.0048; // QQQ 평균 배당 수익률 0.48% 반영

/**
 * 사용자 지정 기간 히스토리 데이터를 기반으로 베타계수 직접 계산
 */
const calculateManualBeta = async (
  symbol: string,
  benchmarkSymbol: string = "QQQ",
  months: number = 3
): Promise<number> => {
  const now = new Date();
  const ago = new Date();
  ago.setMonth(now.getMonth() - months);

  try {
    // 티커와 벤치마크(QQQ)의 지정 기간 종가 데이터 가져오기
    const period1 = ago.toISOString().split("T")[0];
    const period2 = now.toISOString().split("T")[0];

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

    if (commonData.length < 20) return 1.0; // 데이터가 너무 적으면 기본값

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
      const result = blackScholes.option({
        rate: RISK_FREE_RATE,
        sigma: opt.impliedVolatility || 0.15,
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
 * Spot 스캔 방식의 진짜 Gamma Flip (Zero Gamma Level) 탐색 함수
 */
const findTrueGammaFlip = (
  options: ProcessedOption[],
  currentSpot: number,
  time: number
): number => {
  const scanRange = 0.1; // 현재가 기준 ±10% 스캔
  const step = 1; // 1달러 단위 정밀 스캔
  const start = currentSpot * (1 - scanRange);
  const end = currentSpot * (1 + scanRange);

  let prevSpot = start;
  let prevGex = calculateNetGexAtSpot(options, prevSpot, time);

  for (let spot = start + step; spot <= end; spot += step) {
    const currentGex = calculateNetGexAtSpot(options, spot, time);
    // 부호가 바뀌는 구간(0 교차점) 발견
    if (prevGex * currentGex <= 0) {
      // 선형 보간으로 더 정밀한 0 지점 추정
      return (
        prevSpot +
        (spot - prevSpot) *
          (Math.abs(prevGex) / (Math.abs(prevGex) + Math.abs(currentGex)))
      );
    }
    prevSpot = spot;
    prevGex = currentGex;
  }
  return currentSpot; // 못 찾을 경우 현재가 반환
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
  options: ProcessedOption[];
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
}

const generateRecommendations = (
  support: number,
  resistance: number
): Recommendation[] => {
  // 지지선과 저항선이 뒤집혀 있는 경우 보정
  const low = Math.min(support, resistance);
  const high = Math.max(support, resistance);
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

const processOption = (
  option: OptionDataInput,
  type: "call" | "put",
  spotPrice: number,
  timeToExpiration: number
): ProcessedOption => {
  const { strike, impliedVolatility = 0.2, openInterest = 0 } = option;

  let gamma = 0;
  try {
    // 리서치 제언: 배당 수익률(q)을 반영하기 위해 기초 자산 가격 조정 (S * e^-qT)
    const adjustedSpot =
      spotPrice * Math.exp(-DIVIDEND_YIELD * timeToExpiration);

    const result = blackScholes.option({
      rate: RISK_FREE_RATE,
      sigma: impliedVolatility,
      strike: strike,
      time: Math.max(timeToExpiration, 0.0001),
      type: type,
      underlying: adjustedSpot,
    });
    gamma = result.gamma;
  } catch {
    // skip
  }

  // 리서치 제언: Dollar Notional GEX (1% 변동 기준)
  // GEX = Gamma * OI * 100 * S^2 * 0.01
  const gammaExposure =
    (type === "call" ? 1 : -1) *
    gamma *
    (openInterest || 0) *
    100 *
    (spotPrice * spotPrice) *
    0.01;

  return {
    ...option,
    type,
    gamma,
    gex: gammaExposure,
    expirationDate: option.expiration,
  };
};

app.get("/api/analysis", async (_request: Request, response: Response) => {
  const diagnostics: Diagnostics = {
    step: "init",
    currentPrice: null,
    expirationsCount: 0,
    details: [],
  };

  try {
    diagnostics.step = "fetch_quote";
    const quote = await yahooFinance.quote("QQQ");
    const currentPrice = quote.regularMarketPrice || 0;
    diagnostics.currentPrice = currentPrice;

    diagnostics.step = "fetch_expiration_dates";
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

    const now = new Date();
    const filterLimit = new Date();
    filterLimit.setDate(now.getDate() + 10);

    const targetExpirations = rawExpirationDates.filter((d) => {
      const expirationDate = new Date(d);
      return expirationDate >= now && expirationDate <= filterLimit;
    });

    const finalExpirations =
      targetExpirations.length >= 5
        ? targetExpirations
        : rawExpirationDates.slice(0, 5);

    diagnostics.step = "process_expirations";
    const results = await Promise.all(
      finalExpirations.map(async (d) => {
        const dateString = String(d);
        try {
          const dateObj = new Date(dateString);
          const details = await yahooFinance.options("QQQ", {
            date: dateObj,
          });

          const expirationData = details?.options?.[0];

          if (
            !expirationData ||
            (!expirationData.calls?.length && !expirationData.puts?.length)
          ) {
            diagnostics.details.push({ date: dateString, status: "no_data" });
            return null;
          }

          const timeToExpiration =
            (dateObj.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 365);

          // 1) 전체 데이터 기준 PCR 계산 (연구 데이터 대조용)
          const allCallsRaw = expirationData.calls || [];
          const allPutsRaw = expirationData.puts || [];
          const totalCallOI_All = allCallsRaw.reduce(
            (acc, opt) => acc + (opt.openInterest || 0),
            0
          );
          const totalPutOI_All = allPutsRaw.reduce(
            (acc, opt) => acc + (opt.openInterest || 0),
            0
          );
          const pcrAll =
            totalCallOI_All > 0 ? totalPutOI_All / totalCallOI_All : 0;

          // 2) 정밀 분석용 Moneyness 15% 이내 필터링
          const filterRange = 0.15;
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

          // 3) 정석적인 Call Wall / Put Wall 추출
          // Call Wall: 콜 옵션 중 GEX 에너지가 가장 큰(양수 최대) 지점
          const callWall =
            calls.length > 0
              ? calls.reduce((p, c) => (c.gex > p.gex ? c : p), calls[0]).strike
              : currentPrice * 1.05;

          // Put Wall: 풋 옵션 중 GEX 에너지가 가장 큰(음수 최소) 지점
          const putWall =
            puts.length > 0
              ? puts.reduce((p, c) => (c.gex < p.gex ? c : p), puts[0]).strike
              : currentPrice * 0.95;

          const callGex = calls.reduce((acc, opt) => acc + (opt.gex || 0), 0);
          const putGex = puts.reduce((acc, opt) => acc + (opt.gex || 0), 0);
          const totalGex = callGex + putGex;

          // 4) 진짜 Gamma Flip (Spot-Scan 방식)
          const gammaFlip = findTrueGammaFlip(
            [...calls, ...puts],
            currentPrice,
            timeToExpiration
          );
          const volTrigger = gammaFlip * 0.985;

          // 필터링된 데이터 기준 PCR
          const filteredCallOI = calls.reduce(
            (acc, opt) => acc + (opt.openInterest || 0),
            0
          );
          const filteredPutOI = puts.reduce(
            (acc, opt) => acc + (opt.openInterest || 0),
            0
          );
          const pcrFiltered =
            filteredCallOI > 0 ? filteredPutOI / filteredCallOI : 0;

          diagnostics.details.push({
            date: dateString,
            status: "success",
            callsProcessed: calls.length,
            putsProcessed: puts.length,
          });

          return {
            date: dateObj.toLocaleDateString("ko-KR", {
              month: "2-digit",
              day: "2-digit",
            }),
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

    const nearest = validResults[0];

    const recommendations = generateRecommendations(
      nearest.putSupport,
      nearest.callResistance
    );

    response.json({
      currentPrice,
      options: nearest.options,
      totalNetGEX: `${(nearest.totalGex / 1e9).toFixed(2)}B USD/1%`,
      // 리서치 제언: 가격이 감마 플립보다 위에 있으면 안정(Stabilizing), 아래면 변동(Volatile)
      marketRegime:
        currentPrice > nearest.gammaFlip ? "Stabilizing" : "Volatile",
      gammaFlip: nearest.gammaFlip,
      volTrigger: nearest.volTrigger,
      timeSeries: validResults.map((result) => ({
        date: result.date,
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
      })),
      callResistance: nearest.callResistance,
      putSupport: nearest.putSupport,
      totalGex: nearest.totalGex,
      recommendations: recommendations.map((rec) => ({
        ...rec,
        priceRange: `${rec.min.toFixed(2)} - ${rec.max.toFixed(2)}`,
      })),
      diagnostics,
    });
  } catch (err: unknown) {
    console.error("Analysis Error:", err);
    const errorMsg =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
        ? (err as { message: string }).message
        : "Unknown error";
    const diag =
      typeof err === "object" && err !== null && "diagnostics" in err
        ? (err as { diagnostics: Diagnostics }).diagnostics
        : diagnostics;
    response.status(500).json({
      error: errorMsg,
      diagnostics: diag,
    });
  }
});

/**
 * 티커별 베타 기반 기대 지지/저항선 분석 API
 */
app.get("/api/ticker-analysis", async (req: Request, res: Response) => {
  const {
    symbol,
    qqqPrice,
    qqqSupport,
    qqqResistance,
    qqqMin,
    qqqMax,
    months,
  } = req.query;

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

    const analysis: TickerAnalysis = {
      symbol: String(symbol).toUpperCase(),
      currentPrice,
      beta,
      expectedSupport,
      expectedResistance,
      expectedMin,
      expectedMax,
      changePercent: quote.regularMarketChangePercent || 0,
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
