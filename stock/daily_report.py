"""
每日股票健檢報告
------------------------------------------------
對 universe.py 裡的每一檔股票重新打分數、算漲跌、抓最新新聞，輸出：
  output/list.json          所有股票的摘要（網頁清單用）
  output/news.json          所有股票的新聞
  data/<代號>.json          個股頁資料（每日開高低收、歷年高低、分數說明、新聞）
每天的分數也會記在 output/score_history.csv，用來看分數有沒有變。

用法：python daily_report.py
"""

import csv
import json
import math
import os
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone, timedelta

from stock_check import resolve_ticker, get_info, evaluate, verdict
from universe import build_universe

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "output")
DATA = os.path.join(HERE, "data")
TW = timezone(timedelta(hours=8))
SECTION_KEYS = {"趨勢": "trend", "動能": "momentum", "估值": "valuation", "體質": "quality", "風險": "risk"}


def get_news(code, name, limit=4):
    """從 Google 新聞抓近 3 天的中文新聞。"""
    q = urllib.parse.quote(f"{name} {code} when:3d")
    url = f"https://news.google.com/rss/search?q={q}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        root = ET.fromstring(urllib.request.urlopen(req, timeout=15).read())
    except Exception:
        return []
    rows = []
    for it in root.iter("item"):
        source = it.findtext("source") or ""
        title = it.findtext("title") or ""
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3]
        try:
            when = parsedate_to_datetime(it.findtext("pubDate")).astimezone(TW)
        except Exception:
            continue
        rows.append({"code": code, "name": name, "title": title, "publisher": source,
                     "published": when.strftime("%Y-%m-%d %H:%M"), "url": it.findtext("link") or ""})
    rows.sort(key=lambda r: r["published"], reverse=True)
    return rows[:limit]


def daily_bars(hist):
    """每日 [日期, 開, 高, 低, 收, 成交張數]（實際成交價，不含除權息調整）。"""
    bars = []
    for d, r in hist.iterrows():
        if r["Close"] != r["Close"]:  # NaN
            continue
        bars.append([d.strftime("%Y-%m-%d"), round(float(r["Open"]), 2), round(float(r["High"]), 2),
                     round(float(r["Low"]), 2), round(float(r["Close"]), 2), int(r["Volume"] // 1000)])
    return bars


def yearly_range(hist):
    """每一年的最高價、最低價（和發生的日期）以及全年漲跌。"""
    rows = []
    for year, g in hist.groupby(hist.index.year):
        g = g.dropna(subset=["Close"])
        if g.empty:
            continue
        hi_day, lo_day = g["High"].idxmax(), g["Low"].idxmin()
        rows.append({
            "year": int(year),
            "high": round(float(g["High"].max()), 2), "high_date": hi_day.strftime("%m/%d"),
            "low": round(float(g["Low"].min()), 2), "low_date": lo_day.strftime("%m/%d"),
            "open": round(float(g["Open"].iloc[0]), 2), "close": round(float(g["Close"].iloc[-1]), 2),
            "days": len(g),
        })
    return sorted(rows, key=lambda r: -r["year"])


def clean(v):
    """把 NaN、無限大換成 None（JSON 不接受 NaN，上市不到一年的股票常出現）。"""
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    if isinstance(v, dict):
        return {k: clean(x) for k, x in v.items()}
    if isinstance(v, list):
        return [clean(x) for x in v]
    return v


def load_history():
    path = os.path.join(OUT, "score_history.csv")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def save_history(history):
    with open(os.path.join(OUT, "score_history.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["date", "code", "score", "price"])
        w.writeheader()
        w.writerows(history[-20000:])


def analyze(code, meta, history):
    """一檔股票：回傳 (清單摘要, 個股頁資料, 新聞)；抓不到資料回傳 None。"""
    symbol, ticker, hist = resolve_ticker(code, period="5y", auto_adjust=False)
    if symbol is None:
        return None
    info = get_info(ticker)
    sc, warns, x = evaluate(symbol, hist, info)
    score = sc.total
    title, advice = verdict(score)
    close = hist["Close"].dropna()
    name = meta["name"] or info.get("shortName") or symbol

    prev = [h for h in history if h["code"] == code]
    prev_score = int(prev[-1]["score"]) if prev else None

    row = {
        "code": code, "name": name, "sector": meta["sector"], "default": meta["default"],
        "price": round(float(close.iloc[-1]), 2),
        "chg_1d": round(float((close.iloc[-1] / close.iloc[-2] - 1) * 100), 2),
        "chg_5d": round(float((close.iloc[-1] / close.iloc[-6] - 1) * 100), 2),
        "chg_1y": round(float(x["year_ret"]), 1),
        "score": score,
        "score_change": score - prev_score if prev_score is not None else None,
        "grade": title,
        "spark": [round(float(v), 2) for v in close.iloc[-40:]],
    }
    details = []
    for sec, got, full, notes in sc.sections:
        row[SECTION_KEYS[sec]] = round(got / full * 100) if full else None
        details.append({"section": sec, "got": got, "full": full, "notes": notes})

    news = get_news(code, name)
    page = {
        "code": code, "name": name, "last_trade": close.index[-1].strftime("%Y-%m-%d"),
        "advice": advice, "warning": "；".join(warns), "stop_price": round(float(x["stop"]), 2),
        "details": details, "ohlc": daily_bars(hist.iloc[-250:]), "yearly": yearly_range(hist), "news": news,
    }
    return clean(row), clean(page), news


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(DATA, exist_ok=True)
    today = datetime.now(TW).strftime("%Y-%m-%d")
    history = [h for h in load_history() if h["date"] != today]

    rows, all_news = [], []
    universe = build_universe()
    for i, (code, meta) in enumerate(universe.items(), 1):
        try:
            result = analyze(code, meta, history)
        except Exception as e:  # 一檔出錯不要影響其他檔
            print(f"[{i}/{len(universe)}] {code} 失敗：{e}")
            continue
        if result is None:
            print(f"[{i}/{len(universe)}] 找不到 {code}，略過")
            continue
        row, page, news = result
        rows.append(row)
        all_news.extend(news)
        with open(os.path.join(DATA, f"{code}.json"), "w", encoding="utf-8") as f:
            json.dump(page, f, ensure_ascii=False, separators=(",", ":"))
        history.append({"date": today, "code": code, "score": row["score"], "price": row["price"]})
        print(f"[{i}/{len(universe)}] {code} {row['name']}: {row['score']} 分，今日 {row['chg_1d']:+.2f}%")
        time.sleep(0.5)  # 對 Yahoo、Google 客氣一點，避免被擋

    rows.sort(key=lambda r: -r["score"])
    all_news.sort(key=lambda r: r["published"], reverse=True)
    save_history(history)
    for fname, data in (("list.json", rows), ("news.json", all_news)):
        with open(os.path.join(OUT, fname), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\n完成：{len(rows)} 檔股票、{len(all_news)} 則新聞")


if __name__ == "__main__":
    main()
