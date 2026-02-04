import React, { useMemo } from "react";
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
} from "recharts";
import { Zap } from "lucide-react";
import type { AnalysisResult, TickerOptionChain } from "../services/optionService";
import { ASSET_TABS, API_SYMBOL_MAP } from "../constants";

interface AssetSectionProps {
  symbol: (typeof ASSET_TABS)[number];
  assetData: AnalysisResult | null;
  assetLoading: boolean;
  assetError: string | null;
  assetUpdated: string | null;
  expirations: string[];
  expirationType: "daily" | "weekly" | "monthly";
  selectedExpiration: string | null;
  optionChain: TickerOptionChain | null;
  optionsLoading: boolean;
  optionsError: string | null;
  sortBy: "oi" | "volume";

  setExpirationType: (
    symbol: (typeof ASSET_TABS)[number],
    type: "daily" | "weekly" | "monthly"
  ) => void;
  setSelectedExpiration: (
    symbol: (typeof ASSET_TABS)[number],
    expiration: string | null
  ) => void;
  setSortBy: (
    symbol: (typeof ASSET_TABS)[number],
    sortBy: "oi" | "volume"
  ) => void;
  rangeFilter?: "1m" | "3m" | "6m" | "1y";
  setRangeFilter?: (range: "1m" | "3m" | "6m" | "1y") => void;
  loadAssetOptionChain: (
    symbol: (typeof ASSET_TABS)[number],
    expiration: string,
    type: "daily" | "weekly" | "monthly"
  ) => void;
  onRef: (el: HTMLElement | null) => void;
}

const AssetSection: React.FC<AssetSectionProps> = ({
  symbol,
  assetData,
  assetLoading,
  assetError,
  assetUpdated,
  expirations,
  expirationType,
  selectedExpiration,
  optionChain,
  optionsLoading,
  optionsError,
  sortBy,
  setExpirationType,
  setSelectedExpiration,
  setSortBy,
  rangeFilter,
  setRangeFilter,
  loadAssetOptionChain,
  onRef,
}) => {
  const supportsRangeFilter = useMemo(
    () => ["GLD", "SLV", "BTC", "VXX"].includes(symbol),
    [symbol]
  );
  const activeRangeFilter = rangeFilter ?? "1m";
  const isFiltering = supportsRangeFilter && assetLoading;

  const filteredTimeSeries = useMemo(() => {
    if (!assetData?.timeSeries || !supportsRangeFilter) {
      return assetData?.timeSeries ?? [];
    }
    const now = new Date();
    const cutoff = new Date(now);
    if (activeRangeFilter === "1m") {
      cutoff.setMonth(cutoff.getMonth() - 1);
    } else if (activeRangeFilter === "3m") {
      cutoff.setMonth(cutoff.getMonth() - 3);
    } else if (activeRangeFilter === "6m") {
      cutoff.setMonth(cutoff.getMonth() - 6);
    } else {
      cutoff.setFullYear(cutoff.getFullYear() - 1);
    }
    return assetData.timeSeries.filter((item) => {
      const itemDate = new Date(item.isoDate || item.date);
      return !Number.isNaN(itemDate.getTime()) && itemDate >= cutoff;
    });
  }, [assetData?.timeSeries, activeRangeFilter, supportsRangeFilter]);
  const chartTimeSeries = useMemo(() => {
    if (!supportsRangeFilter) return filteredTimeSeries;
    if (activeRangeFilter === "1y") {
      const groups = new Map<
        string,
        (typeof filteredTimeSeries)[number][]
      >();
      filteredTimeSeries.forEach((item) => {
        const dateObj = new Date(item.isoDate || item.date);
        if (Number.isNaN(dateObj.getTime())) return;
        const key = `${dateObj.getFullYear()}-${String(
          dateObj.getMonth() + 1
        ).padStart(2, "0")}`;
        const bucket = groups.get(key);
        if (bucket) {
          bucket.push(item);
        } else {
          groups.set(key, [item]);
        }
      });
      const numericKeys = [
        "callResistance",
        "putSupport",
        "callWallOI",
        "putWallOI",
        "gammaFlip",
        "volTrigger",
        "callGex",
        "putGex",
        "totalGex",
        "pcrAll",
        "pcrFiltered",
        "sentiment",
        "profitPotential",
        "expectedPrice",
        "expectedUpper",
        "expectedLower",
      ] as const;
      return Array.from(groups.entries())
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, items]) => {
          const lastItem = items[items.length - 1];
          const aggregated = { ...lastItem, date: key } as typeof lastItem &
            Record<string, number>;
          numericKeys.forEach((field) => {
            let sum = 0;
            let count = 0;
            items.forEach((it) => {
              const value = (
                it as unknown as Record<string, number | null | undefined>
              )[field];
              if (typeof value === "number" && !Number.isNaN(value)) {
                sum += value;
                count += 1;
              }
            });
            if (count > 0) {
              (aggregated as Record<string, number>)[field] = sum / count;
            }
          });
          if (lastItem.priceProbability) {
            const probs = items
              .map((it) => it.priceProbability)
              .filter(
                (p): p is NonNullable<typeof lastItem.priceProbability> =>
                  Boolean(p)
              );
            if (probs.length) {
              const totals = probs.reduce(
                (acc, cur) => ({
                  up: acc.up + (cur.up || 0),
                  down: acc.down + (cur.down || 0),
                  neutral: acc.neutral + (cur.neutral || 0),
                }),
                { up: 0, down: 0, neutral: 0 }
              );
              aggregated.priceProbability = {
                up: Math.round(totals.up / probs.length),
                down: Math.round(totals.down / probs.length),
                neutral: Math.round(totals.neutral / probs.length),
              };
            }
          }
          return aggregated;
        });
    }
    const targetCount = 15;
    if (filteredTimeSeries.length <= targetCount) {
      return filteredTimeSeries;
    }
    const getSeriesValue = (item: (typeof filteredTimeSeries)[number]) => {
      if (typeof item.expectedPrice === "number") return item.expectedPrice;
      if (typeof item.gammaFlip === "number") return item.gammaFlip;
      if (typeof item.volTrigger === "number") return item.volTrigger;
      if (
        typeof item.callResistance === "number" &&
        typeof item.putSupport === "number"
      ) {
        return (item.callResistance + item.putSupport) / 2;
      }
      return 0;
    };
    type ChartPoint = { x: number; y: number; index: number };
    const points: ChartPoint[] = filteredTimeSeries.map((item, idx) => ({
      x: new Date(item.isoDate || item.date).getTime(),
      y: getSeriesValue(item),
      index: idx,
    }));
    const pointLineDistance = (
      point: ChartPoint,
      lineStart: ChartPoint,
      lineEnd: ChartPoint
    ) => {
      const dx = lineEnd.x - lineStart.x;
      const dy = lineEnd.y - lineStart.y;
      if (dx === 0 && dy === 0) {
        const px = point.x - lineStart.x;
        const py = point.y - lineStart.y;
        return Math.hypot(px, py);
      }
      const t =
        ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) /
        (dx * dx + dy * dy);
      const projX = lineStart.x + t * dx;
      const projY = lineStart.y + t * dy;
      return Math.hypot(point.x - projX, point.y - projY);
    };
    const rdp = (pts: ChartPoint[], epsilon: number): ChartPoint[] => {
      if (pts.length < 3) return pts;
      let maxDist = 0;
      let maxIndex = 0;
      const start = pts[0];
      const end = pts[pts.length - 1];
      for (let i = 1; i < pts.length - 1; i += 1) {
        const dist = pointLineDistance(pts[i], start, end);
        if (dist > maxDist) {
          maxDist = dist;
          maxIndex = i;
        }
      }
      if (maxDist > epsilon) {
        const left: ChartPoint[] = rdp(pts.slice(0, maxIndex + 1), epsilon);
        const right: ChartPoint[] = rdp(pts.slice(maxIndex), epsilon);
        return left.slice(0, -1).concat(right);
      }
      return [start, end];
    };
    const yValues = points.map((p) => p.y);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    const rangeY = Math.max(1e-6, maxY - minY);
    const rdpTarget = Math.max(6, targetCount - 5);
    let low = 0;
    let high = rangeY;
    for (let i = 0; i < 24; i += 1) {
      const mid = (low + high) / 2;
      const count = rdp(points, mid).length;
      if (count > rdpTarget) {
        low = mid;
      } else {
        high = mid;
      }
    }
    const rdpPoints: ChartPoint[] = rdp(points, high);
    const selected = new Set<number>(rdpPoints.map((p) => p.index));
    const extremes = points
      .slice(1, -1)
      .map((_, i) => {
        const prev = points[i];
        const curr = points[i + 1];
        const next = points[i + 2];
        const isPeak = curr.y > prev.y && curr.y > next.y;
        const isTrough = curr.y < prev.y && curr.y < next.y;
        if (!isPeak && !isTrough) return null;
        const prominence = Math.min(
          Math.abs(curr.y - prev.y),
          Math.abs(curr.y - next.y)
        );
        return { index: curr.index, prominence };
      })
      .filter((v): v is { index: number; prominence: number } => v !== null)
      .sort((a, b) => b.prominence - a.prominence);
    for (const extreme of extremes) {
      if (selected.size >= targetCount) break;
      selected.add(extreme.index);
    }
    if (selected.size > targetCount) {
      const scores = new Map<number, number>();
      extremes.forEach((e) => scores.set(e.index, e.prominence));
      const firstIndex = 0;
      const lastIndex = points.length - 1;
      const removable = Array.from(selected).filter(
        (idx) => idx !== firstIndex && idx !== lastIndex
      );
      removable.sort((a, b) => {
        const scoreA = scores.get(a) ?? 0;
        const scoreB = scores.get(b) ?? 0;
        return scoreA - scoreB;
      });
      let removeCount = selected.size - targetCount;
      for (const idx of removable) {
        if (removeCount <= 0) break;
        selected.delete(idx);
        removeCount -= 1;
      }
    }
    const sortedIndices = Array.from(selected).sort((a, b) => a - b);
    return sortedIndices.map((idx) => filteredTimeSeries[idx]);
  }, [filteredTimeSeries, supportsRangeFilter]);

  const getWallByMetric = (
    rows: TickerOptionChain["calls"],
    metric: "openInterest" | "volume"
  ) => {
    if (!rows || rows.length === 0) return null;
    return rows.reduce((best, current) =>
      current[metric] > best[metric] ? current : best
    ).strike;
  };

  return (
    <section
      key={symbol}
      ref={onRef}
      data-symbol={symbol}
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 md:p-6 scroll-mt-20"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4 mb-4">
        <div>
          <h2 className="text-xl font-black text-slate-900 dark:text-slate-50">
            {symbol}
            {API_SYMBOL_MAP[symbol] !== symbol && (
              <span className="ml-2 text-xs font-bold text-slate-400">
                ({API_SYMBOL_MAP[symbol]})
              </span>
            )}
          </h2>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            {assetData?.currentPrice ? (
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                현재가: ${assetData.currentPrice.toFixed(2)}
              </p>
            ) : (
              <p className="text-sm font-semibold text-slate-400">
                현재가: -
              </p>
            )}
            {typeof assetData?.changePercent === "number" ? (
              <span
                className={`text-sm font-bold ${
                  assetData.changePercent >= 0
                    ? "text-emerald-500"
                    : "text-red-500"
                }`}
              >
                {assetData.changePercent >= 0 ? "+" : ""}
                {assetData.changePercent.toFixed(2)}%
              </span>
            ) : (
              <span className="text-sm font-semibold text-slate-400">
                전일대비: -
              </span>
            )}
          </div>
          {assetUpdated && (
            <p className="text-[10px] font-bold text-slate-400 mt-1">
              {assetUpdated}
            </p>
          )}
        </div>
        {supportsRangeFilter && (
          <div className="flex items-center gap-2">
            {(["1m", "3m", "6m", "1y"] as const).map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setRangeFilter?.(range)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-black border transition-colors ${
                  activeRangeFilter === range
                    ? "selected-nav-button text-white border-slate-900"
                    : "bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700"
                }`}
              >
                {range === "1m"
                  ? "1개월"
                  : range === "3m"
                  ? "3개월"
                  : range === "6m"
                  ? "6개월"
                  : "1년"}
              </button>
            ))}
          </div>
        )}
      </div>

      {assetError && !assetData && (
        <div className="text-xs text-red-500 mb-4">{assetError}</div>
      )}

      {!assetData && !assetError && (
        <div className="text-xs text-slate-400">데이터를 불러오는 중...</div>
      )}

      {assetData && (
        <div className="space-y-8">
          <section className="border rounded-2xl shadow-sm bg-white overflow-hidden">
            <div className="p-4 md:p-6 border-b">
              <h3 className="text-lg font-bold text-slate-800">
                {supportsRangeFilter ? "일별" : "만기일별"} 지지/저항 및 시장 방어력
              </h3>
            </div>
            <div className="overflow-x-auto pb-4 custom-scrollbar relative">
              <div className="h-[400px] min-w-[900px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={chartTimeSeries}
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
                      dataKey={(item) => item.totalGex / 1e9}
                      fill="#3b82f6"
                      fillOpacity={0.08}
                      stroke="#3b82f6"
                      strokeWidth={2}
                      name="GEX Energy"
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="callResistance"
                      stroke="#ef4444"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={{ r: 5, fill: "#ef4444" }}
                      name="Call Wall"
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="putSupport"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={{ r: 5, fill: "#3b82f6" }}
                      name="Put Wall"
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="expectedPrice"
                      stroke="#6366f1"
                      strokeWidth={2.5}
                      dot={{ r: 5, fill: "#6366f1" }}
                      name="예상 종가 (Target)"
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="expectedUpper"
                      stroke="#10b981"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                      dot={false}
                      name="1-SD 상단 (기대범위)"
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="expectedLower"
                      stroke="#10b981"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                      dot={false}
                      name="1-SD 하단 (기대범위)"
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey={() => assetData.currentPrice}
                      stroke="#1e293b"
                      strokeWidth={1}
                      dot={false}
                      strokeOpacity={0.4}
                      name="현재가"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {supportsRangeFilter && isFiltering && (
                <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-[1px] rounded-2xl" />
              )}
            </div>
          </section>

          <section className="p-4 md:p-6 border rounded-2xl shadow-sm bg-white overflow-hidden">
            <div className="mb-6 border-b pb-4">
              <h3 className="text-lg font-bold text-slate-800">
                {supportsRangeFilter ? "일별" : "만기일별"} 시장 심리 추세
              </h3>
            </div>
            <div className="overflow-x-auto pb-4 custom-scrollbar relative">
              <div className="h-[250px] min-w-[900px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={chartTimeSeries}
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
                    <ReferenceArea y1={-20} y2={20} fill="#e2e8f0" />
                    <Line
                      type="monotone"
                      dataKey="sentiment"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: "#10b981" }}
                      name="Sentiment"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {supportsRangeFilter && isFiltering && (
                <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-[1px] rounded-2xl" />
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-indigo-500" />
                  {symbol} 만기 현황
                </h4>
                <div className="flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-0.5">
                  <button
                    type="button"
                    onClick={() => setExpirationType(symbol, "daily")}
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-black transition-colors ${
                      expirationType === "daily"
                        ? "bg-indigo-500 text-white"
                        : "text-slate-500 hover:text-indigo-600"
                    }`}
                  >
                    Daily
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpirationType(symbol, "weekly")}
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
                    onClick={() => setExpirationType(symbol, "monthly")}
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
              <a
                href={`https://optioncharts.io/options/${symbol}`}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 uppercase tracking-widest"
              >
                OptionCharts 보기
              </a>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              {expirations.length === 0 && !optionsLoading && (
                <span className="text-xs text-slate-400">
                  만기일 정보를 불러오지 못했습니다.
                </span>
              )}
              {expirations.map((exp) => (
                <button
                  key={exp}
                  onClick={() => {
                    setSelectedExpiration(symbol, exp);
                    loadAssetOptionChain(symbol, exp, expirationType);
                  }}
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
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                onClick={() => setSortBy(symbol, "oi")}
                className={`px-3 py-1 rounded-full text-[11px] font-black border transition-colors ${
                  sortBy === "oi"
                    ? "selected-nav-button text-white border-slate-900"
                    : "bg-white text-slate-500 border-black hover:border-slate-300 hover:text-slate-700"
                }`}
              >
                OI 기준
              </button>
              <button
                type="button"
                onClick={() => setSortBy(symbol, "volume")}
                className={`px-3 py-1 rounded-full text-[11px] font-black border transition-colors ${
                  sortBy === "volume"
                    ? "selected-nav-button  text-white border-slate-900"
                    : "bg-white text-slate-500 border-black hover:border-slate-300 hover:text-slate-700"
                }`}
              >
                Volume 기준
              </button>
            </div>
            {optionsLoading && (
              <div className="text-xs text-slate-400">
                옵션 데이터를 불러오는 중...
              </div>
            )}
            {optionsError && (
              <div className="text-xs text-red-500">{optionsError}</div>
            )}
            {optionChain && (
              <div className="space-y-4">
                {(() => {
                  const metricKey =
                    sortBy === "volume" ? "volume" : "openInterest";
                  const callWallByMetric =
                    metricKey === "volume"
                      ? getWallByMetric(optionChain.calls, "volume")
                      : optionChain.summary.callWall;
                  const putWallByMetric =
                    metricKey === "volume"
                      ? getWallByMetric(optionChain.puts, "volume")
                      : optionChain.summary.putWall;
                  const wallLabelSuffix = metricKey === "volume" ? " (Volume)" : " (OI)";
                  const sortedCalls = optionChain.calls
                    .slice()
                    .sort((a, b) => b[metricKey] - a[metricKey]);
                  const sortedPuts = optionChain.puts
                    .slice()
                    .sort((a, b) => b[metricKey] - a[metricKey]);

                  return (
                    <>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  <div className="p-4 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      만기일
                    </div>
                    <div className="text-lg font-black text-slate-700 dark:text-slate-100">
                      {optionChain.expirationDate}
                    </div>
                  </div>
                  <div className="p-4 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      PCR
                    </div>
                    <div className="text-lg font-black text-slate-700 dark:text-slate-100">
                      {optionChain.summary.pcr.toFixed(2)}
                    </div>
                  </div>
                  <div className="p-4 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900">
                    <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
                      Call Wall{wallLabelSuffix}
                    </div>
                    <div className="text-lg font-black text-emerald-600">
                      {callWallByMetric
                        ? `$${callWallByMetric.toFixed(2)}`
                        : "-"}
                    </div>
                  </div>
                  <div className="p-4 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900">
                    <div className="text-[10px] font-bold text-rose-600 uppercase tracking-widest">
                      Put Wall{wallLabelSuffix}
                    </div>
                    <div className="text-lg font-black text-rose-600">
                      {putWallByMetric
                        ? `$${putWallByMetric.toFixed(2)}`
                        : "-"}
                    </div>
                  </div>
                  <div className="p-4 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900">
                    <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                      Max Pain (OI)
                    </div>
                    <div className="text-lg font-black text-slate-700 dark:text-slate-100">
                      {optionChain.summary.maxPain
                        ? `$${optionChain.summary.maxPain.toFixed(2)}`
                        : "-"}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-200 text-xs font-bold uppercase tracking-widest">
                      Calls
                    </div>
                    <div className="max-h-[320px] overflow-y-auto">
                      <table className="w-full text-[11px]">
                        <thead className="text-slate-400 dark:text-slate-500 uppercase tracking-wider text-[10px]">
                          <tr>
                            <th className="px-4 py-2 text-left">Max Pain</th>
                            <th className="px-4 py-2 text-left">Strike</th>
                            <th className="px-4 py-2 text-right">Last</th>
                            <th className="px-4 py-2 text-right">OI</th>
                            <th className="px-4 py-2 text-right">Volume</th>
                            <th className="px-4 py-2 text-right">IV</th>
                            <th className="px-4 py-2 text-right">ITM</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedCalls.map((opt, idx) => (
                              <tr
                                key={`${opt.strike}-${idx}`}
                                className="border-t border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-200"
                              >
                                <td className="px-4 py-2 font-mono">
                                  {optionChain.summary.maxPain
                                    ? `$${optionChain.summary.maxPain.toFixed(
                                        2
                                      )}`
                                    : "-"}
                                </td>
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
                                  {opt.volume.toLocaleString()}
                                </td>
                                <td className="px-4 py-2 text-right font-mono">
                                  {(opt.impliedVolatility * 100).toFixed(1)}%
                                </td>
                                <td className="px-4 py-2 text-right font-mono">
                                  {opt.inTheMoney ? "Y" : "N"}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-200 text-xs font-bold uppercase tracking-widest">
                      Puts
                    </div>
                    <div className="max-h-[320px] overflow-y-auto">
                      <table className="w-full text-[11px]">
                        <thead className="text-slate-400 dark:text-slate-500 uppercase tracking-wider text-[10px]">
                          <tr>
                            <th className="px-4 py-2 text-left">Max Pain</th>
                            <th className="px-4 py-2 text-left">Strike</th>
                            <th className="px-4 py-2 text-right">Last</th>
                            <th className="px-4 py-2 text-right">OI</th>
                            <th className="px-4 py-2 text-right">Volume</th>
                            <th className="px-4 py-2 text-right">IV</th>
                            <th className="px-4 py-2 text-right">ITM</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedPuts.map((opt, idx) => (
                              <tr
                                key={`${opt.strike}-${idx}`}
                                className="border-t border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-200"
                              >
                                <td className="px-4 py-2 font-mono">
                                  {optionChain.summary.maxPain
                                    ? `$${optionChain.summary.maxPain.toFixed(
                                        2
                                      )}`
                                    : "-"}
                                </td>
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
                                  {opt.volume.toLocaleString()}
                                </td>
                                <td className="px-4 py-2 text-right font-mono">
                                  {(opt.impliedVolatility * 100).toFixed(1)}%
                                </td>
                                <td className="px-4 py-2 text-right font-mono">
                                  {opt.inTheMoney ? "Y" : "N"}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                    </>
                  );
                })()}
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
};

export default AssetSection;
