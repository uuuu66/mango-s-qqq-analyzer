# QQQ Flow Analyzer - Agent Context

This document provides technical and functional context for AI agents working on the QQQ Flow Analyzer project.

## Project Overview

The **QQQ Flow Analyzer** is a real-time market analysis tool that uses options market data (Gamma Exposure - GEX) to identify potential support/resistance levels, market regimes, and price probabilities for QQQ and related leveraged tickers (QLD, TQQQ, SQQQ).

## Tech Stack

- **Frontend:** React (TypeScript), Vite, Tailwind CSS, Recharts (Visualization), Lucide React (Icons).
- **Backend:** Node.js (Express) hosted via Vercel Functions.
- **Data Source:** Yahoo Finance API (`yahoo-finance2`).
- **Calculations:** `@uqee/black-scholes` for option Greeks (Gamma).

## Core Logic & Features

### 1. GEX (Gamma Exposure) Analysis

- **Call Wall (Resistance):** The strike price with the highest positive GEX energy.
- **Put Wall (Support):** The strike price with the highest negative GEX energy.
- **Gamma Flip:** The price level where net GEX cross zero. Below this level, volatility typically increases (Volatile Regime); above it, market is more stable (Stabilizing Regime).
- **Volatility Trigger:** Calculated as `Gamma Flip * 0.985`, representing a panic threshold.

### 2. Time-Series Outlook (30-Day)

- The system analyzes option chains for the next **30 days**.
- It calculates weighted support/resistance levels using a time-decay factor (`1/sqrt(T)`) where $T$ is time to expiration.

### 3. Ticker-Specific Analysis (Beta-Adjusted)

- Users can analyze individual tickers (e.g., QLD, TQQQ, SQQQ).
- **Beta Calculation:** The backend calculates a manual beta ($\beta$) by comparing the historical returns of the ticker vs. QQQ (benchmark) over a user-selected period (1, 3, 6, 12, 24 months).
- **Price Projection Formula:** `Target = Current * (1 + Beta * (QQQ_Target / QQQ_Current - 1))`.

### 4. Probability & Profit Potential

- **Daily Max Profit:** Calculated based on the spread between the Put Wall and Call Wall.
- **Price Probability:**
  - **Up Prob:** Ratio of Call GEX energy to total energy.
  - **Down Prob:** Ratio of Put GEX energy to total energy.
  - **Neutral Prob:** Calculated based on energy dispersion around the current price.
- **Inverse Ticker Handling:** For tickers with negative beta (e.g., SQQQ), the logic swaps entry/exit points and flips the Up/Down probabilities to reflect the inverse relationship with QQQ.

### 5. UI/UX Elements

- **Logo:** `public/mqa.jpg` used in the header.
- **Timestamps:** Displays both US Eastern Time (America/New_York) and Korean Standard Time (Asia/Seoul) for the latest market data.
- **Outlook Badge:** Currently set to "30-Day Outlook".

## Key Files

- `api/index.ts`: Main backend logic including Yahoo Finance fetching, GEX calculations, and Beta calculation.
- `src/App.tsx`: Main dashboard UI, chart configurations, and state management.
- `src/services/optionService.ts`: Frontend service for API communication and type definitions.

## Recent Changes

- Extended analysis period from 14 to 30 days.
- Implemented ticker-specific daily profit and probability analysis.
- Fixed inverse logic for SQQQ swing scenarios (Entry at QQQ resistance, Exit at QQQ support).
- Added dual timezone (NY/KR) data timestamps.
- Added GEX Imbalance bar chart to visualize Call vs. Put energy distribution.

## Agent Guidelines

- **Data Integrity:** Always ensure IV (Implied Volatility) is valid before Black-Scholes calculation.
- **Inverse Logic:** When adding features to individual ticker analysis, always check `beta < 0` to handle inverse tickers correctly.
- **Performance:** Option chain fetching is heavy; use `Promise.all` for expiration dates but be mindful of rate limits.
