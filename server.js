// server.js
// Backend for Fin-Cast KSA - Handles all financial logic and API requests.

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
// Enable CORS for all routes to allow frontend communication
app.use(cors());
// Parse JSON request bodies
app.use(express.json());
// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));


// --- Core Financial Logic ---

/**
 * Performs a linear regression on a given set of data points.
 * @param {number[]} y - An array of historical revenue numbers.
 * @returns {{slope: number, intercept: number}} - The calculated slope and intercept for the trend line.
 */
function linearRegression(y) {
    const n = y.length;
    if (n === 0) return { slope: 0, intercept: 0 }; // Handle empty data case

    const x = Array.from({ length: n }, (_, i) => i + 1);
    let sum_x = 0, sum_y = 0, sum_xy = 0, sum_xx = 0;

    for (let i = 0; i < n; i++) {
        sum_x += x[i];
        sum_y += y[i];
        sum_xy += (x[i] * y[i]);
        sum_xx += (x[i] * x[i]);
    }

    const denominator = (n * sum_xx - sum_x * sum_x);
    if (denominator === 0) return { slope: 0, intercept: y.reduce((a, b) => a + b, 0) / n || 0 }; // Handle vertical line case

    const slope = (n * sum_xy - sum_x * sum_y) / denominator;
    const intercept = (sum_y - slope * sum_x) / n;
    
    return { slope, intercept };
}


// --- API Endpoints ---

/**
 * @route POST /api/forecast
 * @desc Takes historical data and assumptions, returns a full 24-month financial forecast.
 */
app.post('/api/forecast', (req, res) => {
    try {
        // --- Destructure and validate input from the request body ---
        const { 
            historicalRevenues,
            cogsPercent,
            applyVat,
            zakatBase,
            optimisticModifier,
            pessimisticModifier,
            expenseItems
        } = req.body;

        if (!historicalRevenues || !Array.isArray(historicalRevenues)) {
            return res.status(400).json({ error: 'historicalRevenues is required and must be an array.' });
        }
        
        // --- Calculate core assumptions ---
        const monthlyOpEx = expenseItems.reduce((sum, item) => sum + (item.value || 0), 0);
        const annualZakat = (zakatBase || 0) * 0.025;
        const cogsRate = (cogsPercent || 0) / 100;
        const optRate = 1 + ((optimisticModifier || 0) / 100);
        const pessRate = 1 + ((pessimisticModifier || 0) / 100);

        // --- Run the Machine Learning Model ---
        const model = linearRegression(historicalRevenues);

        // --- Generate Forecasted Revenue Data ---
        const forecastedRevenues = { baseline: [], optimistic: [], pessimistic: [] };
        for (let i = 1; i <= 12; i++) {
            const prediction = model.slope * (12 + i) + model.intercept;
            const baseline = prediction > 0 ? prediction : 0;
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
            const zakatForMonth = (!isHistorical && i === 23) ? annualZakat : 0; // Apply Zakat on the final forecast month
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

        // --- Send the complete response back to the frontend ---
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