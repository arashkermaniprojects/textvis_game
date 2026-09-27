# Results

Offline evaluation outputs for the 15 lectures in `lectures/`. The scripts
read only the committed lecture JSON (no LLM, VLM or network access).

| File | Produced by |
|---|---|
| `noun_repetition.json` | `node tools/metric-noun-repetition.mjs --all --json results/noun_repetition.json` (window = 5 sentences) |
| `label_proximity.json` | `node tools/metric-label-proximity.mjs --all --json results/label_proximity.json` (threshold = 1.5 world units) |
| `rescale_factors.json` | `scene.rescale_factor` and `scene.max_edge_len_before_rescale` read from each `lectures/<id>/world_state.json` |

`rescale_factors.json` can be regenerated with:

```bash
python3 -c "import json,glob; print(json.dumps({f.split('/')[1]: {k: json.load(open(f))['scene'][k] for k in ('rescale_factor','max_edge_len_before_rescale')} for f in sorted(glob.glob('lectures/*/world_state.json'))}, indent=2))" > results/rescale_factors.json
```

Aggregates:

- Noun repetition: 985 sentences, 828 mentions, 173 repeated; pooled repeat
  rate 173/828 = 0.209 (unweighted per-lecture mean 0.160).
- Label proximity: 1,170 nodes, mean nearest-neighbour distance 2.61
  (unweighted mean over lectures), 603 node pairs closer than 1.5 units.
