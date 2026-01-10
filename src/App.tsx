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
  Info,
} from "lucide-react";
import {
  fetchQQQData,
  type AnalysisResult,
  type Recommendation,
} from "./services/optionService";
import "./App.css";

const App: React.FC = () => {
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

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
    text += `Date\tPCR(All)\tPCR(Filtered)\tSentiment Score\n`;
    data.timeSeries.forEach((item) => {
      text += `${item.date}\t${item.pcrAll.toFixed(
        2
      )}\t${item.pcrFiltered.toFixed(2)}\t${item.sentiment.toFixed(1)}\n`;
    });
    text += `\n`;

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
                    {currentStatus.status === "Strong Buy" ||
                    currentStatus.status === "Buy"
                      ? "적극 매수 권장"
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

      <section className="mt-12 mb-8 p-8 border-2 border-dashed border-blue-100 rounded-3xl bg-blue-50/30 text-center">
        <div className="max-w-md mx-auto">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-4">
            <span className="text-2xl">☕</span>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">
            커피 한 잔 선물하기
          </h2>
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
