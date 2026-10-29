"""
類股熱度分析
------------------------------------------------
把常見類股各挑幾檔代表股，算出平均漲跌，排出最近最熱、最冷的類股，
再抓該類股近 3 天的新聞，統計新聞裡最常提到的原因關鍵字。
"""

import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime

import yfinance as yf

TW = timezone(timedelta(hours=8))

# 類股名稱: (新聞搜尋字, {代號: 名稱})
SECTORS = {
    "紡織": ("紡織股", {"1402": "遠東新", "1476": "儒鴻", "1477": "聚陽", "1434": "福懋", "1409": "新纖", "1440": "南紡", "1447": "力鵬"}),
    "半導體": ("半導體股", {"2330": "台積電", "2454": "聯發科", "2303": "聯電", "3711": "日月光投控", "2379": "瑞昱", "3034": "聯詠"}),
    "AI 伺服器": ("AI伺服器 股", {"2382": "廣達", "3231": "緯創", "6669": "緯穎", "2356": "英業達", "2317": "鴻海", "2376": "技嘉"}),
    "金融": ("金融股", {"2881": "富邦金", "2882": "國泰金", "2891": "中信金", "2886": "兆豐金", "2884": "玉山金", "5880": "合庫金"}),
    "航運": ("航運股", {"2603": "長榮", "2609": "陽明", "2615": "萬海", "2618": "長榮航", "2610": "華航"}),
    "鋼鐵": ("鋼鐵股", {"2002": "中鋼", "2027": "大成鋼", "2014": "中鴻", "2006": "東和鋼鐵"}),
    "塑化": ("塑化股", {"1301": "台塑", "1303": "南亞", "1326": "台化", "6505": "台塑化"}),
    "重電": ("重電股", {"1513": "中興電", "1519": "華城", "1503": "士電", "1504": "東元"}),
    "生技醫療": ("生技股", {"6446": "藥華藥", "6472": "保瑞", "4743": "合一", "1760": "寶齡富錦"}),
    "電信": ("電信股", {"2412": "中華電", "3045": "台灣大", "4904": "遠傳"}),
    "營建": ("營建股", {"2542": "興富發", "2548": "華固", "5522": "遠雄", "2501": "國建"}),
    "高股息 ETF": ("高股息ETF", {"0056": "元大高股息", "00878": "國泰永續高股息", "00919": "群益台灣精選高息", "00929": "復華台灣科技優息"}),
}

# 新聞裡常見的漲跌原因，用來替類股找「最近大家在談什麼」
REASON_WORDS = [
    "營收", "財報", "法說", "EPS", "獲利", "訂單", "接單", "出貨", "漲價", "報價", "庫存", "旺季", "淡季",
    "外資", "投信", "法人", "主力", "融資", "降息", "升息", "Fed", "聯準會", "通膨", "關稅", "川普",
    "匯率", "台幣", "美元", "油價", "運價", "原物料", "輝達", "AI", "擴產", "併購", "除息", "配息",
    "填息", "減產", "需求", "缺貨", "中國", "美國", "越南", "地緣", "政策", "補貼", "颱風", "地震",
]


def fetch_closes(codes):
    """抓一批台股近 3 個月收盤價；上市抓不到的自動改抓上櫃。"""
    closes = {}
    for suffix in (".TW", ".TWO"):
        todo = [c for c in codes if c not in closes]
        if not todo:
            break
        data = yf.download([c + suffix for c in todo], period="3mo", auto_adjust=True,
                           progress=False, group_by="column", threads=True)
        if data is None or data.empty:
            continue
        close = data["Close"]
        for c in todo:
            col = c + suffix
            if col in close and close[col].dropna().shape[0] > 25:
                closes[c] = close[col].dropna()
    return closes


def pct_change(series, days):
    if len(series) <= days:
        return None
    return round(float((series.iloc[-1] / series.iloc[-1 - days] - 1) * 100), 2)


def sector_news(query, limit=6):
    q = urllib.parse.quote(f"{query} when:3d")
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
        rows.append({"title": title, "publisher": source,
                     "published": when.strftime("%Y-%m-%d %H:%M"), "url": it.findtext("link") or ""})
    rows.sort(key=lambda r: r["published"], reverse=True)
    return rows[: limit * 3]  # 多留一些給關鍵字統計，顯示時只取前幾則


def reason_keywords(news, top=5):
    counts = {}
    for n in news:
        for w in REASON_WORDS:
            if w.lower() in n["title"].lower():
                counts[w] = counts.get(w, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    return [{"word": w, "count": c} for w, c in ranked[:top]]


def analyze_sectors():
    all_codes = sorted({c for _, members in SECTORS.values() for c in members})
    closes = fetch_closes(all_codes)
    result = []
    for name, (query, members) in SECTORS.items():
        stocks = []
        for code, sname in members.items():
            s = closes.get(code)
            if s is None:
                continue
            stocks.append({"code": code, "name": sname, "price": round(float(s.iloc[-1]), 2),
                           "chg_1d": pct_change(s, 1), "chg_5d": pct_change(s, 5), "chg_20d": pct_change(s, 20)})
        if not stocks:
            continue
        avg = lambda k: round(sum(x[k] for x in stocks if x[k] is not None) /
                              max(1, sum(1 for x in stocks if x[k] is not None)), 2)
        news = sector_news(query)
        result.append({
            "sector": name,
            "chg_1d": avg("chg_1d"), "chg_5d": avg("chg_5d"), "chg_20d": avg("chg_20d"),
            "up_count": sum(1 for x in stocks if (x["chg_5d"] or 0) > 0),
            "stocks": sorted(stocks, key=lambda x: -(x["chg_5d"] or 0)),
            "keywords": reason_keywords(news),
            "news": news[:6],
        })
        print(f"類股 {name}: 5 日 {result[-1]['chg_5d']:+.2f}%，新聞 {len(news)} 則")
    result.sort(key=lambda r: -r["chg_5d"])
    return result


if __name__ == "__main__":
    import json, sys
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(analyze_sectors()[:2], ensure_ascii=False, indent=1)[:2000])
