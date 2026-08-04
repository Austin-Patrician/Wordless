# Clustering And Anomaly Detection

## Clustering

Define the entity being clustered and why segmentation is useful. Exclude identifiers, outcomes unavailable at decision time, and sensitive fields unless explicitly justified.

1. Handle missing values and encode features explicitly.
2. Scale numeric features when distance is used.
3. Remove redundant or near-constant fields.
4. Compare a small range of cluster counts or density settings.
5. Evaluate silhouette or an appropriate internal metric plus stability across seeds or samples.
6. Profile clusters using original-scale features and population sizes.

Do not force a segmentation when stability or separation is weak. Cluster labels are descriptive, not objective identities.

## Anomaly Detection

Choose the method based on data shape:

- univariate stable distributions: IQR or robust z-score
- multivariate tabular data: isolation-based or robust distance methods
- time series: residual or rolling-baseline anomalies
- business rules: explicit domain thresholds

Record the score, threshold, method, comparison group, and reason each record was flagged. Quantify the flagged rate and inspect representative false positives.

Never delete, correct, or exclude anomalies automatically. Return a review set and explain that anomalous does not necessarily mean incorrect.
