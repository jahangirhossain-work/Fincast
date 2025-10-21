// server.js
// Backend for Fin-Cast KSA - Handles all financial logic and API requests.
// VERSION 2.0: Upgraded to a Seasonal-Trend Forecasting Model for higher accuracy.

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// --- CORE FINANCIAL LOGIC (UPGRADED) ---

/**
 * Performs a linear regression on a given set of data points.
 * @param {number[]} y - An array of numbers.
 * @returns {{slope: number, intercept: number}} - The calculated slope and intercept.
 */
function linearRegression(y) {
    const n = y.length;
    if (n === 0) return { slope: 0, intercept: 0 };
    const x = Array.from({ length: n }, (_, i) => i);
    let sum_x = 0, sum_y = 0, sum_xy = 0, sum_xx = 0;
    for (let i = 0; i < n; i++) {
        sum_x += x[i];
        sum_y += y[i];
        sum_xy += (x[i] * y[i]);
        sum_xx += (x[i] * x[i]);
    }
    const denominator = (n * sum_xx - sum_x * sum_x);
    if (denominator === 0) return { slope: 0, intercept: y.reduce((a, b) => a + b, 0) / n || 0 };
    const slope = (n * sum_xy - sum_x * sum_y) / denominator;
    const intercept = (sum_y - slope * sum_x) / n;
    return { slope, intercept };
}

/**
 * Analyzes historical data to find a seasonal pattern.
 * This is a simplified decomposition model suitable for 12 months of data.
 * @param {number[]} historicalData - 12 months of historical revenue.
 * @returns {number[]} An array of 12 seasonal factors (e.g., 1.1 for +10%, 0.9 for -10%).
 */
function getSeasonalFactors(historicalData) {
    if (historicalData.length !== 12) {
        // If we don't have 12 months, we can't determine seasonality. Return a neutral pattern.
        return Array(12).fill(1);
    }

    // 1. Calculate the overall trend line for the historical data.
    const { slope, intercept } = linearRegression(historicalData);
    const trendLine = historicalData.map((_, i) => slope * i + intercept);

    // 2. Detrend the data to isolate seasonal effects.
    const detrended = historicalData.map((value, i) => {
        // Avoid division by zero or very small numbers
        return trendLine[i] !== 0 ? value / trendLine[i] : 1;
    });

    // 3. Normalize the factors so they average out to 1 over the year.
    const avgFactor = detrended.reduce((a, b) => a + b, 0) / 12;
    if (avgFactor === 0) return Array(12).fill(1); // Avoid division by zero
    
    const seasonalFactors = detrended.map(factor => factor / avgFactor);

    return seasonalFactors;
}


// --- API Endpoints ---
app.post('/api/forecast', (req, res) => {
    try {
        const { 
            historicalRevenues,
            cogsPercent,
            applyVat,
            zakatBase,
            optimisticModifier,
            pessimisticModifier,
            expenseItems
        } = req.body;

        if (!historicalRevenues || !Array.isArray(historicalRevenues) || historicalRevenues.length !== 12) {
            return res.status(400).json({ error: 'historicalRevenues is required and must be an array of 12 numbers.' });
        }
        
        const monthlyOpEx = expenseItems.reduce((sum, item) => sum + (item.value || 0), 0);
        const annualZakat = (zakatBase || 0) * 0.025;
        const cogsRate = (cogsPercent || 0) / 100;
        const optRate = 1 + ((optimisticModifier || 0) / 100);
        const pessRate = 1 + ((pessimisticModifier || 0) / 100);

        // --- UPGRADED FORECASTING MODEL ---
        // 1. Determine the seasonal pattern from the past 12 months.
        const seasonalFactors = getSeasonalFactors(historicalRevenues);
        // 2. Project the core trend forward using linear regression.
        const trendModel = linearRegression(historicalRevenues);

        // --- Generate Forecasted Revenue Data ---
        const forecastedRevenues = { baseline: [], optimistic: [], pessimistic: [] };
        for (let i = 0; i < 12; i++) {
            // Project the trend for the next 12 months (indices 12 to 23)
            const trendPrediction = trendModel.slope * (12 + i) + trendModel.intercept;
            // Re-apply the corresponding seasonal factor for that month
            const seasonalPrediction = trendPrediction * seasonalFactors[i];
            
            const baseline = seasonalPrediction > 0 ? seasonalPrediction : 0;
            forecastedRevenues.baseline.push(baseline);
            forecastedRevenues.optimistic.push(baseline * optRate);
            forecastedRevenues.pessimistic.push(baseline * pessRate);
        }

        // --- Build the Full 24-Month Report ---
        const fullReport = [];
        const allBaselineRevenues = [...historicalRevenues, ...forecastedRevenues.baseline];
        
        let totalForecastedRevenue = 0, totalForecastedNetProfit = 0, totalVat = 0;

        for (let i = 0; i < 24; i++) {
            const isHistorical = i < 12;
            const revenue = allBaselineRevenues[i];
            const cogs = revenue * cogsRate;
            const grossProfit = revenue - cogs;
            const vat = applyVat ? revenue * 0.15 : 0;
            const zakatForMonth = (!isHistorical && i === 23) ? annualZakat : 0;
            const netProfit = grossProfit - monthlyOpEx - vat - zakatForMonth;

            if (!isHistorical) {
                totalForecastedRevenue += revenue;
                totalForecastedNetProfit += netProfit;
                totalVat += vat;
            }

            fullReport.push({
                monthIndex: i,
                isHistorical,
                revenue,
                cogs,
                grossProfit,
                monthlyOpEx,
                vat,
                zakatForMonth,
                netProfit
            });
        }
        
        const netProfitMargin = totalForecastedRevenue > 0 ? (totalForecastedNetProfit / totalForecastedRevenue) * 100 : 0;

        res.json({
            forecastedRevenues,
            fullReport,
            kpis: {
                annualRevenue: totalForecastedRevenue,
                netMargin: netProfitMargin,
                vat: totalVat,
                zakat: annualZakat
            }
        });

    } catch (error) {
        console.error('Error in /api/forecast:', error);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});


// --- Server Initialization ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});