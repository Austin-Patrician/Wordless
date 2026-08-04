# Time-Series Forecasting

Use forecasting only when the user asks for future values or a forecast is necessary for the decision.

## Prepare The Series

- Confirm the timestamp, timezone, frequency, measure, aggregation rule, and forecast horizon.
- Sort by time and detect duplicates, gaps, irregular intervals, partial periods, outliers, and structural breaks.
- Aggregate only after confirming the intended grain.
- Keep future information out of feature generation and validation.

## Evaluation

- Hold out the most recent periods or use rolling-origin backtesting.
- Compare every model with a naive baseline such as last value or seasonal naive.
- Choose metrics appropriate to the scale. Use MAE or RMSE; use MAPE only when values are safely away from zero.
- Report forecast intervals when the method supports them.
- Record the number of seasonal cycles available.

## Model Choice

Start simple. Use trend, seasonal naive, exponential smoothing, or a compact autoregressive model before more complex approaches. Add regressors only when their future values are known or separately forecast.

## Failure Conditions

Do not present a forecast as reliable when history is too short, frequency is unstable, there is no valid holdout, a structural break dominates the series, or the model does not beat the naive baseline. Provide a descriptive trend analysis instead.
