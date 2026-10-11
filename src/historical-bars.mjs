import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-content-address-engineering-services-section/semantic-content-identity";

const identified = (value) => Object.freeze({ id: identifyJsonSemanticContent({ objectKind: "brokerage.alpaca-market-data-read.record", value, witnessRoot: EMPTY_WITNESS_ROOT }).id, ...value });

const ORIGIN = "https://data.alpaca.markets";
const secretKey = /^(?:authorization|api[-_]?key(?:[-_]?id)?|api[-_]?secret(?:[-_]?key)?|secret|token|password|private[-_]?key)$/iu;
const scrub = (value, seen = new Set()) => !value || typeof value !== "object"
  ? value
  : seen.has(value)
    ? null
    : (seen.add(value), Array.isArray(value)
      ? value.map((member) => scrub(member, seen))
      : Object.fromEntries(Object.entries(value)
        .filter(([key]) => !secretKey.test(key))
        .map(([key, member]) => [key, scrub(member, seen)])));
const required = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label}-required`);
  return value;
};

export function createAlpacaHistoricalBarsService(env = process.env, {
  fetchImpl = fetch,
  recordObservation,
  now = () => new Date().toISOString(),
} = {}) {
  const apiKey = required(
    env.ALPACA_ACCOUNT_ESTHER_PAPER_TRADING_KEY,
    "ALPACA_ACCOUNT_ESTHER_PAPER_TRADING_KEY",
  );
  const apiSecret = required(
    env.ALPACA_ACCOUNT_ESTHER_PAPER_TRADING_SECRET,
    "ALPACA_ACCOUNT_ESTHER_PAPER_TRADING_SECRET",
  );
  if (typeof fetchImpl !== "function" || typeof recordObservation !== "function") {
    throw new TypeError("market-data-transport-and-recorder-required");
  }
  const readDailyBars = async ({
    symbols = ["BLK", "SPY"],
    start,
    end = now(),
    feed = "iex",
    adjustment = "all",
  } = {}) => {
    if (
      !Array.isArray(symbols) ||
      symbols.length < 1 ||
      symbols.some((symbol) => !/^[A-Z][A-Z.-]{0,9}$/u.test(symbol)) ||
      !Number.isFinite(Date.parse(start)) ||
      !Number.isFinite(Date.parse(end)) ||
      Date.parse(start) >= Date.parse(end) ||
      !["iex", "sip"].includes(feed) ||
      !["raw", "split", "dividend", "all"].includes(adjustment)
    ) throw new TypeError("historical-bars-request-invalid");
    const url = new URL("/v2/stocks/bars", ORIGIN);
    url.searchParams.set("symbols", [...new Set(symbols)].sort().join(","));
    url.searchParams.set("timeframe", "1Day");
    url.searchParams.set("start", new Date(start).toISOString());
    url.searchParams.set("end", new Date(end).toISOString());
    url.searchParams.set("limit", "10000");
    url.searchParams.set("adjustment", adjustment);
    url.searchParams.set("feed", feed);
    if (url.origin !== ORIGIN || url.protocol !== "https:") {
      throw new TypeError("market-data-origin-refused");
    }
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        "APCA-API-KEY-ID": apiKey,
        "APCA-API-SECRET-KEY": apiSecret,
        Accept: "application/json",
      },
    });
    if (!response.ok) throw new Error(`alpaca-market-data-refused:${response.status}`);
    const payload = await response.json();
    const bars = Object.fromEntries(symbols.map((symbol) => [
      symbol,
      (payload?.bars?.[symbol] ?? []).map((bar) => Object.freeze({
        at: new Date(bar.t).toISOString(),
        close: Number(bar.c),
        volume: Number(bar.v),
        tradeCount: Number(bar.n),
        vwap: Number(bar.vw),
      })),
    ]));
    if (symbols.some((symbol) => bars[symbol].length === 0 ||
      bars[symbol].some((bar) => !Number.isFinite(bar.close) || bar.close <= 0))) {
      throw new TypeError("alpaca-market-data-payload-invalid");
    }
    const receipt = identified(scrub({
      type: "AlpacaHistoricalBarsObservation",
      version: 1,
      symbols: [...new Set(symbols)].sort(),
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      feed,
      adjustment,
      bars,
      venueRequestId: response.headers?.get?.("x-request-id") ?? null,
      observedAt: now(),
      requestMethod: "GET",
      orderEffect: false,
      secretBytesReturned: false,
    }));
    const book = await recordObservation({
      type: "alpaca-historical-bars-observed",
      value: receipt,
      recordedAt: receipt.observedAt,
    });
    if (!book?.id && !book?.graph && !book?.recordReceipt) {
      throw new TypeError("market-data-independent-book-receipt-required");
    }
    return Object.freeze({ ...receipt, independentBooksReceipt: scrub(book) });
  };
  return Object.freeze({
    originatingActor: "urn:ame:alpaca-market-data-read-service",
    readDailyBars,
  });
}
