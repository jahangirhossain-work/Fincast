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
 * Calculates seasonal indices from historical data.
 * @param {number[]} data - Array of historical data (must be 12 months).
 * @returns {number[]} - Array of 12 seasonal indices.
 */
function calculateSeasonalIndices(data) {
    if (data.length !== 12) {
        // Return a neutral index if data is not 12 months
        return Array(12).fill(1);
    }
    const average = data.reduce((a, b) => a + b, 0) / 12;
    if (average === 0) {
        return Array(12).fill(1);
    }
    return data.map(val => val / average);
}


// --- API ENDPOINT ---
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

        if (!historicalRevenues || historicalRevenues.length !== 12) {
            return res.status(400).json({ error: '12 months of historical revenue data are required.' });
        }

        // 1. Calculate Seasonal Indices
        const seasonalIndices = calculateSeasonalIndices(historicalRevenues);

        // 2. Deseasonalize Data and find Trend
        const deseasonalizedData = historicalRevenues.map((val, i) => val / seasonalIndices[i]);
        const model = linearRegression(deseasonalizedData);

        // 3. Forecast Trend for next 12 months
        const forecastedTrend = [];
        for (let i = 0; i < 12; i++) {
            const trendValue = model.slope * (12 + i) + model.intercept;
            forecastedTrend.push(trendValue > 0 ? trendValue : 0);
        }

        // 4. Re-seasonalize the forecast and create scenarios
        const baselineForecast = forecastedTrend.map((val, i) => val * seasonalIndices[i]);
        
        const forecastedRevenues = {
            baseline: baselineForecast,
            optimistic: baselineForecast.map(val => val * (1 + (optimisticModifier / 100))),
            pessimistic: baselineForecast.map(val => val * (1 + (pessimisticModifier / 100)))
        };

        // 5. Generate Full Report using baseline forecast
        const monthlyOpEx = expenseItems.reduce((sum, item) => sum + item.value, 0);
        const annualZakat = zakatBase * 0.025;

        const fullReport = [];
        let totalForecastedRevenue = 0;
        let totalForecastedNetProfit = 0;
        let totalVat = 0;

        const allRevenues = [...historicalRevenues, ...forecastedRevenues.baseline];

        for (let i = 0; i < 24; i++) {
            const isHistorical = i < 12;
            const revenue = allRevenues[i];
            const cogs = revenue * (cogsPercent / 100);
            const grossProfit = revenue - cogs;
            const vat = applyVat ? revenue * 0.15 : 0;
            const zakatForMonth = (!isHistorical && i === 23) ? annualZakat : 0;
            const profitBeforeTax = grossProfit - monthlyOpEx;
            const netProfit = profitBeforeTax - vat - zakatForMonth;

            if (!isHistorical) {
                totalForecastedRevenue += revenue;
                totalVat += vat;
                totalForecastedNetProfit += netProfit; // Zakat is already subtracted
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
                netProfit,
            });
        }
        
        const netProfitMargin = totalForecastedRevenue > 0 ? (totalForecastedNetProfit / totalForecastedRevenue) * 100 : 0;

        res.json({
            kpis: {
                annualRevenue: totalForecastedRevenue,
                netMargin: netProfitMargin,
                vat: totalVat,
                zakat: annualZakat,
            },
            forecastedRevenues, // Now includes all 3 scenarios
            fullReport
        });

    } catch (error) {
        console.error('Error during forecast generation:', error);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});

// --- Server Start ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});