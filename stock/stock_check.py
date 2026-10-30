"""
股票健檢小幫手（新手版）
------------------------------------------------
用公開資料替一檔股票做「體檢」，從 5 個面向打分數（滿分 100）：
  1. 趨勢   (25 分) 股價是不是在往上走
  2. 動能   (15 分) 買氣強不強、有沒有過熱
  3. 估值   (20 分) 現在的價格貴不貴
  4. 體質   (25 分) 公司本身會不會賺錢、負債高不高
  5. 風險   (15 分) 股價波動大不大、最近跌最深跌多少

注意：這是「幫你過濾、幫你學習」的工具，不是預測漲跌的水晶球。
任何程式都無法保證股價會漲，分數高只代表「條件比較好」。

用法：
  python stock_check.py 2330
  python stock_check.py 2330 2317 0050      (一次比較多檔)
  python stock_check.py AAPL                 (美股也可以)
"""

import sys
import time
import warnings

warnings.filterwarnings("ignore")

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    import yfinance as yf
    import pandas as pd
except ImportError:
    print("缺少套件，請先執行：pip install yfinance pandas")
    sys.exit(1)

import logging

warnings.filterwarnings("ignore")
logging.getLogger("yfinance").setLevel(logging.CRITICAL)


# ---------- 資料抓取 ----------

def resolve_ticker(code, period="2y", auto_adjust=True):
    """台股只打數字時，自動判斷是上市(.TW)還是上櫃(.TWO)。
    auto_adjust=False 時保留實際成交價（給看盤用），另附 Adj Close 給計分用。"""
    code = code.strip().upper()
    if "." not in code and code[0].isdigit():
        candidates = [f"{code}.TW", f"{code}.TWO"]
    else:
        candidates = [code]
    for attempt in range(3):  # Yahoo 偶爾會暫時擋掉，稍等再試
        for symbol in candidates:
            t = yf.Ticker(symbol)
            try:
                hist = t.history(period=period, auto_adjust=auto_adjust)
            except Exception:
                continue
            if len(hist) > 60:
                return symbol, t, hist
        time.sleep(3 * (attempt + 1))
    return None, None, None


def get_info(ticker):
    try:
        return ticker.info or {}
    except Exception:
        return {}


# ---------- 指標計算 ----------

def rsi(close, n=14):
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + gain / loss)


def macd_hist(close):
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    return macd - signal


def pct(v):
    """yfinance 的比率欄位有時是 0.05、有時是 5，統一成百分比數字。"""
    if v is None:
        return None
    return v * 100 if abs(v) < 1.5 else v


# ---------- 評分 ----------

class Scorecard:
    def __init__(self):
        self.sections = []  # (名稱, 得分, 可得滿分, [說明...])

    def add(self, name, items):
        """items: list of (得分, 滿分, 說明)，滿分為 None 代表資料不足、不計分。"""
        got = sum(i[0] for i in items if i[1] is not None)
        full = sum(i[1] for i in items if i[1] is not None)
        self.sections.append((name, got, full, [i[2] for i in items]))

    @property
    def total(self):
        got = sum(s[1] for s in self.sections)
        full = sum(s[2] for s in self.sections)
        return round(got / full * 100) if full else 0


def evaluate(symbol, hist, info):
    close = (hist["Adj Close"] if "Adj Close" in hist.columns else hist["Close"]).dropna()
    price = close.iloc[-1]
    ma20, ma60 = close.rolling(20).mean().iloc[-1], close.rolling(60).mean().iloc[-1]
    ma200 = close.rolling(200).mean().iloc[-1] if len(close) >= 200 else None
    r = rsi(close).iloc[-1]
    mh = macd_hist(close)

    sc = Scorecard()
    warnings_ = []

    # 1. 趨勢
    items = [
        (5, 5, "✔ 股價在 20 日均線之上（短期偏多）") if price > ma20 else (0, 5, "✘ 股價跌破 20 日均線（短期偏弱）"),
        (8, 8, "✔ 股價在 60 日均線（季線）之上") if price > ma60 else (0, 8, "✘ 股價在季線之下，中期趨勢偏弱"),
        (5, 5, "✔ 20 日線在 60 日線之上（多頭排列）") if ma20 > ma60 else (0, 5, "✘ 20 日線在 60 日線之下（空頭排列）"),
    ]
    if ma200 is not None:
        items.append((7, 7, "✔ 股價在 200 日均線（年線）之上，長期趨勢向上") if price > ma200
                     else (0, 7, "✘ 股價在年線之下，長期趨勢向下"))
    sc.add("趨勢", items)

    # 2. 動能
    if r > 75:
        rsi_item = (2, 8, f"△ RSI={r:.0f}，短線過熱，追高風險大")
        warnings_.append("RSI 過熱：就算公司好，現在進場也容易買在短期高點，可以等拉回")
    elif r >= 40:
        rsi_item = (8, 8, f"✔ RSI={r:.0f}，買氣健康不過熱")
    elif r >= 30:
        rsi_item = (4, 8, f"△ RSI={r:.0f}，買氣偏弱")
    else:
        rsi_item = (3, 8, f"△ RSI={r:.0f}，超賣（跌很多），可能反彈也可能續跌")
    macd_item = ((7, 7, "✔ MACD 柱狀體為正，動能向上") if mh.iloc[-1] > 0
                 else (0, 7, "✘ MACD 柱狀體為負，動能向下"))
    sc.add("動能", [rsi_item, macd_item])

    # 3. 估值
    items = []
    pe = info.get("trailingPE")
    if pe is None and info.get("trailingEps") is not None and info["trailingEps"] <= 0:
        items.append((0, 10, "✘ 公司近四季虧損（EPS ≤ 0）"))
        warnings_.append("公司目前在虧錢，新手建議避開")
    elif pe:
        if pe < 15:
            items.append((10, 10, f"✔ 本益比 {pe:.1f} 倍，價格偏便宜"))
        elif pe < 25:
            items.append((6, 10, f"△ 本益比 {pe:.1f} 倍，價格合理"))
        elif pe < 40:
            items.append((3, 10, f"△ 本益比 {pe:.1f} 倍，價格偏貴"))
        else:
            items.append((0, 10, f"✘ 本益比 {pe:.1f} 倍，非常貴（市場期待很高）"))
    else:
        items.append((0, None, "－ 本益比：無資料（ETF 通常沒有）"))

    pb = info.get("priceToBook")
    if pb:
        if pb < 2:
            items.append((5, 5, f"✔ 股價淨值比 {pb:.1f}，不貴"))
        elif pb < 4:
            items.append((3, 5, f"△ 股價淨值比 {pb:.1f}，中等"))
        else:
            items.append((0, 5, f"✘ 股價淨值比 {pb:.1f}，偏高"))
    else:
        items.append((0, None, "－ 股價淨值比：無資料"))

    # 殖利率用近一年實際配息自己算，比 Yahoo 欄位可靠
    divs = hist["Dividends"].iloc[-250:].sum() if "Dividends" in hist else 0
    dy = divs / price * 100 if divs > 0 else None
    if dy is not None:
        if dy >= 4:
            items.append((5, 5, f"✔ 殖利率 {dy:.1f}%，配息不錯"))
        elif dy >= 2:
            items.append((3, 5, f"△ 殖利率 {dy:.1f}%"))
        else:
            items.append((1, 5, f"△ 殖利率 {dy:.1f}%，偏低"))
    else:
        items.append((0, 5, "✘ 沒有配息紀錄"))
    sc.add("估值", items)

    # 4. 體質
    items = []
    roe = pct(info.get("returnOnEquity"))
    if roe is not None:
        if roe >= 15:
            items.append((8, 8, f"✔ ROE {roe:.1f}%，很會用股東的錢賺錢"))
        elif roe >= 8:
            items.append((4, 8, f"△ ROE {roe:.1f}%，普通"))
        else:
            items.append((0, 8, f"✘ ROE {roe:.1f}%，賺錢效率低"))
    else:
        items.append((0, None, "－ ROE：無資料"))

    margin = pct(info.get("profitMargins"))
    if margin is not None:
        items.append((4, 4, f"✔ 淨利率 {margin:.1f}%，有在賺錢") if margin > 0
                     else (0, 4, f"✘ 淨利率 {margin:.1f}%，虧損中"))
    else:
        items.append((0, None, "－ 淨利率：無資料"))

    de = info.get("debtToEquity")
    if de is not None:
        if de < 50:
            items.append((5, 5, f"✔ 負債權益比 {de:.0f}%，財務穩健"))
        elif de < 100:
            items.append((3, 5, f"△ 負債權益比 {de:.0f}%，中等"))
        else:
            items.append((0, 5, f"✘ 負債權益比 {de:.0f}%，負債偏高"))
    else:
        items.append((0, None, "－ 負債比：無資料（金融股、ETF 常見）"))

    rg = pct(info.get("revenueGrowth"))
    if rg is not None:
        items.append((4, 4, f"✔ 營收年增 {rg:.1f}%") if rg > 0 else (0, 4, f"✘ 營收年減 {rg:.1f}%"))
    else:
        items.append((0, None, "－ 營收成長：無資料"))

    eg = pct(info.get("earningsGrowth"))
    if eg is not None:
        items.append((4, 4, f"✔ 獲利年增 {eg:.1f}%") if eg > 0 else (0, 4, f"✘ 獲利年減 {eg:.1f}%"))
    else:
        items.append((0, None, "－ 獲利成長：無資料"))
    sc.add("體質", items)

    # 5. 風險
    last_year = close.iloc[-250:]
    vol = last_year.pct_change().std() * (252 ** 0.5) * 100
    mdd = ((last_year / last_year.cummax()) - 1).min() * 100
    items = [
        (8, 8, f"✔ 年化波動 {vol:.0f}%，股價算穩") if vol < 25
        else (4, 8, f"△ 年化波動 {vol:.0f}%，起伏中等") if vol < 40
        else (0, 8, f"✘ 年化波動 {vol:.0f}%，股價暴漲暴跌，新手要小心"),
        (7, 7, f"✔ 近一年最深跌幅 {mdd:.0f}%") if mdd > -20
        else (4, 7, f"△ 近一年最深跌幅 {mdd:.0f}%") if mdd > -35
        else (0, 7, f"✘ 近一年最深跌幅 {mdd:.0f}%，曾經大跌"),
    ]
    sc.add("風險", items)
    if vol >= 40:
        warnings_.append("波動很大：買進後一個月內上下 15% 都很正常，資金要分批、金額要小")

    year_ret = (price / last_year.iloc[0] - 1) * 100
    hi52, lo52 = last_year.max(), last_year.min()
    extra = {
        "price": price, "ma20": ma20, "ma60": ma60, "year_ret": year_ret,
        "hi52": hi52, "lo52": lo52,
        "pos52": (price - lo52) / (hi52 - lo52) * 100 if hi52 > lo52 else 50,
        "stop": max(ma60, price * 0.92) if price > ma60 else price * 0.92,
    }
    return sc, warnings_, extra


# ---------- 輸出 ----------

def verdict(score):
    if score >= 75:
        return "★★★ 條件良好", "各方面條件不錯，值得放進觀察清單深入研究。"
    if score >= 60:
        return "★★☆ 條件尚可", "有優點也有缺點，可以小額分批或先觀察。"
    if score >= 45:
        return "★☆☆ 條件普通", "缺點不少，建議先觀望，等趨勢轉好再說。"
    return "☆☆☆ 條件偏弱", "目前條件不理想，新手建議避開。"


def bar(got, full, width=20):
    n = round(got / full * width) if full else 0
    return "█" * n + "░" * (width - n)


def report(code):
    symbol, ticker, hist = resolve_ticker(code)
    if symbol is None:
        print(f"\n找不到「{code}」的資料，請確認股票代號。")
        return None
    info = get_info(ticker)
    name = info.get("longName") or info.get("shortName") or symbol
    sc, warns, x = evaluate(symbol, hist, info)
    score = sc.total
    title, advice = verdict(score)

    line = "=" * 56
    print(f"\n{line}\n {name}（{symbol}）\n{line}")
    print(f" 現價 {x['price']:.2f}   近一年漲跌 {x['year_ret']:+.1f}%")
    print(f" 一年區間 {x['lo52']:.2f} ~ {x['hi52']:.2f}，目前位在區間的 {x['pos52']:.0f}% 位置")
    print(line)
    for name_, got, full, notes in sc.sections:
        if not full:
            print(f"\n【{name_}】 （資料不足，不計分）")
            continue
        print(f"\n【{name_}】 {bar(got, full)} {got}/{full}")
        for n in notes:
            print(f"   {n}")

    print(f"\n{line}\n 總分：{score} / 100   {title}\n {advice}")
    if warns:
        print("\n ⚠ 特別注意：")
        for w in warns:
            print(f"   - {w}")
    print(f"\n 💡 如果決定買，可以參考的停損價：約 {x['stop']:.2f}"
          f"（跌破代表看錯了，認賠出場，避免越賠越多）")
    print(line)
    return name, symbol, score


NEWBIE_TIPS = """
--------------------------------------------------------
 新手小提醒
  1. 分數只是「篩選」，買之前還是要看看公司在做什麼、新聞怎麼說。
  2. 只用「賠光也不影響生活」的閒錢，不要借錢買股票。
  3. 分批買（例如分 3 次），不要一次全部押下去。
  4. 一檔股票不要超過總資金的 20%，或直接買 0050/006208 這類 ETF 分散風險。
  5. 事先決定停損點，跌破就執行，不要「凹單」。
 本程式資料來自 Yahoo Finance，可能有延遲或錯誤，僅供學習參考，不構成投資建議。
--------------------------------------------------------"""


def main():
    codes = sys.argv[1:]
    if not codes:
        raw = input("請輸入股票代號（多檔用空白隔開，例如 2330 2317 0050）：")
        codes = raw.split()
    results = [r for r in (report(c) for c in codes) if r]

    if len(results) > 1:
        print("\n 📊 分數排行")
        for name, symbol, score in sorted(results, key=lambda r: -r[2]):
            print(f"   {score:>3} 分  {symbol:<10} {name}")
    print(NEWBIE_TIPS)


if __name__ == "__main__":
    main()
