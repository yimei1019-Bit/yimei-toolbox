"""
每日股票健檢報告
------------------------------------------------
讀取 watchlist.txt 的每一檔股票，重新打分數、算漲跌、抓最新新聞，
輸出成 output/ 資料夾裡的 JSON，給手機看的儀表板使用。
每天的分數也會記在 output/score_history.csv，用來看分數有沒有變。

用法：python daily_report.py
"""

import csv
import json
import os
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone, timedelta

from stock_check import resolve_ticker, get_info, evaluate, verdict

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "output")
TW = timezone(timedelta(hours=8))
SECTION_KEYS = {"趨勢": "trend", "動能": "momentum", "估值": "valuation", "體質": "quality", "風險": "risk"}


def read_watchlist():
    codes = []
    with open(os.path.join(HERE, "watchlist.txt"), encoding="utf-8") as f:
        for line in f:
            code = line.split("#")[0].strip()
            if code:
                codes.append((code, line.split("#")[1].strip() if "#" in line else ""))
    return codes


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
        w.writerows(history)


def main():
    os.makedirs(OUT, exist_ok=True)
    today = datetime.now(TW).strftime("%Y-%m-%d")
    history = [h for h in load_history() if h["date"] != today]

    stocks, news, prices = [], [], []
    for code, note in read_watchlist():
        symbol, ticker, hist = resolve_ticker(code)
        if symbol is None:
            print(f"找不到 {code}，略過")
            continue
        info = get_info(ticker)
        sc, warns, x = evaluate(symbol, hist, info)
        score = sc.total
        title, advice = verdict(score)
        close = hist["Close"]

        prev = [h for h in history if h["code"] == code]
        prev_score = int(prev[-1]["score"]) if prev else None

        row = {
            "code": code,
            "name": note or info.get("shortName") or symbol,
            "price": round(float(x["price"]), 2),
            "chg_1d": round(float((close.iloc[-1] / close.iloc[-2] - 1) * 100), 2),
            "chg_5d": round(float((close.iloc[-1] / close.iloc[-6] - 1) * 100), 2),
            "chg_1y": round(float(x["year_ret"]), 1),
            "score": score,
            "score_change": score - prev_score if prev_score is not None else None,
            "grade": title,
            "advice": advice,
            "warning": "；".join(warns),
            "stop_price": round(float(x["stop"]), 2),
            "last_trade": close.index[-1].strftime("%Y-%m-%d"),
        }
        for name, got, full, _ in sc.sections:
            row[SECTION_KEYS[name]] = round(got / full * 100) if full else None
        stocks.append(row)

        for d, v in close.iloc[-60:].items():
            prices.append({"code": code, "date": d.strftime("%Y-%m-%d"), "close": round(float(v), 2)})
        news.extend(get_news(code, row["name"]))
        history.append({"date": today, "code": code, "score": score, "price": row["price"]})
        print(f"{code} {row['name']}: {score} 分，今日 {row['chg_1d']:+.2f}%")

    stocks.sort(key=lambda r: -r["score"])
    news.sort(key=lambda r: r["published"], reverse=True)
    save_history(history)
    for fname, rows in (("stocks.json", stocks), ("news.json", news), ("prices.json", prices)):
        with open(os.path.join(OUT, fname), "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False)
    print(f"\n完成：{len(stocks)} 檔股票、{len(news)} 則新聞，檔案在 {OUT}")


if __name__ == "__main__":
    main()
