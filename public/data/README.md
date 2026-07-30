# `indonesia-provinces.json`

Province-level boundary shapes for the Overview tab's investor-distribution
choropleth (rendered with `chartjs-chart-geo`).

## What it is

- A `FeatureCollection` of 34 province polygons. Each feature's `properties`
  has exactly `{ province_code, province_name }` — `province_name` is the
  literal string used by `sayakaya.main.geo.province_name` in BigQuery
  (see `usersByProvince()` in `server/queries.js`), so the frontend matches
  chart data to shapes with a plain string lookup, no alias table.
- Source boundaries: [yusufsyaifudin/wilayah-indonesia](https://github.com/yusufsyaifudin/wilayah-indonesia)
  (`data/geojson/province/<BPS 2-digit code>.geojson`), which uses the modern
  BPS/Kemendagri province codes — the same codes `main.geo.city_province_code`
  uses. 34 of the 37 provinces in our data have a shape there; missing:
  Papua Barat (92), Papua Selatan (93), Papua Pegunungan (95) — all created in
  2022 and together well under 0.1% of investors, so they just don't render
  a shape (still counted correctly everywhere else, e.g. the top-cities list).
- The raw per-province files are ~65MB combined (full-resolution). Simplified
  with `mapshaper` (`-simplify visvalingam 2% keep-shapes -clean`) down to
  ~650KB total — a good detail/size tradeoff; visually still clearly Indonesia
  at dashboard scale.

## The one gotcha if you ever regenerate this

**Must export with `gj2008` winding, not the RFC7946 default.** `d3-geo`
(which `chartjs-chart-geo` uses) treats ring winding as *spherical*, and
expects the opposite orientation from the GeoJSON spec (RFC7946 requires
CCW exterior rings; d3-geo wants CW). Exporting with mapshaper's RFC7946
default (or any other tool that outputs spec-compliant CCW rings) produces
geometrically "valid" GeoJSON that nonetheless renders as a solid rectangle
covering the entire chart — d3-geo reads the mis-wound ring as enclosing
"the rest of the sphere" instead of the small region it's supposed to bound.
Confirmed both in raw `d3-geo` and through `chartjs-chart-geo` directly.

Regenerate with:

```
mapshaper merged-raw.json \
  -simplify visvalingam 2% keep-shapes \
  -clean \
  -o format=geojson precision=0.001 gj2008 indonesia-provinces.json
```

where `merged-raw.json` is the 34 per-province files merged into one
FeatureCollection with `province_code`/`province_name` properties injected
(code -> name mapping is the BPS table also duplicated in `usersByProvince()`).
