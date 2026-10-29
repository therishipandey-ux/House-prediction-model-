"""
train_model.py
Trains the house price model and saves it to model.pkl

Run:  python train_model.py
"""
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import KFold, train_test_split

# ---------------------------------------------------------------
# 1. Load and clean the data
# ---------------------------------------------------------------
data = pd.read_csv("house_data.csv")
data = data.drop(columns=["Unnamed: 0"])                # useless index column
data = data.rename(columns={"sqrt": "sqft", "New/Resale": "resale"})

# every column except these is a yes/no amenity (Gymnasium, Lift, ...)
main_columns = ["price", "sqft", "location", "bhk", "resale"]
amenity_columns = [c for c in data.columns if c not in main_columns]

data["amenities"] = data[amenity_columns].sum(axis=1)   # how many amenities
data["price_per_sqft"] = data["price"] / data["sqft"]

# ---------------------------------------------------------------
# 2. Split into train and test
# ---------------------------------------------------------------
train, test = train_test_split(data, test_size=0.2, random_state=42)
train = train.copy()
test = test.copy()

# ---------------------------------------------------------------
# 3. Turn "location" (text) into a number
#    Idea: each area gets the typical price per sqft of that area.
#    Areas with very few listings are pulled towards the overall
#    average so one odd listing doesn't mislead the model.
# ---------------------------------------------------------------
overall_ppsf = train["price_per_sqft"].median()
SMOOTHING = 5


def location_table(df):
    """Returns {location: typical price per sqft}"""
    stats = df.groupby("location")["price_per_sqft"].agg(["median", "count"])
    smooth = (stats["median"] * stats["count"] + overall_ppsf * SMOOTHING) / (
        stats["count"] + SMOOTHING
    )
    return smooth.to_dict()


# For training rows we compute the number using OTHER rows only
# (5 folds). Otherwise the model would "see" the answer (price)
# of the row it is learning from.
train["location_ppsf"] = np.nan
for fit_idx, apply_idx in KFold(5, shuffle=True, random_state=1).split(train):
    table = location_table(train.iloc[fit_idx])
    values = train.iloc[apply_idx]["location"].map(table).fillna(overall_ppsf)
    train.iloc[apply_idx, train.columns.get_loc("location_ppsf")] = values.values

# Final table (all training data) is used for new predictions
location_ppsf_table = location_table(train)
test["location_ppsf"] = test["location"].map(location_ppsf_table).fillna(overall_ppsf)

# ---------------------------------------------------------------
# 4. Train the model
#    We predict log(price) because prices range from 20 lakh to 40 crore.
# ---------------------------------------------------------------
features = ["sqft", "bhk", "resale", "amenities", "location_ppsf"]

model = RandomForestRegressor(
    n_estimators=300, min_samples_leaf=2, random_state=42, n_jobs=-1
)
model.fit(train[features], np.log(train["price"]))

# ---------------------------------------------------------------
# 5. Test it
# ---------------------------------------------------------------
predicted = np.exp(model.predict(test[features]))
actual = test["price"]

mae = mean_absolute_error(actual, predicted)
r2 = r2_score(actual, predicted)
typical_error = np.median(np.abs(predicted - actual) / actual) * 100

print(f"R2 score            : {r2:.3f}")
print(f"Average error (MAE) : Rs {mae:,.0f}")
print(f"Typical error       : {typical_error:.1f}%  (median % error)")

# ---------------------------------------------------------------
# 6. Save everything the web app needs
# ---------------------------------------------------------------
area_summary = (
    data.groupby("location")
    .agg(listings=("price", "count"), avg_ppsf=("price_per_sqft", "median"))
    .round(0)
)

joblib.dump(
    {
        "model": model,
        "features": features,
        "location_ppsf_table": location_ppsf_table,
        "overall_ppsf": overall_ppsf,
        "area_summary": area_summary.to_dict("index"),
        "amenity_columns": amenity_columns,
        "metrics": {"r2": r2, "mae": mae, "typical_error": typical_error,
                    "rows": len(data)},
    },
    "model.pkl",
)
print("Model saved to model.pkl")
