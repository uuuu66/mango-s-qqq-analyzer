import express, { Request, Response } from "express";
import cors from "cors";
import YahooFinance from "yahoo-finance2";
import { BlackScholes } from "@uqee/black-scholes";

const yahooFinance = new YahooFinance();
const blackScholes = new BlackScholes();

const app = express();

app.use(cors());

const RISK_FREE_RATE = 0.045;

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
  callGex: number;
  putGex: number;
  totalGex: number;
  pcr: number; // Put/Call OI Ratio
  sentiment: number; // Net GEX Sentiment (-100 to 100)
  options: ProcessedOption[];
}

const processOption = (
  option: OptionDataInput,
  type: "call" | "put",
  spotPrice: number,
  timeToExpiration: number
): ProcessedOption => {
  const { strike, impliedVolatility = 0.2, openInterest = 0 } = option;

  let gamma = 0;
  try {
    const result = blackScholes.option({
      rate: RISK_FREE_RATE,
      sigma: impliedVolatility,
      strike: strike,
      time: Math.max(timeToExpiration, 0.0001),
      type: type,
      underlying: spotPrice,
    });
    gamma = result.gamma;
  } catch {
    // skip
  }

  const gammaExposure =
    (type === "call" ? 1 : -1) * gamma * (openInterest || 0) * 100 * spotPrice;

  return {
    ...option,
    type,
    gamma,
    gex: gammaExposure,
    expirationDate: option.expiration,
  };
};

app.get("/api/analysis", async (_request: Request, response: Response) => {
  const diagnostics: any = {
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
      throw new Error(
        `QQQ 만기일 데이터를 가져오지 못했습니다. Yahoo Response: ${JSON.stringify(
          optionChain
        )}`
      );
    }

    diagnostics.expirationsCount = optionChain.expirationDates.length;
    const now = new Date();
    const filterLimit = new Date();
    filterLimit.setDate(now.getDate() + 10);

    const targetExpirations = optionChain.expirationDates.filter(
      (dateString) => {
        const expirationDate = new Date(dateString);
        return expirationDate >= now && expirationDate <= filterLimit;
      }
    );

    const finalExpirations =
      targetExpirations.length >= 5
        ? targetExpirations
        : optionChain.expirationDates.slice(0, 5);

    diagnostics.step = "process_expirations";
    const results = await Promise.all(
      finalExpirations.map(async (dateString) => {
        const dateLog: any = { date: dateString, status: "starting" };
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
            dateLog.status = "no_option_data_in_response";
            diagnostics.details.push(dateLog);
            return null;
          }

          const timeToExpiration =
            (dateObj.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 365);

          const filterRange = 0.2;
          const rawCalls = (expirationData.calls || []).filter(
            (opt: any) =>
              opt.strike > currentPrice * (1 - filterRange) &&
              opt.strike < currentPrice * (1 + filterRange)
          );
          const rawPuts = (expirationData.puts || []).filter(
            (opt: any) =>
              opt.strike > currentPrice * (1 - filterRange) &&
              opt.strike < currentPrice * (1 + filterRange)
          );

          if (rawCalls.length === 0 && rawPuts.length === 0) {
            diagnostics.details.push({ ...dateLog, status: "filtered_out" });
            return null;
          }

          const calls = rawCalls.map((opt: any) =>
            processOption(
              opt as unknown as OptionDataInput,
              "call",
              currentPrice,
              timeToExpiration
            )
          );
          const puts = rawPuts.map((opt: any) =>
            processOption(
              opt as unknown as OptionDataInput,
              "put",
              currentPrice,
              timeToExpiration
            )
          );

          const callResistance =
            calls.length > 0
              ? calls.reduce(
                  (p, c) =>
                    (c.openInterest || 0) > (p.openInterest || 0) ? c : p,
                  calls[0]
                ).strike
              : currentPrice * 1.02;
          const putSupport =
            puts.length > 0
              ? puts.reduce(
                  (p, c) =>
                    (c.openInterest || 0) > (p.openInterest || 0) ? c : p,
                  puts[0]
                ).strike
              : currentPrice * 0.98;

          const callGex = calls.reduce((acc, opt) => acc + (opt.gex || 0), 0);
          const putGex = puts.reduce((acc, opt) => acc + (opt.gex || 0), 0);

          const callOI = calls.reduce(
            (acc, opt) => acc + (opt.openInterest || 0),
            0
          );
          const putOI = puts.reduce(
            (acc, opt) => acc + (opt.openInterest || 0),
            0
          );

          // Put/Call Ratio (Open Interest)
          const pcr = callOI > 0 ? putOI / callOI : 0;

          // Sentiment Score based on GEX dominance (-100 to 100)
          const totalAbsGex = Math.abs(callGex) + Math.abs(putGex);
          const sentiment =
            totalAbsGex > 0 ? ((callGex + putGex) / totalAbsGex) * 100 : 0;

          dateLog.status = "success";
          diagnostics.details.push(dateLog);

          return {
            date: dateObj.toLocaleDateString("ko-KR", {
              month: "2-digit",
              day: "2-digit",
            }),
            callResistance,
            putSupport,
            callGex,
            putGex,
            totalGex: callGex + putGex,
            pcr,
            sentiment,
            options: [...calls, ...puts],
          };
        } catch (e: any) {
          dateLog.status = "exception";
          diagnostics.details.push(dateLog);
          return null;
        }
      })
    );

    const validResults = results.filter(
      (r): r is ExpirationAnalysis => r !== null
    );

    if (validResults.length === 0) {
      throw {
        message: "분석 가능한 유효 옵션 데이터가 없습니다.",
        diagnostics,
      };
    }

    const nearest = validResults[0];
    const formatRange = (min: number, max: number) => {
      const lower = Math.min(min, max);
      const upper = Math.max(min, max);
      return `${lower.toFixed(2)} - ${upper.toFixed(2)}`;
    };

    const recommendations = [
      {
        status: "Strong Buy",
        description: "GEX 양수 & 가격이 풋 지지선 근처",
        priceRange: formatRange(
          nearest.putSupport * 0.995,
          nearest.putSupport * 1.005
        ),
        color: "#22c55e",
      },
      {
        status: "Buy",
        description: "지지선 확인 후 상승 추세",
        priceRange: formatRange(
          nearest.putSupport * 1.005,
          currentPrice * 0.995
        ),
        color: "#86efac",
      },
      {
        status: "Neutral",
        description: "시장 균형 상태",
        priceRange: formatRange(currentPrice * 0.995, currentPrice * 1.005),
        color: "#94a3b8",
      },
      {
        status: "Sell",
        description: "저항선 근접 및 과매수 구간",
        priceRange: formatRange(
          currentPrice * 1.005,
          nearest.callResistance * 0.995
        ),
        color: "#fca5a5",
      },
      {
        status: "Strong Sell",
        description: "GEX 음수 & 가격이 콜 저항선 근처",
        priceRange: formatRange(
          nearest.callResistance * 0.995,
          nearest.callResistance * 1.01
        ),
        color: "#ef4444",
      },
    ];

    response.json({
      currentPrice,
      options: nearest.options,
      timeSeries: validResults.map((result) => ({
        date: result.date,
        callResistance: result.callResistance,
        putSupport: result.putSupport,
        callGex: result.callGex,
        putGex: result.putGex,
        totalGex: result.totalGex,
        pcr: result.pcr,
        sentiment: result.sentiment,
      })),
      callResistance: nearest.callResistance,
      putSupport: nearest.putSupport,
      totalGex: nearest.totalGex,
      recommendations,
      diagnostics,
    });
  } catch (err: any) {
    console.error("Analysis Error:", err);
    response.status(500).json({
      error: err.message || "Unknown error",
      diagnostics: err.diagnostics || diagnostics,
    });
  }
});

export default app;

if (!process.env.VERCEL) {
  const PORT = 3001;
  app.listen(PORT, () => {
    console.log(`🚀 QQQ Daily Flow Server running at http://localhost:3001`);
  });
}
