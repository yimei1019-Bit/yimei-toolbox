"""設定（或清除）自主檢查表的管理者帳號與密碼。

在 yimei-toolbox 資料夾執行：python tools/set_owner_password.py
輸入密碼時畫面不會顯示；帳號直接按 Enter（空白）＝取消上鎖。
只會把「帳號＋密碼」的 SHA-256 雜湊寫進 js/owner.js，密碼本身不會存在任何檔案裡。
改完後把 js/owner.js 推上 GitHub，再把 sw.js 的 VERSION 改一下，手機才會換成新版。
"""
import getpass
import hashlib
import pathlib

SALT = "yimei-owner:"  # 要和 js/owner-lock.js 的 SALT 一樣
target = pathlib.Path(__file__).resolve().parent.parent / "js" / "owner.js"


def owner_hash(user: str, pw: str) -> str:
    return hashlib.sha256(f"{SALT}{user}:{pw}".encode("utf-8")).hexdigest()


user = input("管理者帳號（空白＝取消上鎖）：").strip()
digest = ""
if user:
    pw = getpass.getpass("管理者密碼（6 個字以上）：")
    if len(pw) < 6:
        raise SystemExit("密碼太短，至少 6 個字")
    if getpass.getpass("再輸入一次：") != pw:
        raise SystemExit("兩次輸入的密碼不一樣，沒有變更")
    digest = owner_hash(user, pw)
target.write_text(
    "// 自主檢查表的管理者帳號（密碼只存 SHA-256 雜湊，不是密碼本身）。由 tools/set_owner_password.py 產生；空白＝不上鎖。\n"
    f"window.OWNER_USER = '{user if digest else ''}';\n"
    f"window.OWNER_HASH = '{digest}';\n",
    encoding="utf-8",
)
print(f"已設定管理者帳號 {user}" if digest else "已取消上鎖")
