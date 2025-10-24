// This is your server.js logic, modified to run on Vercel
const express = require('express');
const cors = require('cors');
// const path = require('path'); // Not needed on Vercel serverless

const app = express();
// const PORT = process.env.PORT || 3000; // Not needed, Vercel handles port

// --- Middleware ---
app.use(cors());
app.use(express.json());
// app.use(express.static(path.join(__dirname, 'public'))); // Not needed

// --- CORE FINANCIAL LOGIC (FINAL PROFESSIONAL UPGRADE) ---
// (All your functions: calculateMSE, holtWinters, findOptimalHoltWinters)
// ...
/**
 * Calculates the Mean Squared Error (MSE) between two arrays of numbers.
 * @param {number[]} actuals - The array of actual historical values.
 * @param {number[]} forecasts - The array of forecasted values for the same period.
 * @returns {number} - The calculated Mean Squared Error.
 */
function calculateMSE(actuals, forecasts) {
    let sumSqErr = 0;
    for (let i = 0; i < actuals.length; i++) {
        // Ensure values are numbers to avoid NaN issues
        const actual = Number(actuals[i]) || 0;
        const forecast = Number(forecasts[i]) || 0;
        sumSqErr += Math.pow(actual - forecast, 2);
    }
    return sumSqErr / actuals.length;
}


/**
 * Holt-Winters Exponential Smoothing Forecast.
 * A professional time-series model that accounts for level, trend, and seasonality.
 */
function holtWinters(data, forecast_length, season_length, alpha, beta, gamma) {
    if (data.length < season_length * 2) {
        // Fallback for insufficient data: Linear regression
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        const n = data.length;
        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += data[i];
            sumXY += i * data[i];
            sumX2 += i * i;
        }
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) || 0;
        const intercept = (sumY - slope * sumX) / n || data[n - 1] || 0;
        
        const forecast = [];
        for (let i = 0; i < forecast_length; i++) {
            forecast.push(Math.max(0, intercept + slope * (n + i)));
        }
        return { forecast, internalForecast: [] };
    }

    let level = data[0];
    let trend = 0;
    // Calculate initial trend
    for (let i = 0; i < season_length; i++) {
        trend += (data[i + season_length] - data[i]) / season_length;
    }
    trend /= season_length;

    // Calculate initial seasonal components
    const seasonal = Array.from({ length: season_length });
    const seasonAverages = Array(season_length).fill(0);
    const "n_seasons" = Math.floor(data.length / season_length);
    for (let i = 0; i < "n_seasons"; i++) {
        for (let j = 0; j < season_length; j++) {
            seasonAverages[j] += data[i * season_length + j];
        }
    }
    for (let i = 0; i < season_length; i++) {
        seasonal[i] = seasonAverages[i] / ("n_seasons" * level) || 1;
    }

    const internalForecast = [];
    
    data.forEach((value, i) => {
        const last_level = level;
        const last_trend = trend;
        
        const season_index = i % season_length;
        const last_seasonal = seasonal[season_index];

        level = alpha * (value / last_seasonal) + (1 - alpha) * (last_level + last_trend);
        trend = beta * (level - last_level) + (1 - beta) * last_trend;
        seasonal[season_index] = gamma * (value / level) + (1 - gamma) * last_seasonal;

        // Use last_level, last_trend, last_seasonal for internal forecast
        internalForecast.push(Math.max(0, (last_level + last_trend) * last_seasonal));
    });
    
    const forecast = [];
    let lastLevel = level;
    let lastTrend = trend;
    
    for (let i = 0; i < forecast_length; i++) {
        const season_index = (data.length + i) % season_length;
        const forecasted_value = (lastLevel + (i + 1) * lastTrend) * seasonal[season_index];
        forecast.push(Math.max(0, forecasted_value));
    }

    return { forecast, internalForecast };
}

/**
 * Finds the optimal alpha, beta, and gamma parameters for the Holt-Winters model
 * by performing a grid search and minimizing Mean SquaredError (MSE).
 * @param {number[]} data - The historical data series (requires at least 2 full seasons).
 * @returns {number[]} - The final, most accurate forecast.
 */
function findOptimalHoltWinters(data) {
    const forecast_length = 12;
    const season_length = 12; // 12 months
    
    // Fallback for short data series where optimization isn't feasible
    if (data.length < season_length * 2) {
        console.log("Data too short for optimization, using default Holt-Winters.");
        return holtWinters(data, forecast_length, season_length, 0.5, 0.3, 0.2).forecast;
    }

    let bestParams = { alpha: 0.5, beta: 0.3, gamma: 0.2 };
    let minMSE = Infinity;

    // Grid search with fewer, more strategic values
    const paramValues = [0.1, 0.3, 0.6, 0.9];

    for (const alpha of paramValues) {
        for (const beta of paramValues) {
            for (const gamma of paramValues) {
                const { internalForecast } = holtWinters(data, forecast_length, season_length, alpha, beta, gamma);
                const mse = calculateMSE(data, internalForecast);

                if (isFinite(mse) && mse < minMSE) {
                    minMSE = mse;
                    bestParams = { alpha, beta, gamma };
                }
            }
        }
    }
    
    console.log("Optimal Parameters Found:", bestParams, "with MSE:", minMSE);

    // Return the forecast using the best parameters found
    return holtWinters(data, forecast_length, season_length, bestParams.alpha, bestParams.beta, bestParams.gamma).forecast;
}
// ... (Your /api/forecast endpoint is identical)

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

        if (!historicalRevenues || historicalRevenues.length !== 12 || historicalRevenues.some(r => r === 0)) {
            return res.status(400).json({ error: '12 months of non-zero historical revenue data are required.' });
        }
        
        // 1. Generate the most accurate baseline forecast using the self-optimizing model
        // We use the 12 months of data twice to provide the 24 months needed for optimization.
        const optimizationData = [...historicalRevenues, ...historicalRevenues];
        const baselineForecast = findOptimalHoltWinters(optimizationData);
        
        // 2. Create optimistic and pessimistic scenarios
        const forecastedRevenues = {
            baseline: baselineForecast,
            optimistic: baselineForecast.map(val => val * (1 + (optimisticModifier / 100))),
            pessimistic: baselineForecast.map(val => val * (1 + (pessimisticModifier / 100)))
        };

        // 3. Generate Full P&L Report
        const monthlyOpEx = expenseItems.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
        const annualZakat = (Number(zakatBase) || 0) * 0.025;
        const fullReport = [];
        let totalForecastedRevenue = 0, totalForecastedNetProfit = 0, totalVat = 0;
        const allRevenues = [...historicalRevenues, ...baselineForecast];

        for (let i = 0; i < 24; i++) {
            const isHistorical = i < 12;
            const revenue = allRevenues[i];
            const cogs = revenue * ((Number(cogsPercent) || 0) / 100);
            const grossProfit = revenue - cogs;
            
            // Taxes/Expenses apply differently to historical vs. forecast
            let vatOnRevenue = 0;
            let zakatForMonth = 0;
            let netProfit = 0;
            
            if (isHistorical) {
                // For historical, we just show revenue and gross profit.
                // We don't know what OpEx or taxes *were* paid.
                netProfit = grossProfit - monthlyOpEx; // Show net profit based on *current* OpEx for comparison
            } else {
                // For forecast, apply all assumptions
                if (applyVat) {
                    vatOnRevenue = revenue * 0.15;
                }
                // Apply Zakat on the last month of the forecast
                if (i === 23) {
                    zakatForMonth = annualZakat;
                }
                
                netProfit = grossProfit - monthlyOpEx - vatOnRevenue - zakatForMonth;

                // Accumulate totals
                totalForecastedRevenue += revenue;
                totalVat += vatOnRevenue;
                totalForecastedNetProfit += netProfit;
            }

            fullReport.push({ monthIndex: i, isHistorical, revenue, grossProfit, netProfit });
        }
        
        const netProfitMargin = totalForecastedRevenue > 0 ? (totalForecastedNetProfit / totalForecastedRevenue) * 100 : 0;

        res.json({
            kpis: {
                annualRevenue: totalForecastedRevenue,
                netMargin: netProfitMargin,
                vat: totalVat,
                zakat: annualZakat,
            },
            forecastedRevenues,
            fullReport
        });

    } catch (error) {
        console.error('Error during forecast generation:', error);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});


// --- Server Start ---
// app.listen(PORT, () => { // **REMOVE THIS**
//     console.log(`Server is running on http://localhost:${PORT}`);
// });

// **ADD THIS**: Export the app for Vercel
module.exports = app;