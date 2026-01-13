# QQQ Flow Analyzer 핵심 공식 가이드

본 문서는 QQQ Flow Analyzer에서 시장 수급 및 변동성을 분석하기 위해 사용하는 핵심 금융 공식을 정리한 문서입니다. 모든 계산은 서버(`api/index.ts`)에서 실시간으로 수행됩니다.

---

## 1. 옵션 에너지 분석 (GEX: Gamma Exposure)

시장 조성자(Market Maker)들의 헤지 물량을 추정하여 시장의 수급 압력을 계산합니다.

### **GEX 계산 공식**
$$GEX = (\text{Type Weight}) \times \Gamma \times \text{Open Interest} \times 100 \times \text{Spot Price} \times (\text{Spot Price} \times 0.01)$$

*   **Type Weight**: Call 옵션은 $+1$, Put 옵션은 $-1$
*   **$\Gamma$ (Gamma)**: Black-Scholes 모델로 산출된 옵션 감마값
*   **Open Interest**: 미결제약정 (계약 수)
*   **100**: 계약당 승수 (Standard Multiplier)
*   **Spot Price $\times 0.01$**: 주가 1% 변동 시 발생하는 명목 노출액(Dollar Notional)으로 표준화

---

## 2. 시장 심리 및 확률 분석

### **시장 심리 지수 (Sentiment Index)**
전체 옵션 시장에서 어느 쪽 힘이 우세한지 비율로 나타냅니다. (범위: -100% ~ +100%)
$$\text{Sentiment} = \frac{\sum GEX_{\text{Call}} + \sum GEX_{\text{Put}}}{\sum |GEX_{\text{Call}}| + \sum |GEX_{\text{Put}}|} \times 100$$

### **가격 변동 확률 (Price Probability)**
GEX 에너지 분포를 기반으로 상승/하락/중립 가능성을 도출합니다.
1.  **Up Prob**: $\frac{\sum \text{Energy}_{\text{Call}}}{\text{Total Energy}} \times 100$
2.  **Down Prob**: $\frac{\sum \text{Energy}_{\text{Put}}}{\text{Total Energy}} \times 100$
3.  **Neutral Prob**: $100 - (\text{Up Prob} - \text{Down Prob} \text{의 가중 변동폭})$
    *   *GEX 에너지가 부족할 경우 미결제약정(OI) 수량 기반으로 자동 전환(Fallback) 됩니다.*

---

## 3. 주요 가격 레벨 (Walls & Trigger)

### **지지/저항선 (Put Support / Call Resistance)**
*   **Call Wall**: 현재가 이상의 행사가 중 미결제약정(OI)이 가장 큰 지점 (강력한 저항)
*   **Put Wall**: 현재가 이하의 행사가 중 미결제약정(OI)이 가장 큰 지점 (강력한 지지)

### **감마 플립 (Gamma Flip)**
시장 전체의 순 GEX 에너지가 0이 되는 지점으로, 이 가격 아래에서는 변동성이 급증합니다.
*   **계산**: 행사가별 Total GEX를 스캔하여 부호가 바뀌는 지점을 선형 보간법으로 산출

### **변동성 트리거 (Volatility Trigger)**
감마 플립 하단의 심리적 마지노선으로, 패닉 셀링 가속 여부를 판단합니다.
$$\text{Volatility Trigger} = \text{Gamma Flip Price} \times 0.985$$

---

## 4. 티커별 상관분석 (Beta Analysis)

QQQ의 움직임에 따른 개별 종목(TQQQ, SQQQ, NVDA 등)의 예상 가격을 도출합니다.

### **수동 베타 (Manual Beta) 계산**
$$\beta = \frac{\text{Covariance}(R_{\text{Ticker}}, R_{\text{QQQ}})}{\text{Variance}(R_{\text{QQQ}})}$$
*   최근 1, 3, 6, 12개월간의 일일 수익률($R$) 데이터를 기반으로 직접 산출합니다.

### **예상 목표가 (Expected Target)**
$$\text{Ticker Target} = \text{Ticker Current} \times (1 + \beta \times (\frac{\text{QQQ Target}}{\text{QQQ Current}} - 1))$$

---

## 5. 수치 해석 보정 (Advanced)

### **내재변동성(IV) 역계산 (Newton-Raphson)**
Yahoo Finance IV 데이터가 부정확할 경우, 현재 옵션 시장가(`Last Price`)를 바탕으로 실제 IV를 직접 역산합니다.
$$\sigma_{n+1} = \sigma_n - \frac{BS_{\text{price}}(\sigma_n) - \text{Market Price}}{\text{Vega}(\sigma_n)}$$

### **시간 가중 평균 레벨 (Time-Weighted Level)**
여러 만기일의 분석 데이터를 하나로 통합할 때, 가까운 만기일(0DTE 등)에 더 높은 가중치를 부여합니다.
$$\text{Weight} = \frac{1}{\sqrt{T}} \quad (T = \text{잔존만기 연단위})$$
$$\text{Weighted Level} = \frac{\sum (\text{Level}_i \times \text{Weight}_i)}{\sum \text{Weight}_i}$$
