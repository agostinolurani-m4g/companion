#!/usr/bin/env bash
# Rilievo pre-calcolato sul corridoio (issue #1). Lanciato da scripts/relief/build-relief.ts
# (GDAL nativo o container ghcr.io/osgeo/gdal), dalla root di hmr-companion.
#
#   build-relief.sh <ulx> <uly> <lrx> <lry> <source_zoom> <out_minzoom> <out_maxzoom>
#
# ulx/uly/lrx/lry: estremi EPSG:3857 (metri). Input: data/relief/corridor.geojson (celle WGS84).
# Output: public/relief/hmr-relief.pmtiles (PNG RGBA "solo ombra", trasparente fuori corridoio).
set -euo pipefail

ULX=$1 ULY=$2 LRX=$3 LRY=$4 SRCZ=$5 MINZ=$6 MAXZ=$7
WORK=data/relief/work
OUT=public/relief
PMTILES_VERSION=1.31.2
mkdir -p "$WORK/cache" "$OUT"

# Mapterhorn risponde lento (handshake TLS di parecchi secondi) e a volte chiude la connessione:
# retry con backoff invece di fallire sul primo blocco. La cache WMS rende i rilanci incrementali.
export GDAL_HTTP_MAX_RETRY=8 GDAL_HTTP_RETRY_DELAY=3 GDAL_HTTP_TIMEOUT=90 GDAL_HTTP_CONNECTTIMEOUT=45
export GDAL_HTTP_RETRY_CODES=ALL

# Colore dell'ombra (#2b3446, come l'hillshade runtime) e curva di opacità.
SHADE_R=43 SHADE_G=52 SHADE_B=70
FLAT=180      # valore hillshade di un pendio piatto (multidirezionale, altitudine 45°)
GAIN=1.7      # quanto scurisce per ogni unità sotto FLAT
MAX_ALPHA=215 # opacità massima delle ombre più profonde

# ── CLI pmtiles (go-pmtiles) ──
PMTILES=$(command -v pmtiles || true)
if [ -z "$PMTILES" ]; then
  PMTILES="$WORK/bin/pmtiles"
  if [ ! -x "$PMTILES" ]; then
    mkdir -p "$WORK/bin"
    case "$(uname -m)" in
      x86_64|amd64) ARCH=x86_64 ;;
      aarch64|arm64) ARCH=arm64 ;;
      *) echo "[relief] architettura non supportata: $(uname -m)" >&2; exit 1 ;;
    esac
    echo "[relief] scarico go-pmtiles $PMTILES_VERSION ($ARCH)"
    curl -fsSL "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_${ARCH}.tar.gz" \
      | tar -xz -C "$WORK/bin" pmtiles
    chmod +x "$PMTILES"
  fi
fi

RES=$(python3 -c "print(40075016.685578488 / (512 * 2 ** $SRCZ))")
RES_LO=$(python3 -c "print(2 * $RES)")

# ── 1. DEM Mapterhorn (terrarium webp, z$SRCZ) → RGB GeoTIFF sul bbox ──
cat > "$WORK/mapterhorn.xml" <<'EOF'
<GDAL_WMS>
  <Service name="TMS"><ServerUrl>https://tiles.mapterhorn.com/${z}/${x}/${y}.webp</ServerUrl></Service>
  <DataWindow>
    <UpperLeftX>-20037508.342789244</UpperLeftX><UpperLeftY>20037508.342789244</UpperLeftY>
    <LowerRightX>20037508.342789244</LowerRightX><LowerRightY>-20037508.342789244</LowerRightY>
    <TileLevel>__SRCZ__</TileLevel><TileCountX>1</TileCountX><TileCountY>1</TileCountY><YOrigin>top</YOrigin>
  </DataWindow>
  <Projection>EPSG:3857</Projection>
  <BlockSizeX>512</BlockSizeX><BlockSizeY>512</BlockSizeY>
  <BandsCount>3</BandsCount>
  <MaxConnections>4</MaxConnections>
  <Timeout>90</Timeout>
  <ZeroBlockHttpCodes>204,404</ZeroBlockHttpCodes>
  <Cache><Path>__CACHE__</Path></Cache>
  <UserAgent>hmr-companion-relief (GDAL)</UserAgent>
</GDAL_WMS>
EOF
sed -i "s|__SRCZ__|$SRCZ|; s|__CACHE__|$WORK/cache|" "$WORK/mapterhorn.xml"

GTIFF_CO=(-co TILED=YES -co COMPRESS=DEFLATE -co BIGTIFF=IF_SAFER)
echo "[relief] 1/6 download DEM z$SRCZ"
gdal_translate -q -projwin "$ULX" "$ULY" "$LRX" "$LRY" "${GTIFF_CO[@]}" "$WORK/mapterhorn.xml" "$WORK/rgb.tif"

# ── 2. Decodifica terrarium → quota (m) ──
echo "[relief] 2/6 decodifica terrarium"
gdal_calc --quiet --overwrite --type=Float32 \
  -A "$WORK/rgb.tif" --A_band=1 -B "$WORK/rgb.tif" --B_band=2 -C "$WORK/rgb.tif" --C_band=3 \
  --calc="A.astype(numpy.float32) * 256 + B + C / 256.0 - 32768" \
  --co TILED=YES --co COMPRESS=DEFLATE --outfile="$WORK/dem.tif"

# ── 3. Generalizzazione leggera (meno rumore Copernicus, forme più "disegnate") ──
echo "[relief] 3/6 generalizzazione"
gdalwarp -q -overwrite -r average -tr "$RES_LO" "$RES_LO" "${GTIFF_CO[@]}" "$WORK/dem.tif" "$WORK/dem_lo.tif"
gdalwarp -q -overwrite -r cubicspline -tr "$RES" "$RES" -te "$ULX" "$LRY" "$LRX" "$ULY" "${GTIFF_CO[@]}" \
  "$WORK/dem_lo.tif" "$WORK/dem_s.tif"

# ── 4. Ombreggiatura multidirezionale ──
echo "[relief] 4/6 gdaldem hillshade -multidirectional"
gdaldem hillshade -q -multidirectional -compute_edges -z 1.6 "${GTIFF_CO[@]}" "$WORK/dem_s.tif" "$WORK/hs.tif"

# ── 5. RGBA "solo ombra", mascherato sul corridoio ──
echo "[relief] 5/6 maschera corridoio + RGBA"
ogr2ogr -overwrite -t_srs EPSG:3857 "$WORK/corridor3857.geojson" data/relief/corridor.geojson
gdal_calc --quiet --overwrite --type=Byte --hideNoData -A "$WORK/hs.tif" --calc="A * 0" \
  --co TILED=YES --co COMPRESS=DEFLATE --outfile="$WORK/mask.tif"
gdal_rasterize -q -burn 255 "$WORK/corridor3857.geojson" "$WORK/mask.tif"
gdal_calc --quiet --overwrite --type=Byte --hideNoData -A "$WORK/hs.tif" -B "$WORK/mask.tif" \
  --calc="numpy.clip(($FLAT - A.astype(numpy.float32)) * $GAIN, 0, $MAX_ALPHA) * (B / 255.0)" \
  --co TILED=YES --co COMPRESS=DEFLATE --outfile="$WORK/alpha.tif"
for c in R G B; do
  v_name="SHADE_$c"
  gdal_calc --quiet --overwrite --type=Byte --hideNoData -A "$WORK/mask.tif" --calc="A * 0 + ${!v_name}" \
    --co TILED=YES --co COMPRESS=DEFLATE --outfile="$WORK/band_$c.tif"
done
gdalbuildvrt -q -overwrite -separate "$WORK/rgba.vrt" \
  "$WORK/band_R.tif" "$WORK/band_G.tif" "$WORK/band_B.tif" "$WORK/alpha.tif"

# ── 6. MBTiles (z$MAXZ nativo + overview fino a z$MINZ) → PMTiles ──
echo "[relief] 6/6 tiling z$MINZ–$MAXZ → PMTiles"
rm -f "$WORK/relief.mbtiles"
gdal_translate -q -of MBTILES -colorinterp red,green,blue,alpha \
  -co TILE_FORMAT=PNG -co ZOOM_LEVEL_STRATEGY=AUTO -co NAME=hmr-relief \
  "$WORK/rgba.vrt" "$WORK/relief.mbtiles"
LEVELS=()
f=2
for ((z = MAXZ - 1; z >= MINZ; z--)); do LEVELS+=("$f"); f=$((f * 2)); done
if [ ${#LEVELS[@]} -gt 0 ]; then gdaladdo -q -r average "$WORK/relief.mbtiles" "${LEVELS[@]}"; fi
rm -f "$OUT/hmr-relief.pmtiles"
"$PMTILES" convert "$WORK/relief.mbtiles" "$OUT/hmr-relief.pmtiles"
"$PMTILES" show "$OUT/hmr-relief.pmtiles" | head -20
