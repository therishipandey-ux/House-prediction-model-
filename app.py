"""
app.py
Flask web app: Mumbai House Price and Rent Predictor

Run:  python app.py      then open http://127.0.0.1:5000

The page updates live: the browser sends the form values to /api/predict
every time something changes and redraws the result.
"""
import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

# ---------------------------------------------------------------
# Load the trained model (created by train_model.py)
# ---------------------------------------------------------------
saved = joblib.load("model.pkl")
model = saved["model"]
features = saved["features"]
location_ppsf_table = saved["location_ppsf_table"]
overall_ppsf = saved["overall_ppsf"]
area_summary = saved["area_summary"]
amenity_columns = saved["amenity_columns"]
metrics = saved["metrics"]

# Our dataset only has SALE prices, so rent is an ESTIMATE:
# yearly rent = about 3% of the property value (typical for Mumbai).
RENT_YIELD_PER_YEAR = 0.03


# ---------------------------------------------------------------
# Locality data used by the page (search box, charts)
# ---------------------------------------------------------------
def confidence_for(listings):
    """More listings in an area = a more trustworthy estimate."""
    if listings >= 50:
        return "high"
    if listings >= 10:
        return "medium"
    return "low"


locations = sorted(
    (
        {
            "name": name,
            "listings": int(info["listings"]),
            "ppsf": int(info["avg_ppsf"]),
            "confidence": confidence_for(info["listings"]),
        }
        for name, info in area_summary.items()
    ),
    key=lambda x: x["name"].lower(),
)

# the busiest areas: used for the quick-pick chips and the comparison chart
popular = [l["name"] for l in sorted(locations, key=lambda x: -x["listings"])[:12]]


# ---------------------------------------------------------------
# Prediction
# ---------------------------------------------------------------
def make_rows(location, sqft_values, bhk, resale, n_amenities):
    """Builds model input rows (one per sqft value) for one location."""
    ppsf = location_ppsf_table.get(location, overall_ppsf)
    return pd.DataFrame(
        [[s, bhk, resale, n_amenities, ppsf] for s in sqft_values],
        columns=features,
    )


def smooth_curve(values):
    """A bigger flat should not cost less, so we remove the small dips that a
    forest of trees produces, then average neighbours for a calm line.
    (Only used for the chart; the headline price comes straight from the model.)"""
    values = np.maximum.accumulate(np.asarray(values, dtype=float))
    padded = np.pad(values, 2, mode="edge")
    return np.convolve(padded, np.ones(5) / 5, mode="valid")


def predict(location, sqft, bhk, resale, amenities):
    """Returns price, rent, the likely range and a price-vs-size curve."""
    n = len(amenities)
    row = make_rows(location, [sqft], bhk, resale, n)

    price = float(np.exp(model.predict(row)[0]))

    # Range: each tree in the forest gives its own guess.
    # We take the 10th and 90th percentile of those guesses.
    guesses = np.exp([tree.predict(row.values)[0] for tree in model.estimators_])
    low = min(float(np.percentile(guesses, 10)), price)
    high = max(float(np.percentile(guesses, 90)), price)

    # Price curve: same flat, but with different sizes (for the chart)
    curve_sqft = list(np.linspace(300, 3000, 28).round())
    curve_price = np.exp(model.predict(make_rows(location, curve_sqft, bhk, resale, n)))
    curve_price = smooth_curve(curve_price)

    # How much do amenities matter for this flat? (none vs all of them)
    bare = float(np.exp(model.predict(make_rows(location, [sqft], bhk, resale, 0))[0]))
    full = float(np.exp(model.predict(
        make_rows(location, [sqft], bhk, resale, len(amenity_columns)))[0]))

    return {
        "price": price,
        "low": low,
        "high": high,
        "rent": price * RENT_YIELD_PER_YEAR / 12,
        "rent_low": low * RENT_YIELD_PER_YEAR / 12,
        "rent_high": high * RENT_YIELD_PER_YEAR / 12,
        "price_per_sqft": price / sqft,
        "curve": [[float(s), float(p)] for s, p in zip(curve_sqft, curve_price)],
        "amenity_bare": bare,
        "amenity_full": full,
    }


class JsonForm(dict):
    """Lets read_inputs() work with JSON data the same way as with a form."""
    def getlist(self, key):
        value = self.get(key, [])
        return value if isinstance(value, list) else [value]


def read_inputs(form):
    """Reads and checks the inputs. Returns (values, error_message)."""
    location = str(form.get("location", "")).strip()
    if location not in area_summary:
        return None, "Choose a location from the list."

    try:
        sqft = float(form.get("sqft", ""))
        bhk = int(form.get("bhk", ""))
    except (TypeError, ValueError):
        return None, "Area and BHK must be numbers."

    if not 200 <= sqft <= 8000:
        return None, "Area must be between 200 and 8,000 sq ft."
    if not 1 <= bhk <= 7:
        return None, "BHK must be between 1 and 7."

    resale = 1 if str(form.get("resale")) == "1" else 0
    chosen = [a for a in form.getlist("amenity") if a in amenity_columns]

    return {"location": location, "sqft": sqft, "bhk": bhk,
            "resale": resale, "amenities": chosen}, None


# ---------------------------------------------------------------
# Pages
# ---------------------------------------------------------------
@app.route("/")
def home():
    return render_template(
        "index.html",
        bootstrap={
            "locations": locations,
            "popular": popular,
            "amenities": amenity_columns,
            "rentYield": RENT_YIELD_PER_YEAR,
            "metrics": {
                "rows": int(metrics["rows"]),
                "typicalError": round(float(metrics["typical_error"])),
                "r2": round(float(metrics["r2"]), 2),
            },
        },
        metrics=metrics,
        n_locations=len(locations),
    )


@app.route("/api/predict", methods=["POST"])
def api_predict():
    """Prediction as JSON. Example body:
    {"location": "Powai", "sqft": 750, "bhk": 2, "resale": 0, "amenity": ["Lift Available"]}
    """
    body = request.get_json(silent=True) or {}
    values, error = read_inputs(JsonForm(body))
    if error:
        return jsonify({"error": error}), 400

    p = predict(values["location"], values["sqft"], values["bhk"],
                values["resale"], values["amenities"])
    area = area_summary[values["location"]]

    return jsonify({
        "price": round(p["price"]),
        "low": round(p["low"]),
        "high": round(p["high"]),
        "rent": round(p["rent"]),
        "rent_low": round(p["rent_low"]),
        "rent_high": round(p["rent_high"]),
        "price_per_sqft": round(p["price_per_sqft"]),
        "curve": p["curve"],
        "amenity_bare": round(p["amenity_bare"]),
        "amenity_full": round(p["amenity_full"]),
        "area": {
            "name": values["location"],
            "ppsf": int(area["avg_ppsf"]),
            "listings": int(area["listings"]),
            "confidence": confidence_for(area["listings"]),
        },
    })


if __name__ == "__main__":
    app.run(debug=True)
