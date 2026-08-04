# Hypothesis Testing And Regression

## Hypothesis Tests

Define the null hypothesis, alternative, outcome, groups, pairing, significance level, and minimum useful effect before selecting a test.

- Two independent numeric groups: Welch's t-test when assumptions are reasonable; otherwise use a robust or permutation alternative.
- Paired numeric observations: paired test with verified pairing keys.
- Categorical outcomes: chi-square only when expected counts are adequate; otherwise use an exact alternative.
- More than two groups: use an omnibus test before post-hoc comparisons.

Report sample sizes, descriptive statistics, effect size, confidence interval, test statistic, p-value, assumptions, and multiple-comparison correction. Never reduce the conclusion to `significant` or `not significant`.

## Regression

First state whether the goal is explanation or prediction. Define target, features, observation grain, exclusions, and evaluation design.

Required checks:

- missingness and encoding strategy
- target leakage and post-outcome fields
- train/test separation for predictive work
- scaling where model geometry requires it
- multicollinearity and unstable coefficients
- residual shape, heteroskedasticity, and influential observations
- appropriate model family for target type

For explanatory regression, report coefficients, uncertainty, diagnostics, and sensitivity to reasonable specifications. For predictive regression, compare against a simple baseline and report held-out metrics. Do not describe coefficients as causal effects.

## Failure Conditions

Decline or narrow the analysis when sample size is inadequate, groups are not comparable, pairing is invalid, leakage cannot be removed, or diagnostics show the model is not useful.
