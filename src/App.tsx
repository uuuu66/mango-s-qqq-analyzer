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
        detailedError = JSON.stringify(err, Object.getOwnPropertyNames(err), 2);
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
    text += `Total GEX: ${data.totalGex.toLocaleString()}\n\n`;

    text += `[ Recommendations ]\n`;
    data.recommendations.forEach((rec) => {
      text += `- ${rec.status}: ${rec.priceRange} (${rec.description})\n`;
    });
    text += `\n`;

    text += `[ Market Sentiment & Trend ]\n`;
    text += `Date\tPCR (OI)\tSentiment Score (-100 to 100)\n`;
    data.timeSeries.forEach((item) => {
      text += `${item.date}\t${item.pcr.toFixed(2)}\t${item.sentiment.toFixed(
        1
      )}\n`;
    });
    text += `\n`;

    if (data.options && data.options.length > 0) {
      text += `[ Top 15 Options by Open Interest ]\n`;
      text += `Type\tStrike\tPrice\tOI\tGEX\n`;
      const topOptions = [...data.options]
        .sort((a, b) => (b.openInterest || 0) - (a.openInterest || 0))
        .slice(0, 15);
      topOptions.forEach((opt) => {
        text += `${opt.type.toUpperCase()}\t$${opt.strike}\t$${
          opt.lastPrice
        }\t${opt.openInterest}\t${Math.round(opt.gex || 0).toLocaleString()}\n`;
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
          <p className="text-slate-500 text-sm">
            Current Price:{" "}
            <span className="font-mono font-bold text-blue-600">
              ${data?.currentPrice?.toFixed(2)}
            </span>
          </p>
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
      <div className="mb-10 overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
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
            {data?.recommendations.map((rec: Recommendation, index: number) => (
              <tr
                key={index}
                className="border-b last:border-b-0 hover:bg-slate-50 transition-colors"
              >
                <td
                  className="px-6 py-4 font-bold text-sm"
                  style={{ color: rec.color }}
                >
                  <div className="flex items-center gap-2">
                    {index < 2 ? (
                      <TrendingUp className="w-4 h-4" />
                    ) : index === 2 ? (
                      <Minus className="w-4 h-4" />
                    ) : (
                      <TrendingDown className="w-4 h-4" />
                    )}
                    {rec.status}
                  </div>
                </td>
                <td className="px-6 py-4 text-slate-600 text-sm">
                  {rec.description}
                </td>
                <td className="px-6 py-4 font-mono font-medium text-slate-800 text-sm">
                  {rec.priceRange}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Main Charts Section */}
      <div className="space-y-8">
        {/* Price & GEX Chart */}
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

                  {/* GEX Area */}
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey={(item) => Math.abs(item.totalGex) / 1000000}
                    fill="#3b82f6"
                    stroke="none"
                    fillOpacity={0.08}
                    name="GEX 에너지"
                  />

                  {/* Support/Resistance Lines */}
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

                  {/* Current Price Reference */}
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

        {/* Market Sentiment Chart */}
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

                  {/* Neutral Zone Reference */}
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

                  {/* Sentiment Line */}
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

      {/* Donation & Disclaimer */}
      <section className="mt-12 mb-8 p-8 border-2 border-dashed border-blue-100 rounded-3xl bg-blue-50/30 text-center">
        <div className="max-w-md mx-auto">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-4">
            <span className="text-2xl">☕</span>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">
            커피 한 잔 선물하기
          </h2>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-blue-100 mt-4">
            <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
              <span className="text-sm font-semibold text-slate-500">
                신한은행
              </span>
              <span className="text-sm font-black text-slate-800 select-all">
                110-417-247456
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-3 font-bold uppercase tracking-wider">
              예금주: 이민기
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
