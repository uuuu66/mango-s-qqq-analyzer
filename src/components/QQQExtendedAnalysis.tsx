import React from "react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  ReferenceLine,
} from "recharts";
import { TrendingUp, Info, Zap } from "lucide-react";
import type { AnalysisResult, TickerOptionChain } from "../services/optionService";

interface QQQExtendedAnalysisProps {
  data: AnalysisResult | null;
  optionChain: TickerOptionChain | null;
}

const QQQExtendedAnalysis: React.FC<QQQExtendedAnalysisProps> = ({
  data,
  optionChain,
}) => {
  if (!data) return null;

  const getVolumeWalls = (chain: TickerOptionChain | null) => {
    if (!chain) {
      return { callVolumeWall: null, putVolumeWall: null };
    }
    const callVolumeWall =
      chain.calls.length > 0
        ? chain.calls.reduce((best, current) =>
            current.volume > best.volume ? current : best
          ).strike
        : null;
    const putVolumeWall =
      chain.puts.length > 0
        ? chain.puts.reduce((best, current) =>
            current.volume > best.volume ? current : best
          ).strike
        : null;
    return { callVolumeWall, putVolumeWall };
  };

  const { callVolumeWall, putVolumeWall } = getVolumeWalls(optionChain);
  const currentPrice = data.currentPrice ?? null;
  const maxPain = optionChain?.summary?.maxPain ?? null;
  const getNearSpotWall = (
    rows: TickerOptionChain["calls"] | TickerOptionChain["puts"],
    side: "call" | "put"
  ) => {
    if (!currentPrice || !rows || rows.length === 0) return null;
    const filtered =
      side === "call"
        ? rows.filter((row) => row.strike >= currentPrice)
        : rows.filter((row) => row.strike <= currentPrice);
    if (filtered.length === 0) return null;
    const bestByVolume = filtered.reduce((best, current) =>
      current.volume > best.volume ? current : best
    );
    if (bestByVolume.volume > 0) {
      return { strike: bestByVolume.strike, label: "Volume Wall" as const };
    }
    const bestByOi = filtered.reduce((best, current) =>
      current.openInterest > best.openInterest ? current : best
    );
    return {
      strike: bestByOi.strike,
      label: "OI Wall" as const,
    };
  };
  const putNearSpot = optionChain
    ? getNearSpotWall(optionChain.puts, "put")
    : null;
  const callNearSpot = optionChain
    ? getNearSpotWall(optionChain.calls, "call")
    : null;
  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weeklyWindow = (data.timeSeries ?? []).filter((item) => {
    const itemDate = new Date(item.isoDate || item.date);
    if (Number.isNaN(itemDate.getTime())) return false;
    return itemDate >= now && itemDate <= weekEnd;
  });
  const getPercentile = (values: number[], p: number) => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor((sorted.length - 1) * p))
    );
    return sorted[idx];
  };
  const weeklySupport =
    weeklyWindow.length > 0
      ? getPercentile(
          weeklyWindow
            .map((item) => item.putSupport)
            .filter((value): value is number => typeof value === "number"),
          0.2
        )
      : null;
  const weeklyResistance =
    weeklyWindow.length > 0
      ? getPercentile(
          weeklyWindow
            .map((item) => item.callResistance)
            .filter((value): value is number => typeof value === "number"),
          0.8
        )
      : null;
  const weeklyBuy = putNearSpot?.strike ?? weeklySupport ?? maxPain ?? null;
  const weeklySell = callNearSpot?.strike ?? weeklyResistance ?? maxPain ?? null;
  const weeklyBuyLabel =
    putNearSpot?.label ?? (weeklySupport ? "7D Support (P20)" : "Max Pain");
  const weeklySellLabel =
    callNearSpot?.label ??
    (weeklyResistance ? "7D Resistance (P80)" : "Max Pain");

  return (
    <div className="space-y-8">
      {/* QQQ Option Buy/Sell Guide */}
      <section className="p-4 md:p-6 border rounded-2xl shadow-sm bg-white">
        <div className="mb-4 border-b pb-3">
          <h2 className="text-lg font-bold text-slate-800">
            QQQ 옵션 기반 매수/매도 기준
          </h2>
          <p className="text-[11px] text-slate-500 mt-1">
            7일 내 만기 중 현재가 근처 Wall을 우선하고, 없으면 7일 지지/저항 분위수(P20/P80) 또는 Max Pain을 사용합니다.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50">
            <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest">
              매수 기준 ({weeklyBuyLabel})
            </div>
            <div className="text-2xl font-black text-emerald-700 mt-1">
              {weeklyBuy !== null ? `$${weeklyBuy.toFixed(2)}` : "-"}
            </div>
            <p className="text-[10px] text-emerald-700/70 mt-2">
              현재가 근처 풋 Wall 우선, 없으면 7일 지지선 분위수 기준입니다.
            </p>
          </div>
          <div className="p-4 rounded-2xl border border-rose-200 bg-rose-50">
            <div className="text-[10px] font-bold text-rose-700 uppercase tracking-widest">
              매도 기준 ({weeklySellLabel})
            </div>
            <div className="text-2xl font-black text-rose-700 mt-1">
              {weeklySell !== null ? `$${weeklySell.toFixed(2)}` : "-"}
            </div>
            <p className="text-[10px] text-rose-700/70 mt-2">
              현재가 근처 콜 Wall 우선, 없으면 7일 저항선 분위수 기준입니다.
            </p>
          </div>
        </div>
        {maxPain !== null && (
          <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
            참고: Max Pain ${maxPain.toFixed(2)}
          </p>
        )}
      </section>
      {/* GEX Imbalance Section */}
      <section className="p-4 md:p-6 border rounded-2xl shadow-sm bg-white overflow-hidden">
        <div className="mb-6 border-b pb-4">
          <h2 className="text-xl font-bold text-slate-800">
            만기별 콜/풋 에너지 균형 (GEX Imbalance)
          </h2>
          <div className="mt-2 flex flex-wrap gap-4">
            <p className="flex items-center gap-2 text-xs text-emerald-600 font-bold">
              <span className="w-3 h-3 bg-emerald-500 rounded-sm"></span>콜 에너지
              (상승 압력 / 지지력)
            </p>
            <p className="flex items-center gap-2 text-xs text-rose-600 font-bold">
              <span className="w-3 h-3 bg-rose-500 rounded-sm"></span>풋 에너지
              (하락 압력 / 변동성)
            </p>
            <p className="flex items-center gap-2 text-xs text-purple-600 font-bold">
              <span className="w-3 h-3 bg-purple-500 rounded-sm"></span>VIX 지수
              (변동성 지표)
            </p>
          </div>
        </div>

        <div className="overflow-x-auto pb-4 custom-scrollbar">
          <div className="h-[300px] min-w-[900px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data.timeSeries}
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
                  tick={{ fontSize: 11, fontWeight: 600 }}
                  stroke="#64748b"
                  label={{
                    value: "GEX ($ Billion)",
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
                  stroke="#8b5cf6"
                  label={{
                    value: "VIX",
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
                  formatter={(
                    value: number | undefined,
                    name: string | undefined
                  ) => {
                    if (name === "VIX") {
                      return [
                        value !== undefined && value !== null
                          ? `${Number(value)?.toFixed(2)}`
                          : "N/A",
                        "VIX",
                      ];
                    }
                    return [
                      value !== undefined
                        ? `$${Number(value)?.toFixed(2)}B`
                        : "0.00B",
                      name,
                    ];
                  }}
                />
                <ReferenceLine y={0} stroke="#e2e8f0" />
                <Bar
                  yAxisId="left"
                  dataKey={(item) => item.callGex / 1e9}
                  fill="#10b981"
                  name="콜 에너지"
                  radius={[4, 4, 0, 0]}
                  barSize={30}
                />
                <Bar
                  yAxisId="left"
                  dataKey={(item) => item.putGex / 1e9}
                  fill="#f43f5e"
                  name="풋 에너지"
                  radius={[0, 0, 4, 4]}
                  barSize={30}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="vix"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  dot={{ fill: "#8b5cf6", r: 3 }}
                  name="VIX"
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <p className="mt-4 text-[10px] text-slate-400 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100">
          * **콜 에너지(녹색):** 마켓 메이커가 콜 옵션을 매도하며 발생하는
          방어력입니다. 양수가 클수록 주가 상승 시 지지력이 강해집니다.
          <br />* **풋 에너지(적색):** 마켓 메이커가 풋 옵션을 매수/매도하며
          발생하는 압력입니다. 음수가 클수록 주가 하락 시 변동성이 커질 수
          있습니다.
          <br />* **VIX 지수(보라색):** 시장의 변동성 지표입니다. VIX가 높을수록
          시장 불안이 크며, 초반 30분 트랩 판단 시 참고할 수 있습니다.
        </p>
      </section>

      {/* Swing Strategy */}
      <div className="grid grid-cols-1 gap-6 mt-12">
        <div className="bg-black p-6 rounded-2xl border border-slate-700">
          <h3 className="text-lg font-bold text-emerald-400 mb-6 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-500" />
            복합 일자별 스윙 시나리오 (Swing Strategy)
          </h3>
          <div className="space-y-4">
            {data.swingScenarios?.map((scenario, idx) => (
              <div
                key={idx}
                className="p-4 bg-black rounded-xl border border-slate-700"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold text-emerald-300 uppercase tracking-widest">
                    {scenario.entryDate} → {scenario.exitDate}
                  </span>
                  <div className="text-right">
                    <span className="block text-sm font-black text-emerald-400">
                      +{scenario.profit?.toFixed(2)}%
                    </span>
                    <span className="text-[10px] font-bold text-emerald-300">
                      확률: {scenario.probability}%
                    </span>
                  </div>
                </div>
                <div className="text-xs text-emerald-300 font-medium">
                  {scenario.description}
                </div>
                <div className="mt-2 flex flex-col gap-1 text-[11px] font-mono text-emerald-300">
                  <div className="flex items-center gap-2">
                    <span className="w-12 text-emerald-200 font-bold">
                      진입
                    </span>
                    <span>Buy @ ${scenario.entryPrice?.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-12 text-emerald-200 font-bold">
                      기본
                    </span>
                    <span>Sell @ ${scenario.exitPrice?.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-12 text-emerald-200 font-bold">
                      확장
                    </span>
                    <span>
                      Sell @ ${scenario.extensionPrice?.toFixed(2)}
                      (조건부)
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {(!data.swingScenarios || data.swingScenarios.length === 0) && (
              <p className="text-sm text-slate-400 text-center py-4">
                충분한 데이터가 확보되지 않았습니다.
              </p>
            )}

            <div className="mt-6 pt-6 border-t border-slate-700">
              <h4 className="text-[10px] font-bold text-emerald-300 uppercase tracking-widest mb-3 flex items-center gap-2">
                <Info className="w-3 h-3" /> 시나리오 확률 산출 로직
              </h4>
              <div className="bg-black p-3 rounded-xl border border-slate-700">
                <code className="text-[9px] block text-emerald-300 leading-relaxed font-mono">
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

      </div>

      <div className="grid grid-cols-1 gap-6 mt-12">
        <div className="bg-black p-6 rounded-2xl border border-slate-700">
          <h3 className="text-lg font-bold text-emerald-400 mb-6 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            만기별 옵션 분포 기반 가격 변동 확률 (Option Distribution
            Probabilities)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.timeSeries?.slice(0, 6).map((item, idx) => (
              <div
                key={idx}
                className="p-5 rounded-2xl border border-slate-700 bg-black"
              >
                <div className="text-[10px] font-bold text-emerald-300 uppercase tracking-widest mb-3 pb-2 border-b border-slate-700">
                  {item.date} 만기 분포 분석
                </div>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-[11px] font-bold mb-1.5">
                      <span className="text-emerald-300">상승 확률</span>
                      <span className="text-emerald-400">
                        {item.priceProbability?.up ?? 0}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-400 transition-all duration-1000"
                        style={{
                          width: `${item.priceProbability?.up ?? 0}%`,
                        }}
                      ></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] font-bold mb-1.5">
                      <span className="text-emerald-300">하락 확률</span>
                      <span className="text-emerald-400">
                        {item.priceProbability?.down ?? 0}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-400 transition-all duration-1000"
                        style={{
                          width: `${item.priceProbability?.down ?? 0}%`,
                        }}
                      ></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] font-bold mb-1.5">
                      <span className="text-emerald-300">횡보 확률</span>
                      <span className="text-emerald-400">
                        {item.priceProbability?.neutral ?? 0}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-400 transition-all duration-1000"
                        style={{
                          width: `${item.priceProbability?.neutral ?? 0}%`,
                        }}
                      ></div>
                    </div>
                  </div>
                </div>
                <p className="mt-4 text-[9px] text-emerald-300 leading-relaxed">
                  * 해당 만기일의 콜/풋 GEX 에너지 분포 및 외가격(OTM) 옵션
                  비중을 분석한 통계적 기대 확률입니다.
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid  gap-6 mt-12">
        <div className="bg-black p-6 rounded-2xl border border-red-500/50">
          <h3 className="text-lg font-bold text-emerald-400 mb-6 flex items-center gap-2">
            <Zap className="w-5 h-5 text-emerald-400" />
            1일 스캘핑 시나리오 (Daily Scalping)
          </h3>
          <div className="space-y-4">
            {data.timeSeries?.slice(0, 5).map((item, idx) => {
              // 거래량이 가장 큰 옵션 구간 우선 사용 (없으면 Put/Call Wall)
              const buyPrice = putVolumeWall ?? item.putSupport;
              const sellPrice = callVolumeWall ?? item.callResistance;

              const targetPrice = sellPrice * 0.997; // 매도 타점(약간의 안전마진)
              const profit =
                buyPrice > 0
                  ? ((targetPrice - buyPrice) / buyPrice) * 100
                  : 0;

              return (
                <div
                  key={idx}
                  className="flex items-center justify-between p-4 bg-black rounded-xl border border-red-500/40 transition-colors"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-[10px] font-bold text-emerald-300 uppercase tracking-widest mb-1">
                        {item.date} 단기 타점
                      </div>
                      {item.vix && (
                        <div className="text-[10px] font-bold text-purple-400 uppercase tracking-widest mb-1 bg-purple-900/30 px-1.5 py-0.5 rounded border border-purple-500/30">
                          VIX {item.vix.toFixed(2)}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-bold text-emerald-400">
                        Buy ${buyPrice.toFixed(2)}
                      </span>
                      <span className="text-emerald-300">→</span>
                      <span className="font-bold text-emerald-400">
                        Sell ${sellPrice.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex gap-1 h-1 w-full max-w-[100px] rounded-full overflow-hidden bg-slate-800 mt-2">
                      <div
                        className="bg-emerald-400"
                        style={{ width: `${item.priceProbability?.up ?? 0}%` }}
                      />
                      <div
                        className="bg-emerald-400/70"
                        style={{
                          width: `${item.priceProbability?.neutral ?? 0}%`,
                        }}
                      />
                      <div
                        className="bg-emerald-400/40"
                        style={{
                          width: `${item.priceProbability?.down ?? 0}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-bold text-yellow-600 uppercase tracking-widest mb-1">
                      기대 수익률
                    </div>
                    <div className="text-lg font-black text-emerald-600">
                      {profit <= 0 ? "Box-range" : `+${profit.toFixed(2)}%`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-400 mt-4 leading-relaxed">
            * 5일간의 데이터를 바탕으로 도출된 1일 단위 단기 매매 시나리오입니다.
            옵션 거래량이 가장 큰 구간(Volume Wall)을 우선 사용하며, 없을 경우
            Put/Call Wall 기준 단일 가격 타점으로 표시됩니다.
          </p>
        </div>

      
      </div>
    </div>
  );
};

export default QQQExtendedAnalysis;
