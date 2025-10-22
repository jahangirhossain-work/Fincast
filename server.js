const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// --- CORE FINANCIAL LOGIC (FINAL PROFESSIONAL UPGRADE) ---

/**
 * Calculates the Mean Squared Error (MSE) between two arrays of numbers.
 * @param {number[]} actuals - The array of actual historical values.
 * @param {number[]} forecasts - The array of forecasted values for the same period.
 * @returns {number} - The calculated Mean Squared Error.
 */
function calculateMSE(actuals, forecasts) {
    let sumSqErr = 0;
    for (let i = 0; i < actuals.length; i++) {
        sumSqErr += Math.pow(actuals[i] - forecasts[i], 2);
    }
    return sumSqErr / actuals.length;
}


/**
 * Holt-Winters Exponential Smoothing Forecast.
 * A professional time-series model that accounts for level, trend, and seasonality.
 */
function holtWinters(data, forecast_length, season_length, alpha, beta, gamma) {
    if (data.length < season_length) {
        // Fallback for insufficient data
        const simple_slope = data.length > 1 ? (data[data.length - 1] - data[0]) / (data.length - 1) : 0;
        const last_value = data[data.length - 1];
        const forecast = [];
        for (let i = 1; i <= forecast_length; i++) {
            forecast.push(Math.max(0, last_value + i * simple_slope));
        }
        return { forecast, internalForecast: [] };
    }

    let level = data[0];
    let trend = 0;
    for (let i = 0; i < season_length; i++) {
        trend += (data[i+season_length] - data[i]) / season_length;
    }
    trend /= season_length;

    const seasonal = Array.from({ length: season_length }, (_, i) => data[i] / (level || 1));
    const internalForecast = [];
    
    data.forEach((value, i) => {
        const last_level = level;
        const last_trend = trend;
        const last_seasonal = i < season_length ? seasonal[i] : seasonal[i % season_length];

        level = alpha * (value / (last_seasonal || 1)) + (1 - alpha) * (last_level + last_trend);
        trend = beta * (level - last_level) + (1 - beta) * last_trend;
        seasonal[i % season_length] = gamma * (value / (level || 1)) + (1 - gamma) * last_seasonal;

        internalForecast.push((last_level + last_trend) * last_seasonal);
    });
    
    const forecast = [];
    for (let i = 0; i < forecast_length; i++) {
        const season_index = (data.length + i) % season_length;
        const forecasted_value = (level + (i + 1) * trend) * seasonal[season_index];
        forecast.push(Math.max(0, forecasted_value));
    }

    return { forecast, internalForecast };
}

/**
 * Finds the optimal alpha, beta, and gamma parameters for the Holt-Winters model
 * by performing a grid search and minimizing Mean Squared Error (MSE).
 * @param {number[]} data - The historical data series.
 * @returns {number[]} - The final, most accurate forecast.
 */
function findOptimalHoltWinters(data) {
    const forecast_length = 12;
    const season_length = 12;
    
    // Fallback for short data series where optimization isn't feasible
    if (data.length < season_length * 2) {
        console.log("Data too short for optimization, using default Holt-Winters.");
        return holtWinters(data, forecast_length, season_length, 0.5, 0.5, 0.5).forecast;
    }

    let bestParams = { alpha: 0.5, beta: 0.5, gamma: 0.5 };
    let minMSE = Infinity;

    const paramValues = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

    // Grid search to find the best parameters
    for (const alpha of paramValues) {
        for (const beta of paramValues) {
            for (const gamma of paramValues) {
                const { internalForecast } = holtWinters(data, forecast_length, season_length, alpha, beta, gamma);
                const mse = calculateMSE(data, internalForecast);

                if (mse < minMSE) {
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
        
        // 1. Generate the most accurate baseline forecast using the self-optimizing model
        // Note: The Holt-Winters function now requires 24 months of data for proper optimization.
        // We will simulate this by using the 12 months twice for this demonstration.
        // In a real system, you would require 24 months of historical input.
        const optimizationData = [...historicalRevenues, ...historicalRevenues];
        const baselineForecast = findOptimalHoltWinters(optimizationData);
        
        // 2. Create optimistic and pessimistic scenarios
        const forecastedRevenues = {
            baseline: baselineForecast,
            optimistic: baselineForecast.map(val => val * (1 + (optimisticModifier / 100))),
            pessimistic: baselineForecast.map(val => val * (1 + (pessimisticModifier / 100)))
        };

        // 3. Generate Full P&L Report
        const monthlyOpEx = expenseItems.reduce((sum, item) => sum + item.value, 0);
        const annualZakat = zakatBase * 0.025;
        const fullReport = [];
        let totalForecastedRevenue = 0, totalForecastedNetProfit = 0, totalVat = 0;
        const allRevenues = [...historicalRevenues, ...baselineForecast];

        for (let i = 0; i < 24; i++) {
            const isHistorical = i < 12;
            const revenue = allRevenues[i];
            const cogs = revenue * (cogsPercent / 100);
            const grossProfit = revenue - cogs;
            const vat = applyVat ? revenue * 0.15 : 0;
            const zakatForMonth = (!isHistorical && i === 23) ? annualZakat : 0;
            const netProfit = grossProfit - monthlyOpEx - vat - zakatForMonth;

            if (!isHistorical) {
                totalForecastedRevenue += revenue;
                totalVat += vat;
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
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});