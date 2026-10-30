"""
網頁上可以選來看的股票
------------------------------------------------
= watchlist.txt（預設自選）＋ 各類股代表股 ＋ 下面的常見熱門股。
想讓網頁能選更多股票，就在 EXTRA 加一行「代號: 名稱」。
"""

import os

from sectors import SECTORS

HERE = os.path.dirname(os.path.abspath(__file__))

EXTRA = {
    "006208": "富邦台50", "00713": "元大台灣高息低波", "00940": "元大台灣價值高息",
    "1101": "台泥", "1216": "統一", "1590": "亞德客-KY", "1605": "華新",
    "2059": "川湖", "2207": "和泰車", "2301": "光寶科", "2327": "國巨", "2344": "華邦電",
    "2345": "智邦", "2357": "華碩", "2360": "致茂", "2368": "金像電", "2395": "研華",
    "2408": "南亞科", "2449": "京元電子", "2880": "華南金", "2883": "凱基金", "2885": "元大金",
    "2887": "台新金", "2890": "永豐金", "2892": "第一金", "2912": "統一超", "3008": "大立光",
    "3017": "奇鋐", "3037": "欣興", "3443": "創意", "3533": "嘉澤", "3653": "健策",
    "3661": "世芯-KY", "5871": "中租-KY", "6415": "矽力-KY", "8046": "南電", "9910": "豐泰",
}


def read_watchlist():
    """回傳 [(代號, 名稱)]，名稱取自 # 後面的備註。"""
    codes = []
    with open(os.path.join(HERE, "watchlist.txt"), encoding="utf-8") as f:
        for line in f:
            code = line.split("#")[0].strip()
            if code:
                codes.append((code, line.split("#")[1].strip() if "#" in line else ""))
    return codes


def build_universe():
    """回傳 {代號: {"name", "sector", "default"}}，default=True 代表預設放在自選清單。"""
    uni = {}
    for code, name in read_watchlist():
        uni[code] = {"name": name, "sector": "", "default": True}
    for sector, (_, members) in SECTORS.items():
        for code, name in members.items():
            u = uni.setdefault(code, {"name": name, "sector": "", "default": False})
            u["name"] = u["name"] or name
            u["sector"] = u["sector"] or sector
    for code, name in EXTRA.items():
        uni.setdefault(code, {"name": name, "sector": "", "default": False})
    return uni
