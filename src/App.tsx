import React, { useEffect, useState, useCallback } from "react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { fetchQQQData, type AnalysisResult } from "./services/optionService";
import "./App.css";

const App: React.FC = () => {
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const setMockData = useCallback(() => {
    const mockCurrentPrice = 485.2;
    const strikes = Array.from({ length: 20 }, (_, i) => 470 + i * 2);
    const mockOptions = strikes.flatMap((strike) => [
      {
        strike,
        type: "call" as const,
        openInterest: Math.floor(Math.random() * 5000),
        gex: Math.random() * 1000000,
        lastPrice: 5,
        change: 0.1,
        percentChange: 2,
        volume: 100,
        impliedVolatility: 0.15,
        expiration: new Date(),
      },
      {
        strike,
        type: "put" as const,
        openInterest: Math.floor(Math.random() * 5000),
        gex: -Math.random() * 1000000,
        lastPrice: 5,
        change: -0.1,
        percentChange: -2,
        volume: 100,
        impliedVolatility: 0.15,
        expiration: new Date(),
      },
    ]);

    const callResistance = 500;
    const putSupport = 470;

    setData({
      currentPrice: mockCurrentPrice,
      options: mockOptions,
      callResistance,
      putSupport,
      totalGex: 5000000,
      recommendations: [
        {
          status: "Strong Buy",
          description: "GEX Positive & Price near Put Support",
          priceRange: `465 - 475`,
          color: "#22c55e",
        },
        {
          status: "Buy",
          description: "GEX Turning Positive",
          priceRange: `475 - 482`,
          color: "#86efac",
        },
        {
          status: "Wait/Neutral",
          description: "Balanced Market",
          priceRange: `482 - 488`,
          color: "#94a3b8",
        },
        {
          status: "Sell",
          description: "GEX Turning Negative",
          priceRange: `488 - 495`,
          color: "#fca5a5",
        },
        {
          status: "Strong Sell",
          description: "GEX Negative & Price near Call Resistance",
          priceRange: `495 - 505`,
          color: "#ef4444",
        },
      ],
    });
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchQQQData();
      setData(result);
    } catch (err) {
      console.error(err);
      setError(
        "데이터를 가져오는 중 오류가 발생했습니다. (CORS 제한 또는 API 응답 오류)"
      );
      // Fallback to mock data for demonstration if API fails
      setMockData();
    } finally {
      setLoading(false);
    }
  }, [setMockData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50">
        <RefreshCw className="w-12 h-12 animate-spin text-blue-500 mb-4" />
        <p className="text-xl font-semibold text-slate-700">
          QQQ 옵션 현황 분석 중...
        </p>
      </div>
    );
  }

  interface ChartDataItem {
    strike: number;
    callOI: number;
    putOI: number;
    callGex: number;
    putGex: number;
    price: number;
    resistance: number;
    support: number;
  }

  const chartData: ChartDataItem[] =
    data?.options
      .reduce((acc: ChartDataItem[], opt) => {
        const existing = acc.find((a) => a.strike === opt.strike);
        if (existing) {
          if (opt.type === "call") {
            existing.callOI = opt.openInterest;
            existing.callGex = opt.gex || 0;
          } else {
            existing.putOI = opt.openInterest;
            existing.putGex = Math.abs(opt.gex || 0);
          }
        } else {
          acc.push({
            strike: opt.strike,
            callOI: opt.type === "call" ? opt.openInterest : 0,
            putOI: opt.type === "put" ? opt.openInterest : 0,
            callGex: opt.type === "call" ? opt.gex || 0 : 0,
            putGex: opt.type === "put" ? Math.abs(opt.gex || 0) : 0,
            price: data.currentPrice,
            resistance: data.callResistance,
            support: data.putSupport,
          });
        }
        return acc;
      }, [])
      .sort((a, b) => a.strike - b.strike) || [];

  return (
    <div className="container mx-auto p-6 max-w-6xl bg-white min-h-screen font-sans">
      <header className="mb-8 border-b pb-4 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            QQQ Option Market Analysis
          </h1>
          <p className="text-slate-500">
            Current QQQ Price:{" "}
            <span className="font-mono font-bold text-blue-600">
              ${data?.currentPrice.toFixed(2)}
            </span>
          </p>
        </div>
        <button
          onClick={loadData}
          className="p-2 hover:bg-slate-100 rounded-full transition-colors"
          title="Refresh Data"
        >
          <RefreshCw className="w-6 h-6 text-slate-600" />
        </button>
      </header>

      {error && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3 text-amber-800">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm">{error} - 데모 데이터를 표시합니다.</p>
        </div>
      )}

      {/* Analysis Table */}
      <section className="mb-10 overflow-hidden border rounded-xl shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b">
              <th className="px-6 py-4 font-semibold text-slate-700">
                매수/매도 추천
              </th>
              <th className="px-6 py-4 font-semibold text-slate-700">설명</th>
              <th className="px-6 py-4 font-semibold text-slate-700">
                추천 범위
              </th>
            </tr>
          </thead>
          <tbody>
            {data?.recommendations.map((rec, index) => (
              <tr
                key={index}
                className="border-b last:border-b-0 hover:bg-slate-50 transition-colors"
              >
                <td
                  className="px-6 py-4 font-bold"
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
                <td className="px-6 py-4 text-slate-600">{rec.description}</td>
                <td className="px-6 py-4 font-mono font-medium text-slate-800">
                  {rec.priceRange}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Graph Section */}
      <section className="p-6 border rounded-xl shadow-sm bg-white">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-slate-800">
            Option Market Analysis: Put Support Adjusted
          </h2>
          <div className="flex gap-4 text-xs font-medium">
            <div className="flex items-center gap-1">
              <span className="w-3 h-0.5 border-t-2 border-dashed border-red-500"></span>{" "}
              Call Resistance
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-0.5 border-t-2 border-dashed border-blue-500"></span>{" "}
              Put Support
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 bg-green-100 rounded-sm"></span> OI
              Normalized (%)
            </div>
          </div>
        </div>

        <div className="h-[450px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#f1f5f9"
              />
              <XAxis
                dataKey="strike"
                label={{ value: "Strike Price", position: "bottom", offset: 0 }}
                tick={{ fontSize: 12 }}
                stroke="#64748b"
              />
              <YAxis
                yAxisId="left"
                label={{
                  value: "OI / GEX",
                  angle: -90,
                  position: "insideLeft",
                  offset: 10,
                }}
                tick={{ fontSize: 12 }}
                stroke="#64748b"
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={[0, 100]}
                label={{
                  value: "OI Normalized (%)",
                  angle: 90,
                  position: "insideRight",
                  offset: 10,
                }}
                tick={{ fontSize: 12 }}
                stroke="#64748b"
              />
              <Tooltip
                contentStyle={{
                  borderRadius: "8px",
                  border: "none",
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
              />
              <Legend verticalAlign="top" height={36} />

              <Bar
                yAxisId="right"
                dataKey="putOI"
                fill="#dcfce7"
                name="Put OI (%)"
                radius={[2, 2, 0, 0]}
              />
              <Bar
                yAxisId="right"
                dataKey="callOI"
                fill="#fee2e2"
                name="Call OI (%)"
                radius={[2, 2, 0, 0]}
              />

              <Line
                yAxisId="left"
                type="monotone"
                dataKey="resistance"
                stroke="#ef4444"
                strokeDasharray="5 5"
                strokeWidth={2}
                dot={false}
                name="Call Resistance"
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="support"
                stroke="#3b82f6"
                strokeDasharray="5 5"
                strokeWidth={2}
                dot={false}
                name="Put Support"
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="callGex"
                stroke="#b91c1c"
                strokeWidth={2}
                dot={{ r: 4, fill: "#b91c1c" }}
                name="Call GEX"
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="putGex"
                stroke="#1d4ed8"
                strokeWidth={2}
                dot={{ r: 4, fill: "#1d4ed8" }}
                name="Put GEX"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 text-center text-sm text-blue-600 font-medium">
          Put Support Updated ({data?.putSupport})
        </div>
      </section>

      {/* Donation Section */}
      <section className="mb-12 p-8 border-2 border-dashed border-blue-100 rounded-2xl bg-blue-50/30 text-center">
        <div className="max-w-md mx-auto">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-4">
            <span className="text-2xl">☕</span>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">
            커피 한 잔 선물하기
          </h2>
          <p className="text-slate-600 text-sm mb-6">
            이 도구가 도움이 되셨나요? 작은 후원은 더 나은 분석 도구를 개발하는
            데 큰 힘이 됩니다.
          </p>
          <p>피드백 or 버그 제포: uuuu66@naver.com</p>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-blue-100 inline-block w-full">
            <p className="text-xs text-slate-400 uppercase tracking-wider mb-2 font-semibold"></p>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                <span className="text-sm font-medium text-slate-500">
                  신한은행
                </span>
                <span className="text-sm font-bold text-slate-800 select-all">
                  110-417-247456
                </span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                * 예금주: 이민기
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="mt-12 mb-8 text-center text-slate-400 text-sm">
        <div className="max-w-4xl mx-auto px-6 py-8 border-t border-slate-200">
          <p className="font-bold text-slate-600 mb-3 text-base">
            [ Disclaimer / 투자 유의사항 ]
          </p>
          <div className="text-left space-y-3 text-xs leading-relaxed text-slate-500">
            <p>
              본 사이트에서 제공하는 모든 정보는 옵션 데이터(GEX 등)를 기반으로
              한 수학적 모델의 계산 결과이며,
              <span className="font-semibold text-slate-700 underline decoration-slate-300">
                {" "}
                어떠한 경우에도 특정 종목에 대한 투자 권유나 매수/매도 추천이
                아닙니다.
              </span>
            </p>
            <p>
              제공되는 모든 수치와 분석 결과는 과거 데이터를 기반으로 한 참고용
              지표일 뿐이며, 시장의 변동성이나 예측하지 못한 경제 상황에 따라
              실제 결과와 크게 다를 수 있습니다. 데이터는 외부 API(Yahoo Finance
              등)를 통해 제공받으며, 기술적 지연이나 오류로 인해 실시간 시세와
              차이가 발생할 수 있습니다.
            </p>
            <p>
              운영자는 제공되는 정보의 정확성, 완전성, 신뢰성을 보장하지 않으며,
              본 사이트의 정보를 바탕으로 행해진 모든 투자 결정 및 그로 인한
              손실이나 결과에 대해{" "}
              <span className="font-semibold text-slate-700">
                어떠한 법적 책임도 지지 않습니다.
              </span>
            </p>
            <p className="text-slate-600 font-medium">
              최종적인 투자 판단과 그에 따른 책임은 반드시 투자자 본인에게
              있음을 명심하시기 바랍니다.
            </p>
          </div>
          <p className="mt-8 pt-4 border-t border-slate-100 italic">
            © 2026 QQQ Analyzer. Data powered by Yahoo Finance & Black-Scholes
            Greeks Engine.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default App;
