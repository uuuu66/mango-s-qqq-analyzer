import express, { Request, Response } from "express";
import cors from "cors";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const YahooFinance = require("yahoo-finance2").default;
const { BlackScholes } = require("@uqee/black-scholes");

const yahooFinance = new YahooFinance();
const blackScholes = new BlackScholes();

const app = express();

app.use(cors());

// Risk-free rate (approx 4.5%)
const RISK_FREE_RATE = 0.045;

interface OptionDataInput {
  strike: number;
  impliedVolatility: number;
  openInterest: number;
  lastPrice: number;
  change: number;
  percentChange: number;
  volume: number;
  expiration: number;
}

interface ProcessedOption extends OptionDataInput {
  type: "call" | "put";
  gamma: number;
  gex: number;
  expirationDate: Date;
}

const processOption = (
  option: OptionDataInput,
  type: "call" | "put",
  spotPrice: number,
  timeToExpiration: number
): ProcessedOption => {
  const { 
    strike, 
    impliedVolatility = 0.2, 
    openInterest = 0 
  } = option;

  let gamma = 0;
  try {
    const result = blackScholes.option({
      rate: RISK_FREE_RATE,
      sigma: impliedVolatility,
      strike: strike,
      time: timeToExpiration,
      type: type,
      underlying: spotPrice,
    });
    gamma = result.gamma;
  } catch (error) {
    console.error("Greeks calculation error:", error);
  }

  // GEX = Gamma * OpenInterest * 100 (shares per contract) * Spot Price
  const gammaExposure = (type === "call" ? 1 : -1) * gamma * openInterest * 100 * spotPrice;

  return {
    ...option,
    type,
    gamma,
    gex: gammaExposure,
    expirationDate: new Date(option.expiration * 1000),
  };
};

app.get("/api/analysis", async (_request: Request, response: Response) => {
  try {
    const quote = await yahooFinance.quote("QQQ");
    const currentPrice = quote.regularMarketPrice || 0;

    const optionChain = await yahooFinance.options("QQQ");
    const targetExpiration = optionChain.expirations[0];

    const details = await yahooFinance.options("QQQ", {
      date: targetExpiration,
    });

    const now = new Date();
    const expirationDate = new Date(targetExpiration);
    const timeToExpiration =
      (expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 365);

    const calls: ProcessedOption[] = details.calls.map((option: OptionDataInput) =>
      processOption(option, "call", currentPrice, timeToExpiration)
    );
    const puts: ProcessedOption[] = details.puts.map((option: OptionDataInput) =>
      processOption(option, "put", currentPrice, timeToExpiration)
    );

    const allOptions = [...calls, ...puts];

    const callResistance = calls.reduce(
      (previous: ProcessedOption, current: ProcessedOption) =>
        current.openInterest > previous.openInterest ? current : previous,
      calls[0]
    ).strike;

    const putSupport = puts.reduce(
      (previous: ProcessedOption, current: ProcessedOption) =>
        current.openInterest > previous.openInterest ? current : previous,
      puts[0]
    ).strike;

    const totalGex = allOptions.reduce(
      (accumulator, option) => accumulator + (option.gex || 0), 
      0
    );

    const recommendations = [
      {
        status: "Strong Buy",
        description: "GEX Positive & Price near Put Support",
        priceRange: `${(putSupport * 0.98).toFixed(2)} - ${(
          putSupport * 1.01
        ).toFixed(2)}`,
        color: "#22c55e",
      },
      {
        status: "Buy",
        description: "GEX Turning Positive",
        priceRange: `${(putSupport * 1.01).toFixed(2)} - ${(
          currentPrice * 0.99
        ).toFixed(2)}`,
        color: "#86efac",
      },
      {
        status: "Wait/Neutral",
        description: "Balanced Market",
        priceRange: `${(currentPrice * 0.99).toFixed(2)} - ${(
          currentPrice * 1.01
        ).toFixed(2)}`,
        color: "#94a3b8",
      },
      {
        status: "Sell",
        description: "GEX Turning Negative",
        priceRange: `${(currentPrice * 1.01).toFixed(2)} - ${(
          callResistance * 0.99
        ).toFixed(2)}`,
        color: "#fca5a5",
      },
      {
        status: "Strong Sell",
        description: "GEX Negative & Price near Call Resistance",
        priceRange: `${(callResistance * 0.99).toFixed(2)} - ${(
          callResistance * 1.02
        ).toFixed(2)}`,
        color: "#ef4444",
      },
    ];

    response.json({
      currentPrice,
      options: allOptions,
      callResistance,
      putSupport,
      totalGex,
      recommendations,
    });
  } catch (error) {
    console.error("Analysis Error:", error);
    response.status(500).json({ error: "Failed to fetch and analyze QQQ data" });
  }
});

export default app;
