import React from "react";
import {
  Search,
  RefreshCw,
  AlertTriangle,
  Zap,
  TrendingUp,
} from "lucide-react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Line,
} from "recharts";
import type {
  AnalysisResult,
  TickerAnalysis,
  TickerOptionChain,
} from "../services/optionService";

interface TickerSearchSectionProps {
  tickerInput: string;
  setTickerInput: (value: string) => void;
  betaPeriod: number;
  setBetaPeriod: (value: number) => void;
  handleTickerSearch: (e: React.FormEvent) => void;
  tickerLoading: boolean;
  tickerError: string | null;
  tickerAnalysis: TickerAnalysis | null;
  activeSymbol: string;
  data: AnalysisResult | null;
  
  // Ticker Options State
  expirationType: "weekly" | "monthly";
  setExpirationType: (type: "weekly" | "monthly") => void;
  tickerExpirations: string[];
  tickerOptionsLoading: boolean;
  tickerOptionsError: string | null;
  selectedExpiration: string | null;
  setSelectedExpiration: (expiration: string | null) => void;
  tickerOptionChain: TickerOptionChain | null;
}

const TickerSearchSection: React.FC<TickerSearchSectionProps> = ({
  tickerInput,
  setTickerInput,
  betaPeriod,
  setBetaPeriod,
  handleTickerSearch,
  tickerLoading,
  tickerError,
  tickerAnalysis,
  activeSymbol,
  data,
  expirationType,
  setExpirationType,
  tickerExpirations,
  tickerOptionsLoading,
  tickerOptionsError,
  selectedExpiration,
  setSelectedExpiration,
  tickerOptionChain,
}) => {
  const selectedTickerRange =
    tickerAnalysis?.timeSeries?.find(
      (item) => selectedExpiration && item.isoDate === selectedExpiration
    ) || null; // Note: original used toYmd(item.isoDate) === selectedExpiration. 
               // Assuming item.isoDate is already YYYY-MM-DD or handled correctly.
               // Let's check App.tsx for toYmd usage.

  const selectedTickerTarget =
    selectedTickerRange &&
    (selectedTickerRange.expectedPrice ??
      (selectedTickerRange.expectedSupport +
        selectedTickerRange.expectedResistance) /
        2);

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

  const { callVolumeWall, putVolumeWall } = getVolumeWalls(tickerOptionChain);

  return (
    <section className="mt-12 p-6 md:p-8 border border-slate-200 rounded-3xl bg-slate-50/50 shadow-sm">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">
          개별 티커 베타 분석
        </h2>
        <p className="text-sm text-slate-500">
          {activeSymbol} GEX 데이터와 개별 주식의 베타($\beta$)를 결합하여 예상
          지지/저항선을 계산합니다.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-6 justify-center">
        <button
          onClick={() => {
            setTickerInput("QLD");
            setBetaPeriod(3);
          }}
          className="px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-xs font-bold border border-blue-100 hover:bg-blue-100 transition-colors"
        >
          QLD (2x QQQ) 분석
        </button>
        <button
          onClick={() => {
            setTickerInput("TQQQ");
            setBetaPeriod(3);
          }}
          className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-xs font-bold border border-indigo-100 hover:bg-indigo-100 transition-colors"
        >
          TQQQ (3x QQQ) 분석
        </button>
        <button
          onClick={() => {
            setTickerInput("SQQQ");
            setBetaPeriod(3);
          }}
          className="px-4 py-2 bg-red-50 text-red-600 rounded-xl text-xs font-bold border border-red-100 hover:bg-red-100 transition-colors"
        >
          SQQQ (-3x QQQ) 분석
        </button>
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
            className="w-full pl-12 pr-4 py-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={betaPeriod}
            onChange={(e) => setBetaPeriod(Number(e.target.value))}
            className="px-4 py-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold text-slate-700 dark:text-slate-200 text-sm appearance-none cursor-pointer"
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
            className="px-6 py-3.5 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center gap-2 whitespace-nowrap"
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
        <span className="font-bold text-slate-500 mr-1">※ 주의:</span> 본 분석은
        베타계수를 활용한 통계적 추정치이며 실제 주가 흐름과 다를 수 있습니다. 특히
        중소형주나 나스닥 100 지수에 포함되지 않은 종목은 지수와의 상관관계가 낮아
        분석 결과의 부정확도가 높을 수 있으니 단순 참고용으로만 활용하시기
        바랍니다.
      </p>

      {tickerError && (
        <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-medium flex items-center gap-2 mb-6 border border-red-100">
          <AlertTriangle className="w-4 h-4" />
          {tickerError}
        </div>
      )}

      {tickerAnalysis && (
        <section className="mt-10 p-4 md:p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
            <div>
              <h2 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-slate-50">
                개별 티커 분석
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-semibold uppercase tracking-wider">
                Beta-Adjusted Multi-Expiration Overview
              </p>
            </div>
            <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
              {tickerAnalysis.symbol}
            </span>
          </div>

          <div className="bg-white dark:bg-slate-900 p-4 md:p-6 rounded-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
              <div>
                <h3 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-slate-50 tracking-tight">
                  {tickerAnalysis.symbol}
                </h3>
                <p className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">
                  Beta-Adjusted Analysis
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-mono font-black text-slate-900 dark:text-slate-50">
                  ${tickerAnalysis.currentPrice?.toFixed(2)}
                </div>
                <div
                  className={`text-sm font-bold ${
                    tickerAnalysis.changePercent >= 0
                      ? "text-emerald-500"
                      : "text-red-500"
                  }`}
                >
                  {tickerAnalysis.changePercent >= 0 ? "+" : ""}
                  {tickerAnalysis.changePercent?.toFixed(2)}%
                </div>
              </div>
            </div>

            {tickerAnalysis.expectedPrice && (
              <div className="mb-6 p-4 md:p-6 bg-blue-600 rounded-2xl text-white">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-bold text-blue-100 uppercase tracking-widest mb-1">
                      오늘의 예상 종가 (Target)
                    </div>
                    <div className="text-3xl md:text-4xl font-mono font-black">
                      ${tickerAnalysis.expectedPrice.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold text-blue-100">
                      현재가 대비
                    </div>
                    <div className="text-xl font-black">
                      {(
                        (tickerAnalysis.expectedPrice /
                          tickerAnalysis.currentPrice -
                          1) *
                        100
                      ).toFixed(2)}
                      %
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* 하방 지지선 그룹 */}
              <div className="space-y-4">
                <div className="p-4 bg-slate-100/50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
                    최저 위험선 (Extreme Risk)
                  </div>
                  <div className="text-2xl font-mono font-black text-slate-700 dark:text-slate-100">
                    ${tickerAnalysis.expectedMin?.toFixed(2)}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 font-medium">
                    {activeSymbol}가 ${data?.recommendations?.[0]?.max?.toFixed(2)}
                    까지 폭락할 때
                  </p>
                </div>

                <div className="p-4 bg-blue-50/70 dark:bg-blue-950/40 rounded-2xl border border-blue-100 dark:border-blue-900/60">
                  <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-2">
                    예상 지지선 (Support)
                  </div>
                  <div className="text-2xl font-mono font-black text-blue-900 dark:text-blue-100">
                    ${tickerAnalysis.expectedSupport?.toFixed(2)}
                  </div>
                  <p className="text-[11px] text-blue-600/70 dark:text-blue-200 mt-2 font-medium">
                    {activeSymbol}가 ${data?.putSupport?.toFixed(2)}까지 밀릴 때
                  </p>
                </div>
              </div>

              {/* 상방 저항선 그룹 */}
              <div className="space-y-4">
                <div className="p-4 bg-red-50/70 dark:bg-red-950/40 rounded-2xl border border-red-100 dark:border-red-900/60">
                  <div className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-2">
                    예상 저항선 (Resistance)
                  </div>
                  <div className="text-2xl font-mono font-black text-red-900 dark:text-red-100">
                    ${tickerAnalysis.expectedResistance?.toFixed(2)}
                  </div>
                  <p className="text-[11px] text-red-600/70 dark:text-red-200 mt-2 font-medium">
                    {activeSymbol}가 ${data?.callResistance?.toFixed(2)}까지 오를 때
                  </p>
                </div>

                <div className="p-4 bg-orange-50/70 dark:bg-orange-950/40 rounded-2xl border border-orange-100 dark:border-orange-900/60">
                  <div className="text-[10px] font-bold text-orange-500 uppercase tracking-widest mb-2">
                    최대 목표선 (Strong Sell)
                  </div>
                  <div className="text-2xl font-mono font-black text-orange-900 dark:text-orange-100">
                    ${tickerAnalysis.expectedMax?.toFixed(2)}
                  </div>
                  <p className="text-[11px] text-orange-600/70 dark:text-orange-200 mt-2 font-medium">
                    QQQ가 ${data?.recommendations?.[5]?.max?.toFixed(2)}까지 과열될
                    때
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border border-slate-100 dark:border-slate-800">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-tight">
                적용 베타 ($\beta$)
              </span>
              <div className="flex flex-col items-end">
                <span className="font-mono font-bold text-slate-700 dark:text-slate-100 bg-white dark:bg-slate-950 px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700">
                  {tickerAnalysis.beta?.toFixed(2)}
                </span>
                <span className="text-[9px] text-slate-400 dark:text-slate-500 mt-1 font-medium">
                  *최근{" "}
                  {betaPeriod >= 12
                    ? `${betaPeriod / 12}년`
                    : `${betaPeriod}개월`}{" "}
                  일일 수익률 기반 정밀 계산
                </span>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-indigo-500" />
                    {tickerAnalysis.symbol} 옵션 만기별 분석
                  </h4>
                  <div className="flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-0.5">
                    <button
                      type="button"
                      onClick={() => setExpirationType("weekly")}
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-black transition-colors ${
                        expirationType === "weekly"
                          ? "bg-indigo-500 text-white"
                          : "text-slate-500 hover:text-indigo-600"
                      }`}
                    >
                      Weekly
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpirationType("monthly")}
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-black transition-colors ${
                        expirationType === "monthly"
                          ? "bg-indigo-500 text-white"
                          : "text-slate-500 hover:text-indigo-600"
                      }`}
                    >
                      Monthly
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400">
                  <a
                    href={`https://optioncharts.io/options/${tickerAnalysis.symbol}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-500 hover:text-indigo-600"
                  >
                    OptionCharts 보기
                  </a>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mb-4">
                {tickerExpirations.length === 0 && !tickerOptionsLoading && (
                  <span className="text-xs text-slate-400">
                    만기일 정보를 불러오지 못했습니다.
                  </span>
                )}
                {tickerExpirations.map((exp) => (
                  <button
                    key={exp}
                    onClick={() => setSelectedExpiration(exp)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-black border transition-colors ${
                      selectedExpiration === exp
                        ? "bg-indigo-500 text-white border-indigo-500"
                        : "bg-white text-slate-500 border-slate-200 hover:border-indigo-200 hover:text-indigo-600"
                    }`}
                  >
                    {exp}
                  </button>
                ))}
              </div>

              {tickerOptionsLoading && (
                <div className="text-xs text-slate-400">
                  옵션 데이터를 불러오는 중...
                </div>
              )}
              {tickerOptionsError && (
                <div className="text-xs text-red-500">{tickerOptionsError}</div>
              )}

              {tickerOptionChain && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-4">
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        만기일
                      </div>
                      <div className="text-lg font-black text-slate-800">
                        {tickerOptionChain.expirationDate}
                      </div>
                    </div>
                    <div className="text-right text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      <a
                        href={tickerOptionChain.links.expiration}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-500 hover:text-indigo-600"
                      >
                        OptionCharts 만기별 보기
                      </a>
                    </div>
                  </div>

                  {selectedTickerRange && selectedTickerTarget && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="p-4 rounded-2xl border border-indigo-100 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/50">
                        <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-1">
                          예상 종가 (Target)
                        </div>
                        <div className="text-xl font-black text-indigo-700">
                          ${selectedTickerTarget.toFixed(2)}
                        </div>
                        <div className="text-[10px] text-indigo-400 mt-1">
                          {selectedExpiration} 기준
                        </div>
                      </div>
                      <div className="p-4 rounded-2xl border border-emerald-100 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/40">
                        <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1">
                          예상 지지선
                        </div>
                        <div className="text-xl font-black text-emerald-700">
                          ${selectedTickerRange.expectedSupport.toFixed(2)}
                        </div>
                        <div className="text-[10px] text-emerald-400 mt-1">
                          강한 하단 범위
                        </div>
                      </div>
                      <div className="p-4 rounded-2xl border border-rose-100 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/40">
                        <div className="text-[10px] font-bold text-rose-600 uppercase tracking-widest mb-1">
                          예상 저항선
                        </div>
                        <div className="text-xl font-black text-rose-700">
                          ${selectedTickerRange.expectedResistance.toFixed(2)}
                        </div>
                        <div className="text-[10px] text-rose-400 mt-1">
                          강한 상단 범위
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="p-4 rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                        Put/Call Ratio
                      </div>
                      <div className="text-xl font-black text-slate-700">
                        {tickerOptionChain.summary.pcr.toFixed(2)}
                      </div>
                    </div>
                    <div className="p-4 rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                        Call Wall
                      </div>
                      <div className="text-xl font-black text-emerald-600">
                        {tickerOptionChain.summary.callWall
                          ? `$${tickerOptionChain.summary.callWall.toFixed(2)}`
                          : "-"}
                      </div>
                    </div>
                    <div className="p-4 rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                        Put Wall
                      </div>
                      <div className="text-xl font-black text-red-500">
                        {tickerOptionChain.summary.putWall
                          ? `$${tickerOptionChain.summary.putWall.toFixed(2)}`
                          : "-"}
                      </div>
                    </div>
                    <div className="p-4 rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                        Avg IV (ATM)
                      </div>
                      <div className="text-xl font-black text-slate-700">
                        {tickerOptionChain.summary.avgIv
                          ? `${(tickerOptionChain.summary.avgIv * 100).toFixed(
                              1
                            )}%`
                          : "-"}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden">
                      <div className="px-4 py-3 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-200 text-xs font-bold uppercase tracking-widest">
                        Calls (Top OI)
                      </div>
                      <div className="max-h-[320px] overflow-y-auto">
                        <table className="w-full text-[11px]">
                          <thead className="text-slate-400 dark:text-slate-500 uppercase tracking-wider text-[10px]">
                            <tr>
                              <th className="px-4 py-2 text-left">Strike</th>
                              <th className="px-4 py-2 text-right">Last</th>
                              <th className="px-4 py-2 text-right">OI</th>
                              <th className="px-4 py-2 text-right">IV</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tickerOptionChain.calls
                              .slice()
                              .sort((a, b) => b.openInterest - a.openInterest)
                              .slice(0, 12)
                              .map((opt, idx) => (
                                <tr
                                  key={`${opt.strike}-${idx}`}
                                  className="border-t border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-200"
                                >
                                  <td className="px-4 py-2 font-mono">
                                    ${opt.strike.toFixed(2)}
                                  </td>
                                  <td className="px-4 py-2 text-right font-mono">
                                    ${opt.lastPrice.toFixed(2)}
                                  </td>
                                  <td className="px-4 py-2 text-right font-mono">
                                    {opt.openInterest.toLocaleString()}
                                  </td>
                                  <td className="px-4 py-2 text-right font-mono">
                                    {(opt.impliedVolatility * 100).toFixed(1)}%
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden">
                      <div className="px-4 py-3 bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-200 text-xs font-bold uppercase tracking-widest">
                        Puts (Top OI)
                      </div>
                      <div className="max-h-[320px] overflow-y-auto">
                        <table className="w-full text-[11px]">
                          <thead className="text-slate-400 dark:text-slate-500 uppercase tracking-wider text-[10px]">
                            <tr>
                              <th className="px-4 py-2 text-left">Strike</th>
                              <th className="px-4 py-2 text-right">Last</th>
                              <th className="px-4 py-2 text-right">OI</th>
                              <th className="px-4 py-2 text-right">IV</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tickerOptionChain.puts
                              .slice()
                              .sort((a, b) => b.openInterest - a.openInterest)
                              .slice(0, 12)
                              .map((opt, idx) => (
                                <tr
                                  key={`${opt.strike}-${idx}`}
                                  className="border-t border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-200"
                                >
                                  <td className="px-4 py-2 font-mono">
                                    ${opt.strike.toFixed(2)}
                                  </td>
                                  <td className="px-4 py-2 text-right font-mono">
                                    ${opt.lastPrice.toFixed(2)}
                                  </td>
                                  <td className="px-4 py-2 text-right font-mono">
                                    {opt.openInterest.toLocaleString()}
                                  </td>
                                  <td className="px-4 py-2 text-right font-mono">
                                    {(opt.impliedVolatility * 100).toFixed(1)}%
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {tickerAnalysis.swingScenarios &&
              tickerAnalysis.swingScenarios.length > 0 && (
                <div className="mt-8 pt-6 border-t border-slate-100">
                  <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <TrendingUp className="w-3.5 h-3.5" /> {tickerAnalysis.symbol}{" "}
                    베타 보정 스윙 시나리오
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {tickerAnalysis.swingScenarios.map((scenario, idx) => (
                      <div
                        key={idx}
                        className="p-4 bg-slate-50 rounded-2xl border border-slate-100"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                            {scenario.entryDate} → {scenario.exitDate}
                          </span>
                          <div className="text-right">
                            <span className="block text-sm font-black text-emerald-600">
                              +{scenario.profit?.toFixed(2)}%
                            </span>
                          </div>
                        </div>
                        <div className="text-[11px] text-slate-600 font-medium mb-3">
                          {scenario.description}
                        </div>
                        <div className="space-y-1.5 text-[10px] font-mono">
                          <div className="flex justify-between items-center text-slate-500">
                            <span>진입가</span>
                            <span className="font-bold text-slate-700">
                              ${scenario.entryPrice?.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-blue-500">
                            <span>기본 목표</span>
                            <span className="font-bold text-blue-700">
                              ${scenario.exitPrice?.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-red-500">
                            <span>확장 목표</span>
                            <span className="font-bold text-red-700">
                              ${scenario.extensionPrice?.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}


            <div className="mt-8 pt-6 border-t border-slate-100">
              <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-yellow-500" />{" "}
                {tickerAnalysis.symbol} 1일 스캘핑 시나리오
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {tickerAnalysis.timeSeries?.slice(0, 5).map((item, idx) => {
                  const buyPrice = putVolumeWall ?? item.expectedSupport;
                  const sellPrice = callVolumeWall ?? item.expectedResistance;

                  const targetPrice = sellPrice * 0.997;
                  const profit =
                    buyPrice > 0
                      ? ((targetPrice - buyPrice) / buyPrice) * 100
                      : 0;

                  const baseProb = 50;
                  const sentimentBonus =
                    item.sentiment > 0
                      ? Math.min(item.sentiment * 0.3, 15)
                      : Math.max(item.sentiment * 0.3, -15);
                  const priceProbBonus =
                    (item.priceProbability.up - item.priceProbability.down) *
                    0.3;

                  const prevItem =
                    idx > 0 ? tickerAnalysis.timeSeries?.[idx - 1] : null;
                  const gexTrend = prevItem
                    ? item.totalGex > prevItem.totalGex
                      ? 3
                      : -3
                    : 0;

                  let scalpingProb =
                    baseProb + sentimentBonus + priceProbBonus + gexTrend;
                  scalpingProb = Math.round(
                    Math.max(30, Math.min(75, scalpingProb))
                  );

                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 bg-slate-50/50 rounded-xl border border-red-200 group hover:border-red-300 transition-colors"
                    >
                      <div>
                        <div className="text-[9px] font-bold text-slate-400 mb-1">
                          {item.date} 단기 타점
                        </div>
                        <div className="text-[10px] font-mono flex items-center gap-1.5 mb-2">
                          <span className="text-blue-600 font-bold">
                            Buy ${buyPrice.toFixed(2)}
                          </span>
                          <span className="text-slate-300">→</span>
                          <span className="text-red-600 font-bold">
                            Sell ${sellPrice.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex gap-1 h-1 w-full max-w-[80px] rounded-full overflow-hidden bg-slate-100">
                          <div
                            className="bg-emerald-500"
                            style={{
                              width: `${item.priceProbability.up}%`,
                            }}
                          />
                          <div
                            className="bg-slate-400"
                            style={{
                              width: `${item.priceProbability.neutral}%`,
                            }}
                          />
                          <div
                            className="bg-red-500"
                            style={{
                              width: `${item.priceProbability.down}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] font-black text-emerald-600">
                          {profit <= 0 ? "Range-bound" : `+${profit.toFixed(2)}%`}
                        </div>
                        <div className="text-[9px] font-bold text-slate-500 mt-1">
                          확률: {scalpingProb}%
                        </div>
                        {item.expectedPrice && (
                          <div className="text-[10px] font-mono font-black text-indigo-500 mt-1">
                            Target ${item.expectedPrice.toFixed(2)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
                * 옵션 거래량이 가장 큰 구간(Volume Wall)을 우선 사용하며, 없을 경우
                예상 지지/저항 기준 단일 가격 타점으로 표시됩니다.
              </p>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100">
              <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5" /> {tickerAnalysis.symbol}{" "}
                만기별 예상 지지/저항
              </h4>
              {tickerAnalysis.timeSeries &&
              tickerAnalysis.timeSeries.length > 0 ? (
                <>
                  <div className="h-[300px] w-full mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={tickerAnalysis.timeSeries}
                        margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                          stroke="#f1f5f9"
                        />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10, fontWeight: 600 }}
                          stroke="#64748b"
                        />
                        <YAxis
                          domain={["auto", "auto"]}
                          tick={{ fontSize: 10, fontWeight: 600 }}
                          stroke="#64748b"
                          label={{
                            value: "Price ($)",
                            angle: -90,
                            position: "insideLeft",
                            fontSize: 10,
                            fontWeight: 700,
                          }}
                        />
                        <Tooltip
                          contentStyle={{
                            borderRadius: "12px",
                            border: "none",
                            boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                            fontSize: "11px",
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="expectedPrice"
                          stroke="#6366f1"
                          strokeWidth={2}
                          dot={{ r: 4, fill: "#6366f1" }}
                          name="예상 종가 (Target)"
                        />
                        <Line
                          type="stepAfter"
                          dataKey="expectedResistance"
                          stroke="#ef4444"
                          strokeDasharray="5 5"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "#ef4444" }}
                          name="예상 저항선"
                        />
                        <Line
                          type="stepAfter"
                          dataKey="expectedSupport"
                          stroke="#3b82f6"
                          strokeDasharray="5 5"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "#3b82f6" }}
                          name="예상 지지선"
                        />
                        <Line
                          type="monotone"
                          dataKey="expectedUpper"
                          stroke="#10b981"
                          strokeWidth={1}
                          strokeDasharray="2 2"
                          dot={false}
                          name="0.25-SD 상단"
                        />
                        <Line
                          type="monotone"
                          dataKey="expectedLower"
                          stroke="#10b981"
                          strokeWidth={1}
                          strokeDasharray="2 2"
                          dot={false}
                          name="0.25-SD 하단"
                        />
                        <Line
                          type="monotone"
                          dataKey={() => tickerAnalysis.currentPrice}
                          stroke="#1e293b"
                          strokeWidth={1}
                          dot={false}
                          strokeOpacity={0.3}
                          name="현재가"
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

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
                          Target = Current * (1 + Beta * (QQQ_Target /
                          QQQ_Current - 1))
                        </code>
                        <p className="text-[9px] text-slate-400 mt-2 leading-relaxed">
                          * 예상 종가는 옵션 에너지(GEX)와 표준편차(0.4-SD) 기대
                          범위를 가중 평균하여 산출한 수치로, 통계적으로 가장
                          확률이 높은 회귀 지점을 의미합니다.
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-bold text-slate-600 mb-1">
                          3. 초보수적 기대 범위 (0.25-SD) 산출
                        </p>
                        <code className="text-[10px] block bg-white p-2 rounded-lg border border-slate-200 text-slate-500 leading-relaxed font-mono">
                          Expected Range = Price * IV * sqrt(T) * 0.25
                        </code>
                        <p className="text-[9px] text-slate-400 mt-2 leading-relaxed">
                          * 도달 확률을 약 80% 수준으로 극대화하기 위해 표준편차
                          범위를 매우 타이트하게(0.25배) 설정한 핵심 매매
                          구간입니다.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-400 text-center py-8">
                  차트 데이터를 불러올 수 없습니다.
                </p>
              )}
            </div>
          </div>
        </section>
      )}
    </section>
  );
};

export default TickerSearchSection;
