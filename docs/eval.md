# Eval: bag scan

**Question:** When a user photographs a coffee bag, does the app recognise the right coffee?

## Test set

30 product photos from the coffee catalogue (`src/data/catalog-seed.json`), spread evenly across the Berlin roasters. For each photo the correct answer is already known: name, roaster, origin, processing and tasting notes from the catalogue.

## Method

[`scripts/eval-scan.ts`](../scripts/eval-scan.ts) sends each photo to the production `scan-bag` function (an OpenAI vision model returns fixed JSON), then matches the result against the catalogue exactly as the app does ([`src/lib/match.ts`](../src/lib/match.ts)).

| Metric | What counts as correct |
|---|---|
| **Recognised in catalogue** (main metric) | The scan is matched to the right catalogue coffee |
| **Wrong coffee** (must stay 0) | The scan is matched to a *different* coffee. Worse than no match, because the user gets wrong data |
| Field accuracy | Name, roaster, origin, processing and tasting notes read correctly |
| Cost and speed | Median duration and tokens per scan |

Saved runs can be re-scored offline, so a change to the matching logic can be measured on the same model answers.

## Result

| | Before | After |
|---|---|---|
| Recognised in catalogue | 47 % | **87 %** |
| Wrong coffee | 0 | **0** |

The first run showed that the model *read* the bags well, but the matching was too strict: "Aponte" did not find "Aponte Espresso", and a bag without a printed roaster never matched. After loosening the matching (all words read must appear in the catalogue name; the roast type decides between variants; without a roaster only an unambiguous match counts), the same run was re-scored: 47 % → 87 %, still zero wrong coffees.

A second eval (`scripts/eval-online.ts`) checks the online lookup for coffees not in the catalogue. It found cases where a "confident" hit was the wrong roast variant (filter bag, espresso page), which led to a stricter page check.

## Run it

The live runs need your own Supabase project with the functions deployed: set `EVAL_SUPABASE_URL` and `EVAL_SUPABASE_KEY` (its publishable key). Re-scoring a saved run needs neither.

```bash
npm run eval:scan -- 30                    # new run, 30 coffees
npm run eval:scan -- eval/scan-….json      # re-score a saved run offline
npm run eval:online -- eval/scan-….json    # online lookup for the same coffees
```
