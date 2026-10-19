/**
 * Re-download the saved price history, block, and heartbeat the app
 * ships with. Optional. The committed fixtures are what a TestFlight
 * build uses until this is run and the result is committed.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "fixtures");

const jobs = [
  ["https://galaxymind.space/api/history?tickers=BTC&days=1825", "btc-history.json"],
  ["https://galaxymind.space/api/chop-block", "chop-block.json"],
  ["https://galaxymind.space/api/heartbeat", "heartbeat.json"],
];

async function main() {
  await fs.mkdir(out, { recursive: true });
  for (const [url, name] of jobs) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    const json = await res.json();
    if (name === "btc-history.json") {
      const pts = json.series?.find((s) => s.ticker === "BTC")?.points;
      if (!pts || pts.length < 30) throw new Error("history too shallow");
    }
    if (name === "chop-block.json" && !(json.ok && json.tip)) throw new Error("chop-block missing tip");
    if (name === "heartbeat.json") json.offlineSnapshot = true;
    if (name === "chop-block.json") {
      json.offlineSnapshot = true;
      json.asOf = new Date().toISOString().slice(0, 10);
    }
    await fs.writeFile(path.join(out, name), JSON.stringify(json));
    console.log("wrote", name);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
