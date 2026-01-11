import React, { useEffect, useState, useCallback } from "react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  RefreshCw,
  Download,
  Search,
  Info,
} from "lucide-react";
import {
  fetchQQQData,
  fetchTickerAnalysis,
  type AnalysisResult,
  type Recommendation,
  type TickerAnalysis,
} from "./services/optionService";
import "./App.css";

const App: React.FC = () => {
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  // Ticker Analysis States
  const [tickerInput, setTickerInput] = useState<string>("");
  const [betaPeriod, setBetaPeriod] = useState<number>(1);
  const [tickerAnalysis, setTickerAnalysis] = useState<TickerAnalysis | null>(
    null
  );
  const [tickerLoading, setTickerLoading] = useState<boolean>(false);
  const [tickerError, setTickerError] = useState<string | null>(null);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchQQQData();
      setData(result);
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
      setError(detailedError);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleTickerSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tickerInput || !data) return;

    setTickerLoading(true);
    setTickerError(null);
    try {
      const qqqMin = data.recommendations[0].max;
      const qqqMax = data.recommendations[5].max;

      const result = await fetchTickerAnalysis(
        tickerInput,
        data.currentPrice,
        data.putSupport,
        data.callResistance,
        qqqMin,
        qqqMax,
        betaPeriod
      );
      setTickerAnalysis(result);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "분석에 실패했습니다.";
      setTickerError(message);
      setTickerAnalysis(null);
    } finally {
      setTickerLoading(false);
    }
  };

  const downloadAsText = useCallback(() => {
    if (!data) return;

    let text = `QQQ Analysis Report - ${new Date().toLocaleString()}\n`;
    text += `==========================================\n\n`;
    text += `[ Summary ]\n`;
    text += `Current Price: $${data.currentPrice.toFixed(2)}\n`;
    text += `Total Net GEX: ${data.totalNetGEX}\n`;
    text += `Market Regime: ${data.marketRegime}\n`;
    text += `Gamma Flip: $${data.gammaFlip.toFixed(2)}\n`;
    text += `Volatility Trigger: $${data.volTrigger.toFixed(2)}\n\n`;

    text += `[ Recommendations ]\n`;
    data.recommendations.forEach((rec) => {
      text += `- ${rec.status}: ${rec.priceRange} (${rec.description})\n`;
    });
    text += `\n`;

    text += `[ Market Sentiment & Trend ]\n`;
    text += `Date\tPCR(All)\tPCR(Filtered)\tSentiment Score\tMax Profit Range\tUp/Down/Neutral Prob\n`;
    data.timeSeries.forEach((item) => {
      text += `${item.date}\t${item.pcrAll.toFixed(
        2
      )}\t${item.pcrFiltered.toFixed(2)}\t${item.sentiment.toFixed(
        1
      )}\t${item.profitPotential.toFixed(2)}%\t${
        item.priceProbability?.up ?? 0
      }%/${item.priceProbability?.down ?? 0}%/${
        item.priceProbability?.neutral ?? 0
      }%\n`;
    });
    text += `\n`;

    if (data.swingScenarios && data.swingScenarios.length > 0) {
      text += `[ Swing Strategy Scenarios ]\n`;
      data.swingScenarios.forEach((s) => {
        text += `- ${s.entryDate} Buy ($${s.entryPrice.toFixed(2)}) -> ${
          s.exitDate
        } Base Sell ($${s.exitPrice.toFixed(
          2
        )}) / Ext Sell ($${s.extensionPrice.toFixed(2)}) : +${s.profit.toFixed(
          2
        )}% / +${s.extensionProfit.toFixed(2)}% (Prob: ${s.probability}%)\n`;
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

    if (data.options && data.options.length > 0) {
      text += `[ Top 15 Options by Open Interest ]\n`;
      text += `Type\tStrike\tPrice\tOI\tGEX\n`;
      const topOptions = [...data.options]
        .sort((a, b) => (b.openInterest || 0) - (a.openInterest || 0))
        .slice(0, 15);
      topOptions.forEach((opt) => {
        text += `${opt.type.toUpperCase()}\t$${opt.strike.toFixed(
          2
        )}\t$${opt.lastPrice.toFixed(2)}\t${opt.openInterest}\t${Math.round(
          opt.gex || 0
        ).toLocaleString()}\n`;
      });
    }

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `qqq-analysis-${
      new Date().toISOString().split("T")[0]
    }.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [data]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getCurrentStatus = () => {
    if (!data) return null;
    const price = data.currentPrice;
    return (
      data.recommendations.find((rec) => price >= rec.min && price < rec.max) ||
      data.recommendations[data.recommendations.length - 1]
    );
  };

  const currentStatus = getCurrentStatus();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 font-sans">
        <RefreshCw className="w-12 h-12 animate-spin text-blue-500 mb-4" />
        <p className="text-xl font-semibold text-slate-700">
          실시간 QQQ 옵션 흐름 분석 중...
        </p>
      </div>
    );
  }

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
          onClick={loadData}
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
    <div className="container mx-auto p-4 md:p-6 max-w-6xl bg-white min-h-screen font-sans overflow-x-hidden">
      <header className="mb-8 border-b pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
            QQQ Flow Analyzer
          </h1>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-1.5">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-sm font-medium">Price:</span>
              <span className="font-mono text-xl font-black text-slate-900">
                ${data?.currentPrice?.toFixed(2)}
              </span>
            </div>
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
                      ? "분할 매수 권장"
                      : currentStatus.status === "Buy"
                      ? "매수 or 관망 권장"
                      : currentStatus.status === "Neutral"
                      ? "관망 및 보유 추천"
                      : "분할 매도/리스크 관리 권장"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            onClick={downloadAsText}
            className="flex-1 sm:flex-none p-2 hover:bg-slate-100 rounded-xl transition-colors flex items-center justify-center gap-2 px-4 border border-slate-200 text-slate-600"
          >
            <Download className="w-4 h-4" />
            <span className="text-xs font-bold">TXT 저장</span>
          </button>
          <button
            onClick={loadData}
            className="flex-1 sm:flex-none p-2 hover:bg-slate-100 rounded-xl transition-colors flex items-center justify-center gap-2 px-4 border border-slate-200 text-blue-600"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            <span className="text-xs font-bold">새로고침</span>
          </button>
        </div>
      </header>

      {/* Analysis Table */}
      <div className="mb-10 overflow-x-auto rounded-2xl border border-slate-200 shadow-sm relative">
        <table className="w-full text-left border-collapse min-w-[600px]">
          <thead>
            <tr className="bg-slate-50 border-b">
              <th className="px-6 py-4 font-semibold text-slate-700 text-sm">
                포지션
              </th>
              <th className="px-6 py-4 font-semibold text-slate-700 text-sm">
                모델 설명
              </th>
              <th className="px-6 py-4 font-semibold text-slate-700 text-sm">
                가격 범위 ($)
              </th>
            </tr>
          </thead>
          <tbody>
            {data?.recommendations.map((rec: Recommendation, index: number) => {
              const isCurrent = currentStatus?.status === rec.status;
              return (
                <tr
                  key={index}
                  className={`border-b last:border-b-0 transition-all duration-300 ${
                    isCurrent
                      ? "bg-slate-50 ring-2 ring-inset ring-blue-500/20"
                      : "hover:bg-slate-50/50"
                  }`}
                >
                  <td
                    className="px-6 py-4 font-bold text-sm"
                    style={{ color: rec.color }}
                  >
                    <div className="flex items-center gap-2">
                      {index < 1 ? (
                        <AlertTriangle className="w-4 h-4" />
                      ) : index < 3 ? (
                        <TrendingUp className="w-4 h-4" />
                      ) : index === 3 ? (
                        <Minus className="w-4 h-4" />
                      ) : (
                        <TrendingDown className="w-4 h-4" />
                      )}
                      {rec.status}
                      {isCurrent && (
                        <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                      )}
                    </div>
                  </td>
                  <td
                    className={`px-6 py-4 text-sm ${
                      isCurrent
                        ? "text-slate-900 font-semibold"
                        : "text-slate-600"
                    }`}
                  >
                    {rec.description}
                  </td>
                  <td
                    className={`px-6 py-4 font-mono text-sm ${
                      isCurrent ? "text-slate-900 font-bold" : "text-slate-800"
                    }`}
                  >
                    {isCurrent && <span className="text-blue-500 mr-2">▶</span>}
                    {rec.priceRange}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Charts Section */}
      <div className="space-y-8">
        <section className="p-4 md:p-6 border rounded-2xl shadow-sm bg-white overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4 border-b pb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800">
                만기일별 지지/저항 및 시장 방어력
              </h2>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
                <p className="flex items-center gap-2 text-xs text-red-600 font-bold">
                  <span className="w-4 h-0 border-t-2 border-dashed border-red-500"></span>
                  빨간 점선: 이번엔 여기 못 넘겠지? (천장)
                </p>
                <p className="flex items-center gap-2 text-xs text-blue-600 font-bold">
                  <span className="w-4 h-0 border-t-2 border-dashed border-blue-500"></span>
                  파란 점선: 이번엔 여기 안 뚫리겠지? (바닥)
                </p>
                <p className="flex items-center gap-2 text-xs text-slate-500 font-bold">
                  <span className="w-4 h-3 bg-blue-500/10 border border-blue-200 rounded-sm"></span>
                  파란 구름: 시장 방어력 (GEX 에너지 강도)
                </p>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto pb-4 custom-scrollbar">
            <div className="h-[400px] min-w-[900px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={data?.timeSeries}
                  margin={{ top: 20, right: 40, left: 10, bottom: 20 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#f1f5f9"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fontWeight: 600 }}
                    stroke="#64748b"
                    padding={{ left: 30, right: 30 }}
                  />
                  <YAxis
                    yAxisId="left"
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 11, fontWeight: 600 }}
                    stroke="#64748b"
                    label={{
                      value: "Price ($)",
                      angle: -90,
                      position: "insideLeft",
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11, fontWeight: 600 }}
                    stroke="#3b82f6"
                    label={{
                      value: "GEX Energy",
                      angle: 90,
                      position: "insideRight",
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "16px",
                      border: "none",
                      boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1)",
                      fontSize: "12px",
                      padding: "12px",
                    }}
                    cursor={{ stroke: "#e2e8f0", strokeWidth: 2 }}
                  />

                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey={(item) => Math.abs(item.totalGex) / 1000000}
                    fill="#3b82f6"
                    stroke="none"
                    fillOpacity={0.08}
                    name="GEX 에너지"
                  />

                  <Line
                    yAxisId="left"
                    type="stepAfter"
                    dataKey="callResistance"
                    stroke="#ef4444"
                    strokeDasharray="6 4"
                    strokeWidth={2}
                    dot={{ r: 4, fill: "#ef4444" }}
                    name="콜 저항선"
                  />
                  <Line
                    yAxisId="left"
                    type="stepAfter"
                    dataKey="putSupport"
                    stroke="#3b82f6"
                    strokeDasharray="6 4"
                    strokeWidth={2}
                    dot={{ r: 4, fill: "#3b82f6" }}
                    name="풋 지지선"
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="gammaFlip"
                    stroke="#94a3b8"
                    strokeDasharray="3 3"
                    strokeWidth={1}
                    dot={false}
                    name="감마 플립 (Flip)"
                  />

                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey={() => data?.currentPrice}
                    stroke="#1e293b"
                    strokeWidth={1}
                    dot={false}
                    strokeOpacity={0.4}
                    name="현재가"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="p-4 md:p-6 border rounded-2xl shadow-sm bg-white overflow-hidden">
          <div className="mb-6 border-b pb-4">
            <h2 className="text-xl font-bold text-slate-800">
              만기일별 시장 심리 추세
            </h2>
            <p className="mt-2 flex items-center gap-2 text-xs text-emerald-600 font-bold">
              <span className="w-4 h-0.5 bg-emerald-500"></span>
              초록 실선: 시장 심리 추세 (+20 이상 상승 우세 / -20 이하 하락
              우세)
            </p>
          </div>

          <div className="overflow-x-auto pb-4 custom-scrollbar">
            <div className="h-[250px] min-w-[900px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={data?.timeSeries}
                  margin={{ top: 10, right: 40, left: 10, bottom: 10 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#f1f5f9"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fontWeight: 600 }}
                    stroke="#64748b"
                    padding={{ left: 30, right: 30 }}
                  />
                  <YAxis
                    domain={[-100, 100]}
                    tick={{ fontSize: 11, fontWeight: 600 }}
                    stroke="#10b981"
                    label={{
                      value: "Sentiment",
                      angle: -90,
                      position: "insideLeft",
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "16px",
                      border: "none",
                      boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1)",
                      fontSize: "12px",
                      padding: "12px",
                    }}
                    cursor={{ stroke: "#e2e8f0", strokeWidth: 2 }}
                  />

                  <ReferenceArea
                    y1={-20}
                    y2={20}
                    fill="#94a3b8"
                    fillOpacity={0.1}
                  />
                  <ReferenceLine
                    y={0}
                    stroke="#94a3b8"
                    strokeDasharray="3 3"
                    strokeOpacity={0.5}
                  />

                  <Line
                    type="monotone"
                    dataKey="sentiment"
                    stroke="#10b981"
                    strokeWidth={3}
                    dot={{ r: 4, fill: "#10b981" }}
                    name="시장 추세 (Sentiment)"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-12">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-500" />
            복합 일자별 스윙 시나리오 (Swing Strategy)
          </h3>
          <div className="space-y-4">
            {data?.swingScenarios?.map((scenario, idx) => (
              <div
                key={idx}
                className="p-4 bg-blue-50/50 rounded-xl border border-blue-100"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">
                    {scenario.entryDate} → {scenario.exitDate}
                  </span>
                  <div className="text-right">
                    <span className="block text-sm font-black text-emerald-600">
                      +{scenario.profit.toFixed(2)}%
                    </span>
                    <span className="text-[10px] font-bold text-blue-400">
                      확률: {scenario.probability}%
                    </span>
                  </div>
                </div>
                <div className="text-xs text-slate-600 font-medium">
                  {scenario.description}
                </div>
                <div className="mt-2 flex flex-col gap-1 text-[11px] font-mono text-slate-500">
                  <div className="flex items-center gap-2">
                    <span className="w-12 text-slate-400 font-bold">진입</span>
                    <span>Buy @ ${scenario.entryPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-12 text-blue-500 font-bold">기본</span>
                    <span>Sell @ ${scenario.exitPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-12 text-red-500 font-bold">확장</span>
                    <span>
                      Sell @ ${scenario.extensionPrice.toFixed(2)}
                      (조건부)
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {(!data?.swingScenarios || data?.swingScenarios.length === 0) && (
              <p className="text-sm text-slate-400 text-center py-4">
                충분한 데이터가 확보되지 않았습니다.
              </p>
            )}

            {/* Swing Probability Methodology */}
            <div className="mt-6 pt-6 border-t border-slate-100">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                <Info className="w-3 h-3" /> 시나리오 확률 산출 로직
              </h4>
              <div className="bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                <code className="text-[9px] block text-slate-500 leading-relaxed font-mono">
                  Score = 55% (Base)
                  <br />
                  + ΔSentiment * 0.4 (심리 개선도)
                  <br />
                  + GEX Trend (방어력 추세 ±5%)
                  <br />
                  + (Up - Down) * 0.2 (청산일 분포)
                  <br />- Duration * 2% (기간 불확실성)
                </code>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-500" />
            시장 방향성 및 확률 예측 (Trend Forecast)
          </h3>
          <div className="space-y-6">
            {data?.trendForecast?.map((forecast, idx) => (
              <div key={idx}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`px-3 py-1 rounded-full text-xs font-black text-white uppercase tracking-wider ${
                        forecast.direction === "상승"
                          ? "bg-emerald-500"
                          : forecast.direction === "하락"
                          ? "bg-red-500"
                          : "bg-slate-400"
                      }`}
                    >
                      {forecast.direction}
                    </div>
                    <span className="text-xs text-slate-400 font-bold font-mono">
                      {forecast.period}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-1">
                      예측 신뢰도
                    </div>
                    <div className="text-2xl font-black text-indigo-600">
                      {forecast.probability}%
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-sm text-slate-700 leading-relaxed font-medium">
                  {forecast.description}
                </div>
              </div>
            ))}
            {(!data?.trendForecast || data?.trendForecast.length === 0) && (
              <p className="text-sm text-slate-400 text-center py-4">
                추세 분석을 위한 데이터가 부족합니다.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 mt-12">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-purple-500" />
            만기별 옵션 분포 기반 가격 변동 확률 (Option Distribution
            Probabilities)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data?.timeSeries?.slice(0, 6).map((item, idx) => (
              <div
                key={idx}
                className="p-5 rounded-2xl border border-slate-100 bg-slate-50/50"
              >
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 pb-2 border-b border-slate-200/50">
                  {item.date} 만기 분포 분석
                </div>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-[11px] font-bold mb-1.5">
                      <span className="text-emerald-600">상승 확률</span>
                      <span className="text-slate-900">
                        {item.priceProbability?.up ?? 0}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-1000"
                        style={{
                          width: `${item.priceProbability?.up ?? 0}%`,
                        }}
                      ></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] font-bold mb-1.5">
                      <span className="text-red-600">하락 확률</span>
                      <span className="text-slate-900">
                        {item.priceProbability?.down ?? 0}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-500 transition-all duration-1000"
                        style={{
                          width: `${item.priceProbability?.down ?? 0}%`,
                        }}
                      ></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] font-bold mb-1.5">
                      <span className="text-slate-500">횡보 확률</span>
                      <span className="text-slate-900">
                        {item.priceProbability?.neutral ?? 0}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-slate-400 transition-all duration-1000"
                        style={{
                          width: `${item.priceProbability?.neutral ?? 0}%`,
                        }}
                      ></div>
                    </div>
                  </div>
                </div>
                <p className="mt-4 text-[9px] text-slate-400 leading-relaxed">
                  * 해당 만기일의 콜/풋 GEX 에너지 분포 및 외가격(OTM) 옵션
                  비중을 분석한 통계적 기대 확률입니다.
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-12">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-500" />
            일자별 최적 매매 시나리오 (Max Profit)
          </h3>
          <div className="space-y-4">
            {data?.timeSeries?.slice(0, 5).map((item, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100"
              >
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                    {item.date} 만기 시나리오
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-bold text-blue-600">
                      Buy @ ${item.putSupport.toFixed(2)}
                    </span>
                    <span className="text-slate-300">→</span>
                    <span className="font-bold text-red-600">
                      Sell @ ${item.callResistance.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-1">
                    최대 기대수익
                  </div>
                  <div className="text-lg font-black text-emerald-600">
                    {item.profitPotential <= 0
                      ? "Range-bound"
                      : `+${item.profitPotential.toFixed(2)}%`}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-4 leading-relaxed">
            * 본 시나리오는 GEX 에너지 최대 밀집 구간인 Put Wall(매수)과 Call
            Wall(매도)을 기반으로 한 이론적 최대 변동폭입니다. 실제 시장 상황에
            따라 도달하지 못할 수 있습니다.
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            시장 리스크 및 변동성 트리거
          </h3>
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
              <div className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1">
                감마 플립 (Gamma Flip)
              </div>
              <div className="text-xl font-black text-amber-900">
                ${data?.gammaFlip.toFixed(2)}
              </div>
              <p className="text-[11px] text-amber-700 mt-1">
                이 가격 아래로 하락 시 시장의 변동성이 급격히 확대되는
                임계점입니다.
              </p>
            </div>
            <div className="p-4 bg-rose-50 rounded-xl border border-rose-100">
              <div className="text-[10px] font-bold text-rose-600 uppercase tracking-widest mb-1">
                변동성 트리거 (Volatility Trigger)
              </div>
              <div className="text-xl font-black text-rose-900">
                ${data?.volTrigger.toFixed(2)}
              </div>
              <p className="text-[11px] text-rose-700 mt-1">
                감마 플립 하단 지지선으로, 돌파 시 패닉 셀링이 가속화될 수
                있습니다.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Ticker Search Section */}
      <section className="mt-12 p-6 md:p-8 border border-slate-200 rounded-3xl bg-slate-50/50 shadow-sm">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-slate-800 mb-2">
              개별 티커 베타 분석
            </h2>
            <p className="text-sm text-slate-500">
              QQQ GEX 데이터와 개별 주식의 베타($\beta$)를 결합하여 예상
              지지/저항선을 계산합니다.
            </p>
          </div>

          <form
            onSubmit={handleTickerSearch}
            className="flex flex-col sm:flex-row gap-2 mb-6"
          >
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                placeholder="티커 입력 (예: TSLA, NVDA)"
                className="w-full pl-12 pr-4 py-3.5 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={betaPeriod}
                onChange={(e) => setBetaPeriod(Number(e.target.value))}
                className="px-4 py-3.5 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold text-slate-700 text-sm appearance-none cursor-pointer"
              >
                <option value={1}>1개월 베타</option>
                <option value={3}>3개월 베타</option>
                <option value={6}>6개월 베타</option>
                <option value={12}>1년 베타</option>
                <option value={24}>2년 베타</option>
              </select>
              <button
                type="submit"
                disabled={tickerLoading || !data}
                className="px-6 py-3.5 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center gap-2 whitespace-nowrap shadow-lg shadow-slate-200"
              >
                {tickerLoading ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  "분석하기"
                )}
              </button>
            </div>
          </form>

          <p className="text-[11px] text-slate-400 mb-6 leading-relaxed bg-slate-100/50 p-3 rounded-xl border border-slate-200/50">
            <span className="font-bold text-slate-500 mr-1">※ 주의:</span> 본
            분석은 베타계수를 활용한 통계적 추정치이며 실제 주가 흐름과 다를 수
            있습니다. 특히 중소형주나 나스닥 100 지수에 포함되지 않은 종목은
            지수와의 상관관계가 낮아 분석 결과의 부정확도가 높을 수 있으니 단순
            참고용으로만 활용하시기 바랍니다.
          </p>

          {tickerError && (
            <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-medium flex items-center gap-2 mb-6 border border-red-100">
              <AlertTriangle className="w-4 h-4" />
              {tickerError}
            </div>
          )}

          {tickerAnalysis && (
            <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-3xl font-black text-slate-900 tracking-tight">
                    {tickerAnalysis.symbol}
                  </h3>
                  <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">
                    Beta-Adjusted Analysis
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-mono font-black text-slate-900">
                    ${tickerAnalysis.currentPrice.toFixed(2)}
                  </div>
                  <div
                    className={`text-sm font-bold ${
                      tickerAnalysis.changePercent >= 0
                        ? "text-emerald-500"
                        : "text-red-500"
                    }`}
                  >
                    {tickerAnalysis.changePercent >= 0 ? "+" : ""}
                    {tickerAnalysis.changePercent.toFixed(2)}%
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 하방 지지선 그룹 */}
                <div className="space-y-4">
                  <div className="p-6 bg-slate-100/50 rounded-2xl border border-slate-200">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
                      최저 위험선 (Extreme Risk)
                    </div>
                    <div className="text-2xl font-mono font-black text-slate-700">
                      ${tickerAnalysis.expectedMin.toFixed(2)}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-2 font-medium">
                      QQQ가 ${data?.recommendations[0].max.toFixed(2)}까지
                      폭락할 때
                    </p>
                  </div>

                  <div className="p-6 bg-blue-50 rounded-2xl border border-blue-100">
                    <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-2">
                      예상 지지선 (Support)
                    </div>
                    <div className="text-2xl font-mono font-black text-blue-900">
                      ${tickerAnalysis.expectedSupport.toFixed(2)}
                    </div>
                    <p className="text-[11px] text-blue-600/70 mt-2 font-medium">
                      QQQ가 ${data?.putSupport.toFixed(2)}까지 밀릴 때
                    </p>
                  </div>
                </div>

                {/* 상방 저항선 그룹 */}
                <div className="space-y-4">
                  <div className="p-6 bg-red-50 rounded-2xl border border-red-100">
                    <div className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-2">
                      예상 저항선 (Resistance)
                    </div>
                    <div className="text-2xl font-mono font-black text-red-900">
                      ${tickerAnalysis.expectedResistance.toFixed(2)}
                    </div>
                    <p className="text-[11px] text-red-600/70 mt-2 font-medium">
                      QQQ가 ${data?.callResistance.toFixed(2)}까지 오를 때
                    </p>
                  </div>

                  <div className="p-6 bg-orange-50 rounded-2xl border border-orange-100">
                    <div className="text-[10px] font-bold text-orange-500 uppercase tracking-widest mb-2">
                      최대 목표선 (Strong Sell)
                    </div>
                    <div className="text-2xl font-mono font-black text-orange-900">
                      ${tickerAnalysis.expectedMax.toFixed(2)}
                    </div>
                    <p className="text-[11px] text-orange-600/70 mt-2 font-medium">
                      QQQ가 ${data?.recommendations[5].max.toFixed(2)}까지
                      과열될 때
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 bg-slate-50 rounded-2xl flex items-center justify-between border border-slate-100">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-tight">
                  적용 베타 ($\beta$)
                </span>
                <div className="flex flex-col items-end">
                  <span className="font-mono font-bold text-slate-700 bg-white px-3 py-1 rounded-lg border border-slate-200">
                    {tickerAnalysis.beta.toFixed(2)}
                  </span>
                  <span className="text-[9px] text-slate-400 mt-1 font-medium">
                    *최근{" "}
                    {betaPeriod >= 12
                      ? `${betaPeriod / 12}년`
                      : `${betaPeriod}개월`}{" "}
                    일일 수익률 기반 정밀 계산
                  </span>
                </div>
              </div>

              {/* Formula Explanation Section */}
              <div className="mt-8 pt-6 border-t border-slate-100">
                <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5" /> 분석 계산 공식
                  (Methodology)
                </h4>
                <div className="space-y-4 bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                  <div>
                    <p className="text-[11px] font-bold text-slate-600 mb-1">
                      1. 실시간 베타계수 ($\beta$) 산출
                    </p>
                    <code className="text-[10px] block bg-white p-2 rounded-lg border border-slate-200 text-slate-500 leading-relaxed font-mono">
                      Beta = Cov(r_stock, r_qqq) / Var(r_qqq)
                      <br />
                      *r: 최근{" "}
                      {betaPeriod >= 12
                        ? `${betaPeriod / 12}년`
                        : `${betaPeriod}개월`}
                      간의 일일 로그 수익률 (Daily Returns)
                    </code>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-slate-600 mb-1">
                      2. 기대 가격 (Target Price) 예측
                    </p>
                    <code className="text-[10px] block bg-white p-2 rounded-lg border border-slate-200 text-slate-500 leading-relaxed font-mono">
                      Target = Current * (1 + Beta * (QQQ_Target / QQQ_Current -
                      1))
                    </code>
                    <p className="text-[9px] text-slate-400 mt-2 leading-relaxed">
                      * 본 공식은 자본자산가격결정모델(CAPM)의 원리를 응용하여,
                      시장(QQQ) 변동에 따른 개별 자산의 민감도를 가격에 투영한
                      결과입니다.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="mt-12 mb-8 p-8 border-2 border-dashed border-blue-100 rounded-3xl bg-blue-50/30 text-center">
        <div className="max-w-md mx-auto">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-4">
            <span className="text-2xl">☕</span>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">
            커피 한 잔 선물하기
          </h2>
          <h3>버그 및 피드백: uuuu66@naver.com</h3>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-blue-100 mt-4">
            <button
              onClick={() => copyToClipboard("110-417-247456")}
              className="w-full flex justify-between items-center p-3 bg-slate-50 rounded-xl hover:bg-blue-50 transition-colors group relative"
            >
              <span className="text-sm font-semibold text-slate-500">
                신한은행
              </span>
              <span className="text-sm font-black text-slate-800 select-all">
                110-417-247456
              </span>
              {copySuccess && (
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] px-3 py-1.5 rounded-lg animate-bounce">
                  복사되었습니다!
                </div>
              )}
            </button>
            <p className="text-[10px] text-slate-400 mt-3 font-bold uppercase tracking-wider">
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
