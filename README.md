# Gharmol: Mumbai House Price and Rent Predictor

Mini project: a Flask web app that estimates the sale price and monthly rent
of a flat in the Mumbai region (MMR) using a Random Forest model.

## How to run
1. pip install -r requirements.txt
2. python train_model.py      (trains the model, creates model.pkl)
3. python app.py              (open http://127.0.0.1:5000)

## Files
- house_data.csv   dataset: 6,347 listings (price, area, location, BHK, amenities)
- train_model.py   cleans data, trains the model, prints accuracy, saves model.pkl
- app.py           Flask app: prediction, price range, rent, price-by-size curve, JSON API
- templates/index.html   page structure
- static/style.css       the design (Mumbai skyline hero, taxi-yellow on monsoon ink)
- static/app.js          live updates, search box, charts, EMI calculator, compare list

## How it works
1. Features used: area (sq ft), BHK, new/resale, number of amenities, and the
   typical price per sq ft of the chosen location.
2. The model predicts log(price) so that cheap and luxury flats are treated fairly.
3. The price range comes from the 10th-90th percentile of the 300 trees' predictions.
4. Rent = 3% of the property value per year / 12. The dataset has no rent
   column, so this is an assumption (change RENT_YIELD_PER_YEAR in app.py).

## Results on unseen test data (20% split)
R2 about 0.64, typical error about 13%.

## What the page does
- Updates live as you change anything (no submit button), via POST /api/predict.
- Locality search with keyboard support, quick-pick chips, and a data-confidence
  indicator (localities with few listings are flagged as rough).
- Price-by-size chart: hover to read, click to set the area.
- Price per sq ft ladder: click a locality to price the same flat there.
- Buy-or-rent EMI calculator, and a compare list (pin up to 4 estimates).
- The URL stores your inputs, so an estimate can be shared by copying the link.
