import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns

sns.set(style="whitegrid")

# ---- Load CSV ----
df = pd.read_csv("auth_windows_1ea8d3a866aa482f951c9734e8232bd4.csv")

print("\n=== BASIC SHAPE ===")
print(df.shape)

print("\n=== WINDOW STRUCTURE ===")
print(df[["windowIndex", "windowStartMs", "windowEndMs"]])

# ---- Window sanity ----
print("\n=== WINDOW COUNT ===")
print(df["windowIndex"].value_counts().sort_index())

# ---- Missingness ----
print("\n=== MISSINGNESS (fraction) ===")
missing = df.isna().mean().sort_values(ascending=False)
print(missing)

# ---- Numeric feature distributions ----
num_cols = df.select_dtypes(include=[np.number]).columns

print("\n=== NUMERIC FEATURE SUMMARY ===")
print(df[num_cols].describe().T[["mean", "std", "min", "max"]])

# ---- Plot distributions ----
for col in [
    "typing_ikt_global_mean",
    "typing_ikt_global_p95",
    "tap_rt_mean",
    "tap_rt_p95"
]:
    if col in df.columns:
        plt.figure(figsize=(6,4))
        sns.histplot(df[col].dropna(), bins=30, kde=True)
        plt.title(col)
        plt.tight_layout()
        plt.show()