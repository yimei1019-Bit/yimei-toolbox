"""
產生手機網頁
------------------------------------------------
1. 跑 daily_report.py：觀察清單健檢分數、走勢、新聞
2. 跑 sectors.py：類股熱度與新聞關鍵字
3. 把資料塞進 site_template.html，輸出成同資料夾的 index.html（GitHub Pages 網址 /stock/）

用法：python build_site.py
"""

import json
import os
import sys
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import daily_report
from sectors import analyze_sectors

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    with open(os.path.join(daily_report.OUT, name), encoding="utf-8") as f:
        return json.load(f)


def main():
    daily_report.main()
    data = {
        "generated": datetime.now(daily_report.TW).strftime("%Y-%m-%d %H:%M"),
        "stocks": load("stocks.json"),
        "news": load("news.json"),
        "ohlc": load("ohlc.json"),
        "yearly": load("yearly.json"),
        "sectors": analyze_sectors(),
    }
    # 避免新聞標題裡的 </script> 之類文字提早結束 script 區塊
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    with open(os.path.join(HERE, "site_template.html"), encoding="utf-8") as f:
        html = f.read().replace("/*DATA*/", payload)
    with open(os.path.join(HERE, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)
    print(f"網頁完成：index.html（{len(html) // 1024} KB）")


if __name__ == "__main__":
    main()
