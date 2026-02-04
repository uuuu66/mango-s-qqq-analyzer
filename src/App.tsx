import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  AlertTriangle,
  RefreshCw,
  Download,
} from "lucide-react";
import {
  fetchAnalysisData,
  fetchTickerAnalysis,
  fetchTickerOptionChain,
  fetchTickerOptionExpirations,
  type AnalysisResult,
  type TickerAnalysis,
  type TickerOptionChain,
} from "./services/optionService";
import "./App.css";
import QQQExtendedAnalysis from "./components/QQQExtendedAnalysis";
import AssetSection from "./components/AssetSection";
import TickerSearchSection from "./components/TickerSearchSection";
import { ASSET_TABS, API_SYMBOL_MAP } from "./constants";

const App: React.FC = () => {
  const [activeNavSymbol, setActiveNavSymbol] = useState<
    (typeof ASSET_TABS)[number]
  >("QQQ");
  const [activeSymbol] = useState<(typeof ASSET_TABS)[number]>("QQQ");
  const [assetDataMap, setAssetDataMap] = useState<
    Record<(typeof ASSET_TABS)[number], AnalysisResult | null>
  >({
    QQQ: null,
    GLD: null,
    SLV: null,
    VXX: null,
    UVXY: null,
    BTC: null,
  });
  const [assetLoadingMap, setAssetLoadingMap] = useState<
    Record<(typeof ASSET_TABS)[number], boolean>
  >({
    QQQ: false,
    GLD: false,
    SLV: false,
    VXX: false,
    UVXY: false,
    BTC: false,
  });
  const [assetErrorMap, setAssetErrorMap] = useState<
    Record<(typeof ASSET_TABS)[number], string | null>
  >({
    QQQ: null,
    GLD: null,
    SLV: null,
    VXX: null,
    UVXY: null,
    BTC: null,
  });
  const [assetUpdatedMap, setAssetUpdatedMap] = useState<
    Record<(typeof ASSET_TABS)[number], string | null>
  >({
    QQQ: null,
    GLD: null,
    SLV: null,
    VXX: null,
    UVXY: null,
    BTC: null,
  });
  const [loadedAssetMap] = useState<
    Record<(typeof ASSET_TABS)[number], boolean>
  >({
    QQQ: true,
    GLD: true,
    SLV: true,
    VXX: true,
    UVXY: true,
    BTC: true,
  });
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  // Ticker Analysis States
  const [tickerInput, setTickerInput] = useState<string>("");
  const [betaPeriod, setBetaPeriod] = useState<number>(1);
  const [tickerAnalysis, setTickerAnalysis] = useState<TickerAnalysis | null>(
    null
  );
  const [tickerLoading, setTickerLoading] = useState<boolean>(false);
  const [tickerError, setTickerError] = useState<string | null>(null);

  const [tickerExpirations, setTickerExpirations] = useState<string[]>([]);
  const [tickerOptionsLoading, setTickerOptionsLoading] =
    useState<boolean>(false);
  const [tickerOptionsError, setTickerOptionsError] = useState<string | null>(
    null
  );
  const [selectedExpiration, setSelectedExpiration] = useState<string | null>(
    null
  );
  const [tickerOptionChain, setTickerOptionChain] =
    useState<TickerOptionChain | null>(null);
  const [expirationType, setExpirationType] = useState<"weekly" | "monthly">(
    "weekly"
  );
  const [expirationTypeBySymbol, setExpirationTypeBySymbol] = useState<
    Record<(typeof ASSET_TABS)[number], "daily" | "weekly" | "monthly">
  >({
    QQQ: "daily",
    GLD: "weekly",
    SLV: "weekly",
    VXX: "weekly",
    UVXY: "weekly",
    BTC: "weekly",
  });
  const [expirationsBySymbol, setExpirationsBySymbol] = useState<
    Record<(typeof ASSET_TABS)[number], string[]>
  >({
    QQQ: [],
    GLD: [],
    SLV: [],
    VXX: [],
    UVXY: [],
    BTC: [],
  });
  const [optionsLoadingBySymbol, setOptionsLoadingBySymbol] = useState<
    Record<(typeof ASSET_TABS)[number], boolean>
  >({
    QQQ: false,
    GLD: false,
    SLV: false,
    VXX: false,
    UVXY: false,
    BTC: false,
  });
  const [optionsErrorBySymbol, setOptionsErrorBySymbol] = useState<
    Record<(typeof ASSET_TABS)[number], string | null>
  >({
    QQQ: null,
    GLD: null,
    SLV: null,
    VXX: null,
    UVXY: null,
    BTC: null,
  });
  const [selectedExpirationBySymbol, setSelectedExpirationBySymbol] = useState<
    Record<(typeof ASSET_TABS)[number], string | null>
  >({
    QQQ: null,
    GLD: null,
    SLV: null,
    VXX: null,
    UVXY: null,
    BTC: null,
  });
  const [optionChainBySymbol, setOptionChainBySymbol] = useState<
    Record<(typeof ASSET_TABS)[number], TickerOptionChain | null>
  >({
    QQQ: null,
    GLD: null,
    SLV: null,
    VXX: null,
    UVXY: null,
    BTC: null,
  });
  const [optionsSortBy, setOptionsSortBy] = useState<
    Record<(typeof ASSET_TABS)[number], "oi" | "volume">
  >({
    QQQ: "oi",
    GLD: "oi",
    SLV: "oi",
    VXX: "oi",
    UVXY: "oi",
    BTC: "oi",
  });
  const assetSectionRefs = useRef<
    Record<(typeof ASSET_TABS)[number], HTMLElement | null>
  >({
    QQQ: null,
    GLD: null,
    SLV: null,
    VXX: null,
    UVXY: null,
    BTC: null,
  });
  const pollingRef = useRef<number | null>(null);
  const tickerPollingRef = useRef<number | null>(null);


  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  }, []);

  const loadData = useCallback(async (symbol: (typeof ASSET_TABS)[number]) => {
    const apiSymbol = API_SYMBOL_MAP[symbol];
    setAssetLoadingMap((prev) => ({ ...prev, [symbol]: true }));
    setAssetErrorMap((prev) => ({ ...prev, [symbol]: null }));
    if (symbol === "QQQ") {
      setError(null);
    }
    try {
      const result = await fetchAnalysisData(apiSymbol);
      setAssetDataMap((prev) => ({ ...prev, [symbol]: result }));
      if (symbol === "QQQ") {
        setData(result);
      }
      const date = result.dataTimestamp
        ? new Date(result.dataTimestamp)
        : new Date();
      const formatTime = (tz: string) => {
        return date.toLocaleString("ko-KR", {
          timeZone: tz,
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });
      };
      const nyTime = formatTime("America/New_York");
      const krTime = formatTime("Asia/Seoul");
      setAssetUpdatedMap((prev) => ({
        ...prev,
        [symbol]: `미국 ${nyTime} (한국 ${krTime})`,
      }));
      if (symbol === "QQQ") {
        setLastUpdated(`미국 ${nyTime} (한국 ${krTime})`);
      }
    } catch (err: unknown) {
      console.error("Fetch Error:", err);
      let detailedError = "";
      if (err instanceof Error) {
        detailedError = JSON.stringify(
          {
            name: err.name,
            message: err.message,
            stack: err.stack,
          },
          null,
          2
        );
      } else {
        detailedError =
          typeof err === "object" ? JSON.stringify(err, null, 2) : String(err);
      }
      setAssetErrorMap((prev) => ({ ...prev, [symbol]: detailedError }));
      setAssetDataMap((prev) => ({ ...prev, [symbol]: null }));
      if (symbol === "QQQ") {
        setError(detailedError);
        setData(null);
      }
    } finally {
      setAssetLoadingMap((prev) => ({ ...prev, [symbol]: false }));
    }
  }, []);

  const isMarketOpenNY = useCallback(() => {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const getPart = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    const weekday = getPart("weekday");
    const hour = Number(getPart("hour"));
    const minute = Number(getPart("minute"));

    const isWeekday =
      weekday === "Mon" ||
      weekday === "Tue" ||
      weekday === "Wed" ||
      weekday === "Thu" ||
      weekday === "Fri";
    if (!isWeekday) return false;

    const minutes = hour * 60 + minute;
    const open = 9 * 60 + 30;
    const close = 16 * 60;
    return minutes >= open && minutes <= close;
  }, []);

  useEffect(() => {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    if (!isMarketOpenNY()) return;

    pollingRef.current = window.setInterval(() => {
      ASSET_TABS.forEach((symbol) => {
        if (loadedAssetMap[symbol] && !assetLoadingMap[symbol]) {
          loadData(symbol);
        }
      });
    }, 10000);

    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [assetLoadingMap, isMarketOpenNY, loadData, loadedAssetMap]);

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const loadTickerAnalysis = useCallback(
    async (showLoading: boolean, symbol: string) => {
      if (!data) return;
      if (showLoading) {
        setTickerLoading(true);
      }
      setTickerError(null);
      try {
        const qqqMin = data.recommendations[0].max;
        const qqqMax = data.recommendations[5].max;

        const result = await fetchTickerAnalysis(
          symbol,
          activeSymbol,
          data.currentPrice,
          data.putSupport,
          data.callResistance,
          qqqMin,
          qqqMax,
          betaPeriod,
          data.timeSeries,
          data.swingScenarios,
          data.segmentedTrends,
          data.sentimentRoadmap,
          data.trendForecast
        );
        setTickerAnalysis(result);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "분석에 실패했습니다.";
        setTickerError(message);
      } finally {
        if (showLoading) {
          setTickerLoading(false);
        }
      }
    },
    [activeSymbol, betaPeriod, data]
  );

  const handleTickerSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tickerInput || !data) return;
    (
      window as unknown as {
        gtag: (
          event: string,
          name: string,
          data: Record<string, unknown>
        ) => void;
      }
    ).gtag?.("event", "ticker_search", {
      ticker_name: tickerInput,
      page_path: window.location.pathname,
    });
    loadTickerAnalysis(true, tickerInput);
  };

  useEffect(() => {
    if (tickerPollingRef.current) {
      window.clearInterval(tickerPollingRef.current);
      tickerPollingRef.current = null;
    }

    if (!isMarketOpenNY() || !tickerAnalysis?.symbol) return;

    tickerPollingRef.current = window.setInterval(() => {
      if (!tickerLoading && tickerAnalysis?.symbol) {
        loadTickerAnalysis(false, tickerAnalysis.symbol);
      }
    }, 10000);

    return () => {
      if (tickerPollingRef.current) {
        window.clearInterval(tickerPollingRef.current);
        tickerPollingRef.current = null;
      }
    };
  }, [
    isMarketOpenNY,
    loadTickerAnalysis,
    tickerAnalysis?.symbol,
    tickerLoading,
  ]);

  const loadTickerOptionExpirations = useCallback(
    async (symbol: string, type: "weekly" | "monthly") => {
      setTickerOptionsLoading(true);
      setTickerOptionsError(null);
      try {
        const result = await fetchTickerOptionExpirations(symbol, type);
        setTickerExpirations(result.expirations);
        if (result.expirations.length > 0) {
          setSelectedExpiration(result.expirations[0]);
        } else {
          setSelectedExpiration(null);
          setTickerOptionChain(null);
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "옵션 만기일 조회 실패";
        setTickerOptionsError(message);
        setTickerExpirations([]);
        setSelectedExpiration(null);
        setTickerOptionChain(null);
      } finally {
        setTickerOptionsLoading(false);
      }
    },
    []
  );

  const loadAssetOptionChain = useCallback(
    async (symbol: (typeof ASSET_TABS)[number], date: string, type: "daily" | "weekly" | "monthly") => {
      setOptionsErrorBySymbol((prev) => ({ ...prev, [symbol]: null }));
      setOptionsLoadingBySymbol((prev) => ({ ...prev, [symbol]: true }));
      try {
        const result = await fetchTickerOptionChain(symbol, date, type);
        setOptionChainBySymbol((prev) => ({ ...prev, [symbol]: result }));
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "옵션 체인 조회 실패";
        setOptionsErrorBySymbol((prev) => ({ ...prev, [symbol]: message }));
        setOptionChainBySymbol((prev) => ({ ...prev, [symbol]: null }));
      } finally {
        setOptionsLoadingBySymbol((prev) => ({ ...prev, [symbol]: false }));
      }
    },
    []
  );

  const loadAssetOptionExpirations = useCallback(
    async (symbol: (typeof ASSET_TABS)[number], type: "daily" | "weekly" | "monthly") => {
      setOptionsErrorBySymbol((prev) => ({ ...prev, [symbol]: null }));
      setOptionsLoadingBySymbol((prev) => ({ ...prev, [symbol]: true }));
      try {
        const result = await fetchTickerOptionExpirations(symbol, type);
        setExpirationsBySymbol((prev) => ({ ...prev, [symbol]: result.expirations }));
        if (result.expirations.length > 0) {
          const nextExp = result.expirations[0];
          setSelectedExpirationBySymbol((prev) => ({ ...prev, [symbol]: nextExp }));
          await loadAssetOptionChain(symbol, nextExp, type);
        } else {
          setSelectedExpirationBySymbol((prev) => ({ ...prev, [symbol]: null }));
          setOptionChainBySymbol((prev) => ({ ...prev, [symbol]: null }));
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "만기일 조회 실패";
        setOptionsErrorBySymbol((prev) => ({ ...prev, [symbol]: message }));
      } finally {
        setOptionsLoadingBySymbol((prev) => ({ ...prev, [symbol]: false }));
      }
    },
    [loadAssetOptionChain]
  );

  const handleScrollToAsset = useCallback(
    (symbol: (typeof ASSET_TABS)[number]) => {
      const el = assetSectionRefs.current[symbol];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    []
  );

  const loadTickerOptionChain = useCallback(
    async (symbol: string, expiration: string, type: "weekly" | "monthly") => {
      setTickerOptionsLoading(true);
      setTickerOptionsError(null);
      try {
        const chain = await fetchTickerOptionChain(symbol, expiration, type);
        setTickerOptionChain(chain);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "옵션 체인 조회 실패";
        setTickerOptionsError(message);
        setTickerOptionChain(null);
      } finally {
        setTickerOptionsLoading(false);
      }
    },
    []
  );


  useEffect(() => {
    if (tickerAnalysis?.symbol) {
      loadTickerOptionExpirations(tickerAnalysis.symbol, expirationType);
    } else {
      setTickerExpirations([]);
      setSelectedExpiration(null);
      setTickerOptionChain(null);
    }
  }, [expirationType, loadTickerOptionExpirations, tickerAnalysis?.symbol]);

  useEffect(() => {
    if (tickerAnalysis?.symbol && selectedExpiration) {
      loadTickerOptionChain(
        tickerAnalysis.symbol,
        selectedExpiration,
        expirationType
      );
    }
  }, [
    expirationType,
    loadTickerOptionChain,
    selectedExpiration,
    tickerAnalysis?.symbol,
  ]);

  useEffect(() => {
    ASSET_TABS.forEach((symbol) => {
      if (loadedAssetMap[symbol]) {
        loadAssetOptionExpirations(symbol, expirationTypeBySymbol[symbol]);
      }
    });
  }, [expirationTypeBySymbol, loadAssetOptionExpirations, loadedAssetMap]);

  const downloadAsText = useCallback(() => {
    if (!data) return;

    (
      window as unknown as {
        gtag: (
          event: string,
          name: string,
          data: Record<string, unknown>
        ) => void;
      }
    ).gtag?.("event", "download_text", {
      page_path: window.location.pathname,
    });
    const reportSymbol = data.symbol || activeSymbol;
    let text = `${reportSymbol} Analysis Report - ${new Date().toLocaleString()}\n`;
    text += `==========================================\n\n`;
    text += `[ Summary ]\n`;
    text += `Current Price: $${data.currentPrice?.toFixed(2)}\n`;
    text += `Total Net GEX: ${data.totalNetGEX}\n`;
    text += `Market Regime: ${data.marketRegime}\n`;
    text += `Gamma Flip: $${data.gammaFlip?.toFixed(2)}\n`;
    text += `Volatility Trigger: $${data.volTrigger?.toFixed(2)}\n\n`;

    text += `[ Recommendations ]\n`;
    data.recommendations.forEach((rec) => {
      text += `- ${rec.status}: ${rec.priceRange} (${rec.description})\n`;
    });
    text += `\n`;

    text += `[ Market Sentiment & Trend ]\n`;
    text += `Date\tExpected\tPCR(All)\tPCR(Filtered)\tSentiment Score\tMax Profit Range\tUp/Down/Neutral Prob\n`;
    data.timeSeries.forEach((item) => {
      text += `${item.date}\t$${item.expectedPrice?.toFixed(
        2
      )}\t${item.pcrAll.toFixed(2)}\t${item.pcrFiltered?.toFixed(
        2
      )}\t${item.sentiment.toFixed(1)}\t${item.profitPotential?.toFixed(2)}%\t${
        item.priceProbability?.up ?? 0
      }%/${item.priceProbability?.down ?? 0}%/${
        item.priceProbability?.neutral ?? 0
      }%\n`;
    });
    text += `\n`;

    if (data.swingScenarios && data.swingScenarios.length > 0) {
      text += `[ Swing Strategy Scenarios ]\n`;
      data.swingScenarios.forEach((s) => {
        text += `- ${s.entryDate} Buy ($${s.entryPrice?.toFixed(2)}) -> ${
          s.exitDate
        } Base Sell ($${s.exitPrice.toFixed(
          2
        )}) / Ext Sell ($${s.extensionPrice?.toFixed(2)}) : +${s.profit.toFixed(
          2
        )}% / +${s.extensionProfit?.toFixed(2)}% (Prob: ${s.probability}%)\n`;
      });
      text += `\n`;
    }

    if (data.trendForecast && data.trendForecast.length > 0) {
      text += `[ Market Trend Forecast ]\n`;
      data.trendForecast.forEach((t) => {
        text += `- Period: ${t.period}\n`;
        text += `  Direction: ${t.direction}\n`;
        text += `  Probability: ${t.probability}%\n`;
        text += `  Description: ${t.description}\n`;
      });
      text += `\n`;
    }

    if (data.segmentedTrends && data.segmentedTrends.length > 0) {
      text += `[ Detailed Segmented Trend Forecast ]\n`;
      data.segmentedTrends.forEach((trend) => {
        text += `- ${trend.startDate} ~ ${trend.endDate}: ${trend.direction} (${trend.description})\n`;
      });
      text += `\n`;
    }

    if (data.sentimentRoadmap && data.sentimentRoadmap.length > 0) {
      text += `[ Sentiment Roadmap ]\n`;
      data.sentimentRoadmap.forEach((s) => {
        text += `- ${s.date} (${s.timeLabel}): Sentiment ${s.sentiment.toFixed(
          1
        )} (${s.label})\n`;
      });
      text += `\n`;
    }

    if (data.options && data.options.length > 0) {
      text += `[ Top 15 Options by Open Interest ]\n`;
      text += `Type\tStrike\tPrice\tOI\tGEX\n`;
      const topOptions = [...data.options]
        .sort((a, b) => (b.openInterest || 0) - (a.openInterest || 0))
        .slice(0, 15);
      topOptions.forEach((opt) => {
        text += `${opt.type.toUpperCase()}\t$${opt.strike.toFixed(
          2
        )}\t$${opt.lastPrice?.toFixed(2)}\t${opt.openInterest}\t${Math.round(
          opt.gex || 0
        ).toLocaleString()}\n`;
      });
    }

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeSymbol.toLowerCase()}-analysis-${
      new Date().toISOString().split("T")[0]
    }.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [activeSymbol, data]);

  const downloadYahooRaw = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/yahoo-raw?symbol=${encodeURIComponent(activeSymbol)}`
      );
      if (!response.ok) {
        throw new Error("원본 데이터를 가져오지 못했습니다.");
      }
      const raw = await response.json();
      const text = JSON.stringify(raw, null, 2);
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${activeSymbol.toLowerCase()}-yahoo-raw-${
        new Date().toISOString().split("T")[0]
      }.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      console.error("Raw Download Error:", err);
    }
  }, [activeSymbol]);

  useEffect(() => {
    ASSET_TABS.forEach((symbol) => {
      loadData(symbol);
    });
  }, [loadData]);

  useEffect(() => {
    let rafId: number | null = null;

    const updateActiveNav = () => {
      const candidates = ASSET_TABS.map((symbol) => {
        const el = assetSectionRefs.current[symbol];
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { symbol, top: rect.top };
      }).filter(Boolean) as { symbol: (typeof ASSET_TABS)[number]; top: number }[];

      if (candidates.length === 0) return;
      const sorted = candidates.sort(
        (a, b) => Math.abs(a.top) - Math.abs(b.top)
      );
      setActiveNavSymbol(sorted[0].symbol);
    };

    const onScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        updateActiveNav();
        rafId = null;
      });
    };

    updateActiveNav();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const getCurrentStatus = () => {
    if (!data) return null;
    const price = data.currentPrice;
    return (
      data.recommendations.find((rec) => price >= rec.min && price < rec.max) ||
      data.recommendations[data.recommendations.length - 1]
    );
  };

  const currentStatus = getCurrentStatus();

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-white p-6 text-center font-sans">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6">
          <AlertTriangle className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">
          데이터를 가져오지 못했습니다
        </h2>
        <p className="text-slate-500 mb-8 max-w-md">ㅠㅠ</p>
        <button
          onClick={() => loadData("QQQ")}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors"
        >
          <RefreshCw className="w-5 h-5" /> 다시 시도
        </button>
        <div className="mt-8 p-4 bg-slate-50 rounded-lg text-left max-w-2xl overflow-auto border border-slate-200">
          <p className="text-[10px] font-mono text-slate-400 uppercase mb-2">
            Error Log:
          </p>
          <pre className="text-[10px] font-mono text-red-600 whitespace-pre-wrap">
            {error}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-6xl bg-white dark:bg-slate-900 min-h-screen font-sans overflow-x-hidden text-slate-900 dark:text-emerald-400 dark:**:text-emerald-400 mt-16">
      <header className="mb-4 border-b border-slate-200 dark:border-slate-800 pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <img
            src="/mqa.jpg"
            alt="MQA Logo"
            className="w-12 h-12 rounded-xl object-cover border border-slate-100 dark:border-slate-800"
          />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
              {activeSymbol} Flow Analyzer
              <span className="ml-3 text-xs font-bold bg-blue-100 text-blue-600 px-2 py-1 rounded-md uppercase tracking-wider">
                30-Day Outlook
              </span>
            </h1>
            <div className="mt-1.5 flex flex-col gap-2">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 text-sm font-medium">
                    Price:
                  </span>
                  <span className="font-mono text-xl font-black text-slate-900">
                    ${data?.currentPrice?.toFixed(2)}
                  </span>
                  {lastUpdated && (
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-100 ml-1">
                      {lastUpdated} 데이터입니다.
                    </span>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-slate-400">
                데이터는 10초마다 호출됩니다. 호출량 제한으로 양해 부탁드립니다.
              </p>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-wrap">
                {currentStatus && (
                  <div className="flex items-center gap-2">
                    <span className="hidden sm:inline text-slate-300">|</span>
                    <div className="flex items-center gap-2 bg-slate-50 px-3 py-1 rounded-full border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                        판단:
                      </span>
                      <span
                        className="px-2 py-0.5 rounded-md text-[11px] font-black text-white uppercase tracking-wider shadow-sm"
                        style={{ backgroundColor: currentStatus.color }}
                      >
                        {currentStatus.status}
                      </span>
                      <span className="text-[11px] font-bold text-slate-600 ml-1">
                        {currentStatus.status === "Strong Buy"
                          ? "적극 분할 매수 권장"
                          : currentStatus.status === "Buy"
                          ? "분할 매수 유효 구간"
                          : currentStatus.status === "Neutral"
                          ? "보유 및 추세 관망"
                          : currentStatus.status === "Sell"
                          ? "수익 실현 및 매도 고려"
                          : "위험 관리 및 매도 권장"}
                      </span>
                    </div>
                  </div>
                )}
                {data?.timeSeries?.[0] && (
                  <div className="flex items-center gap-2">
                    <span className="hidden sm:inline text-slate-300">|</span>
                    <div className="flex items-center gap-2 bg-blue-50/50 px-3 py-1 rounded-full border border-blue-100">
                      <span className="text-[10px] font-bold text-blue-500 uppercase tracking-tight">
                        예상 종가:
                      </span>
                      <span className="text-[11px] font-black text-blue-700">
                        ${data.timeSeries[0].expectedPrice.toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}
                {data?.timeSeries?.[0]?.trapWarning && (
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex items-center gap-2 bg-orange-50 px-3 py-1.5 rounded-lg border-2 border-orange-300 animate-pulse">
                      <AlertTriangle className="w-4 h-4 text-orange-600" />
                      <span className="text-[11px] font-bold text-orange-800">
                        {data.timeSeries[0].trapWarning.message}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            onClick={downloadAsText}
            className="flex-1 sm:flex-none p-2 hover:bg-slate-100 dark:hover:bg-slate-900 rounded-xl transition-colors flex items-center justify-center gap-2 px-4 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200"
          >
            <Download className="w-4 h-4" />
            <span className="text-xs font-bold">TXT 저장</span>
          </button>
          <button
            onClick={downloadYahooRaw}
            className="flex-1 sm:flex-none p-2 hover:bg-slate-100 dark:hover:bg-slate-900 rounded-xl transition-colors flex items-center justify-center gap-2 px-4 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200"
          >
            <Download className="w-4 h-4" />
            <span className="text-xs font-bold">원본 TXT</span>
          </button>
          <button
            onClick={() => loadData("QQQ")}
            className="flex-1 sm:flex-none p-2 hover:bg-slate-100 dark:hover:bg-slate-900 rounded-xl transition-colors flex items-center justify-center gap-2 px-4 border border-slate-200 dark:border-slate-700 text-blue-600"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="text-xs font-bold">새로고침</span>
          </button>
        </div>
      </header>

      <div className="fixed top-0 left-0 right-0 z-30 px-4 md:px-6 py-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
       
        <div
          className={`mt-3 flex flex-wrap gap-2  sm:flex`}
        >
          {ASSET_TABS.map((symbol) => (
            <button
              key={symbol}
              type="button"
              onClick={() => {
                handleScrollToAsset(symbol);
        
              }}
              style={{backgroundColor: symbol === activeNavSymbol ? "green !important" : "black"}}
              className={`px-3 py-1 rounded-full text-[11px] font-black border transition-colors ${
                activeNavSymbol === symbol
                  ? "selected-nav-button text-black border-slate-300"
                  : "border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-800"
              }`}
            >
              {symbol}
            </button>
          ))}
        </div>
      </div>
      <div className="h-14" />
      <div className="space-y-8">
        {/* 1. QQQ Section */}
        <AssetSection
          symbol="QQQ"
          assetData={assetDataMap["QQQ"]}
          assetLoading={assetLoadingMap["QQQ"]}
          assetError={assetErrorMap["QQQ"]}
          assetUpdated={assetUpdatedMap["QQQ"]}
          expirations={expirationsBySymbol["QQQ"]}
          expirationType={expirationTypeBySymbol["QQQ"]}
          selectedExpiration={selectedExpirationBySymbol["QQQ"]}
          optionChain={optionChainBySymbol["QQQ"]}
          optionsLoading={optionsLoadingBySymbol["QQQ"]}
          optionsError={optionsErrorBySymbol["QQQ"]}
          sortBy={optionsSortBy["QQQ"]}
          setExpirationType={(symbol, type) =>
            setExpirationTypeBySymbol((prev) => ({ ...prev, [symbol]: type }))
          }
          setSelectedExpiration={(symbol, exp) =>
            setSelectedExpirationBySymbol((prev) => ({ ...prev, [symbol]: exp }))
          }
          setSortBy={(symbol, sort) =>
            setOptionsSortBy((prev) => ({ ...prev, [symbol]: sort }))
          }
          loadAssetOptionChain={loadAssetOptionChain}
          onRef={(el) => {
            assetSectionRefs.current["QQQ"] = el;
          }}
        />

        <QQQExtendedAnalysis
          data={data}
          optionChain={optionChainBySymbol["QQQ"]}
        />

        {/* 2. Ticker Search Section */}
        <TickerSearchSection
          tickerInput={tickerInput}
          setTickerInput={setTickerInput}
          betaPeriod={betaPeriod}
          setBetaPeriod={setBetaPeriod}
          handleTickerSearch={handleTickerSearch}
          tickerLoading={tickerLoading}
          tickerError={tickerError}
          tickerAnalysis={tickerAnalysis}
          activeSymbol={activeSymbol}
          data={data}
          expirationType={expirationType}
          setExpirationType={setExpirationType}
          tickerExpirations={tickerExpirations}
          tickerOptionsLoading={tickerOptionsLoading}
          tickerOptionsError={tickerOptionsError}
          selectedExpiration={selectedExpiration}
          setSelectedExpiration={setSelectedExpiration}
          tickerOptionChain={tickerOptionChain}
        />

        {/* 3. Other Sectors */}
        {ASSET_TABS.filter((s) => s !== "QQQ").map((symbol) => (
          <AssetSection
            key={symbol}
            symbol={symbol}
            assetData={assetDataMap[symbol]}
            assetLoading={assetLoadingMap[symbol]}
            assetError={assetErrorMap[symbol]}
            assetUpdated={assetUpdatedMap[symbol]}
            expirations={expirationsBySymbol[symbol]}
            expirationType={expirationTypeBySymbol[symbol]}
            selectedExpiration={selectedExpirationBySymbol[symbol]}
            optionChain={optionChainBySymbol[symbol]}
            optionsLoading={optionsLoadingBySymbol[symbol]}
            optionsError={optionsErrorBySymbol[symbol]}
            sortBy={optionsSortBy[symbol]}
            setExpirationType={(symbol, type) =>
              setExpirationTypeBySymbol((prev) => ({ ...prev, [symbol]: type }))
            }
            setSelectedExpiration={(symbol, exp) =>
              setSelectedExpirationBySymbol((prev) => ({
                ...prev,
                [symbol]: exp,
              }))
            }
            setSortBy={(symbol, sort) =>
              setOptionsSortBy((prev) => ({ ...prev, [symbol]: sort }))
            }
            loadAssetOptionChain={loadAssetOptionChain}
            onRef={(el) => {
              assetSectionRefs.current[symbol] = el;
            }}
          />
        ))}
      </div>
      <section className="mt-12 mb-8 p-8 border-2 border-slate-700 rounded-3xl bg-black text-center">
        <div className="max-w-md mx-auto">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-slate-900 rounded-full mb-4 border border-slate-700">
            <span className="text-2xl">☕</span>
          </div>
          <h2 className="text-xl font-bold text-emerald-400 mb-2">
            커피 한 잔 선물하기
          </h2>
          <h3 className="text-emerald-300">버그 및 피드백: uuuu66@naver.com</h3>
          <div className="bg-black p-4 rounded-2xl border border-slate-700 mt-4">
            <button
              onClick={() => copyToClipboard("110-417-247456")}
              className="w-full flex justify-between items-center p-3 bg-black rounded-xl hover:bg-slate-900 transition-colors group relative border border-slate-700"
            >
              <span className="text-sm font-semibold text-emerald-300">
                신한은행
              </span>
              <span className="text-sm font-black text-emerald-400 select-all">
                110-417-247456
              </span>
              {copySuccess && (
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-black text-emerald-200 text-[10px] px-3 py-1.5 rounded-lg animate-bounce border border-slate-700">
                  복사되었습니다!
                </div>
              )}
            </button>
            <p className="text-[10px] text-emerald-300 mt-3 font-bold uppercase tracking-wider">
              예금주: 이민기 (클릭 시 복사)
            </p>
          </div>
        </div>
      </section>

      <footer className="mb-12 text-center text-slate-400 text-[10px]">
        <div className="max-w-4xl mx-auto px-4 py-8 border-t border-slate-200">
          <p className="font-bold text-slate-600 mb-3 text-xs uppercase tracking-widest">
            [ Disclaimer / 투자 유의사항 ]
          </p>
          <div className="text-left space-y-3 leading-relaxed max-w-2xl mx-auto">
            <p>
              본 서비스는 옵션 데이터를 분석하여 시장의 잠재적 지지/저항 및 심리
              추세를 시각화합니다. 모든 투자 결정 및 결과에 대한 책임은 투자자
              본인에게 있습니다.
            </p>
          </div>
          <p className="mt-8 pt-6 border-t border-slate-100 italic font-medium">
            © 2026 QQQ Analyzer. Data powered by Yahoo Finance API.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default App;
