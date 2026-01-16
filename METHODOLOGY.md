## 목적

이 문서는 현재 코드 기준으로 "구간 산출 방식", "지표 정의/계산법",
그리고 "백테스트/검증 지표"의 상태를 정리한 기술 문서입니다.
수식과 규칙은 `api/index.ts` 구현을 그대로 요약합니다.

---

## 1) Strong Buy / Sell 구간 산출 방식

### 입력값

- `currentPrice`: QQQ 현재가
- `putSupport`, `callResistance`: 옵션 OI 기반 지지/저항
- `expectedLower`, `expectedUpper`: IV 기반 기대 변동 폭
- `recommendations`: 위 값을 종합해 생성된 구간

### 주요 레벨 계산

- **Put Wall (지지선)**  
  `strike <= currentPrice`인 put 중 OI 최대 행사가
- **Call Wall (저항선)**  
  `strike >= currentPrice`인 call 중 OI 최대 행사가

- **Expected Move (IV 기반)**
  - 근ATM 옵션(현물 대비 ±5%)의 평균 IV 사용
  - `expectedMove = currentPrice * avgIV * sqrt(T) * 0.4`
  - `expectedUpper = currentPrice + expectedMove`
  - `expectedLower = currentPrice - expectedMove`

- **현실적 지지/저항**
  - `realisticSupport = max(putWall, expectedLower)`
  - `realisticResistance = min(callWall, expectedUpper)`

### 구간 생성 규칙 (Strong Buy / Sell 포함)

`generateRecommendations()` 로직:

1. 지지/저항이 뒤집힌 경우 정렬  
   `low = min(support, resistance)`, `high = max(support, resistance)`
2. 최소 구간 폭 확보  
   `minWidth = currentPrice * 0.02`  
   `high - low < minWidth`이면 구간을 강제로 2%폭으로 확장
3. **Neutral 중심 구간**
   - `mid = (low + high) / 2`
   - `range = high - low`
   - `neutralStart = mid - range * 0.1`
   - `neutralEnd = mid + range * 0.1`
4. **Extreme Risk**
   - `panicLevel = low * 0.97`
5. 최종 구간
   - `Extreme Risk`: `0 ~ panicLevel`
   - `Strong Buy`: `panicLevel ~ low`
   - `Buy`: `low ~ neutralStart`
   - `Neutral`: `neutralStart ~ neutralEnd`
   - `Sell`: `neutralEnd ~ high`
   - `Strong Sell`: `high ~ high + 20`

> 요약: Strong Buy/Sell은 "옵션 OI 기반 지지/저항" + "IV 기반 기대폭"을
> 합쳐 만든 현실적 레인지에서 파생된 **상대적 구간**입니다.

---

## 2) 지표 정의와 계산법

### 공통 전처리

- **OI 보정**  
  옵션의 OI가 0이면 `volume * 0.1`, 그마저도 없으면 `1` 사용
- **IV 보정**  
  IV가 0.001 미만이면 Black-Scholes로 역산  
  `IV_CLAMP_MIN <= IV <= IV_CLAMP_MAX`로 클램핑  
  감마 계산용 IV는 `max(0.1, IV)` 적용

### Gamma (옵션별)

- Black-Scholes 계산 결과의 `gamma` 사용
- `gamma = abs(result.gamma)`

### GEX (옵션별)

```
gex = (call ? 1 : -1) * gamma * openInterest * 100 * spot^2 * 0.01
```

### Call/Put GEX, Total GEX

```
callGex = sum(call.gex)
putGex  = sum(put.gex)
totalGex = callGex + putGex
```

### Sentiment Score

```
sentiment =
  (abs(callGex) + abs(putGex) > 0)
    ? ((callGex + putGex) / (abs(callGex) + abs(putGex))) * 100
    : 0
```

### Gamma Flip (Zero Gamma Level)

- Spot 기준 ±10% 범위에서 Net GEX 부호가 바뀌는 지점을 탐색
- `calculateNetGexAtSpot()` 사용
- 이진 탐색 15회로 0에 가까운 지점 탐색

### Vol Trigger

```
volTrigger = gammaFlip * 0.985
```

### Up / Down / Neutral 확률

1) **GEX 에너지 기반**

```
totalCallEnergy = sum(max(0, call.gex))
totalPutEnergy  = sum(abs(min(0, put.gex)))
totalEnergy = totalCallEnergy + totalPutEnergy
```

```
rawUpProb   = totalCallEnergy / totalEnergy * 100
rawDownProb = totalPutEnergy  / totalEnergy * 100

neutralProb = max(15, 100 - abs(rawUpProb - rawDownProb) * 1.2 - 10)
remaining = 100 - neutralProb
ratio = rawUpProb / (rawUpProb + rawDownProb)

upProb   = min(80, remaining * ratio)
downProb = min(80, remaining * (1 - ratio))
neutralProb = 100 - upProb - downProb
```

2) **에너지가 없을 때 OI 기반 대체**

```
totalOI = filteredCallOI + filteredPutOI
upProb   = filteredCallOI / totalOI * 100
downProb = filteredPutOI  / totalOI * 100
neutralProb = 15
```

이후 동일하게 `remaining`, `ratio`, `cap(80%)` 적용.

### PCR (Put/Call Ratio)

- `pcrAll`: 전체 OI 기준  
  `totalPutOI_All / totalCallOI_All`
- `pcrFiltered`: ATM ±10% 필터 기준  
  `filteredPutOI / filteredCallOI`

### 예상 종가 (Expected Price)

1) 기대 구간 계산  
   `realisticSupport = max(putWall, expectedLower)`  
   `realisticResistance = min(callWall, expectedUpper)`

2) 중심 및 폭  
   `rangeMid = (support + resistance) / 2`  
   `rangeHalf = (resistance - support) / 2`

3) 편향 (sentiment + gamma)

```
sentimentBias = (sentiment / 100) * 0.3
gammaBiasRaw = clamp((gammaFlip - rangeMid) / rangeHalf, -1, 1)
gammaBias = gammaBiasRaw * sign(totalGex) * 0.2
combinedBias = clamp(sentimentBias + gammaBias, -0.35, 0.35)
expectedPrice = rangeMid + rangeHalf * combinedBias
```

---

## 3) 백테스트 / 검증 지표

백테스트/검증 리포트는 `scripts/backtest-qqq.ts`로 생성됩니다.
기본 출력 경로는 `reports/backtest-qqq.md`입니다.

### 포함 지표

- Strong Buy / Buy 진입 후 H+1/3/5일 수익률
- 승률, 평균 수익/손실, 기대수익(Expectancy), MDD
- UpProb / Sentiment 기반 ROC AUC, Brier score

### 제한사항

Yahoo Finance는 과거 옵션 체인 스냅샷을 제공하지 않으므로,
리포트는 **현재 옵션 체인 + 과거 가격**을 조합한 proxy 백테스트입니다.
결과는 참고용이며 통계적 신뢰도는 낮습니다.

### 실행 예시

```
tsx scripts/backtest-qqq.ts --months 24 --horizons 1,3,5
```

---

## 구현 위치 참고

- 지표 계산 및 구간 산출: `api/index.ts`
- 핵심 지표 유틸: `api/analysis/metrics.ts`

