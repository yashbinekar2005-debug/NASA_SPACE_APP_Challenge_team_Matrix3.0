/** Parse the official MCD ASCII point-series format without inventing values. */
export function parseMcdSeries(text) {
  const fields = {};
  const headers = [...String(text).matchAll(/^### Column 2 is (.+)$/gm)];
  for (let index = 0; index < headers.length; index += 1) {
    const start = headers[index].index + headers[index][0].length;
    const end = headers[index + 1]?.index ?? text.length;
    const rows = text.slice(start, end).matchAll(/^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/gim);
    fields[headers[index][1].trim()] = [...rows]
      .map((row) => ({ coordinate: Number(row[1]), value: Number(row[2]) }))
      .filter((row) => Number.isFinite(row.coordinate) && Number.isFinite(row.value));
  }
  return fields;
}

export function summarizeMcdSeries(series, labelPattern, minimumSamples = 12) {
  const label = Object.keys(series || {}).find((name) => labelPattern.test(name));
  const values = (label ? series[label] : []).map((row) => row.value).filter(Number.isFinite);
  if (values.length < minimumSamples) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const spread = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  return { mean, spread, count: values.length };
}
