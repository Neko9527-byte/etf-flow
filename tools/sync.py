# -*- coding: utf-8 -*-
"""增量更新：抓取原站最新页面 -> 合并历史 -> 重新打包页面。

用法：
  python tools\\sync.py             # 联网抓取并更新
  python tools\\sync.py --check     # 只检查是否有新数据，不写入
  python tools\\sync.py --file x.html  # 用本地 HTML 更新（离线/测试）
"""
import argparse
import datetime
import shutil
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build
import etfdata

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source" / "original.html"
SNAPSHOTS = ROOT / "source" / "snapshots"
LOG = ROOT / "logs" / "sync.log"
URL = "https://etf-flow-d0j.pages.dev/"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def log(msg: str) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    line = f"[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] {msg}"
    print(line)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def fetch(url: str = URL) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=45) as resp:
        raw = resp.read()
    for enc in ("utf-8", "gb18030"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def keep_snapshot(text: str) -> Path:
    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    path = SNAPSHOTS / f"{datetime.date.today():%Y-%m-%d}.html"
    path.write_text(text, encoding="utf-8")
    snaps = sorted(SNAPSHOTS.glob("*.html"))
    for old in snaps[:-60]:
        old.unlink()
    return path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只检查，不写入")
    ap.add_argument("--file", help="使用本地 HTML 文件而不是联网抓取")
    ap.add_argument("--no-snapshot", action="store_true", help="不保存原始页面快照（云端定时任务用）")
    args = ap.parse_args()

    try:
        if args.file:
            text = Path(args.file).read_text(encoding="utf-8")
            log(f"读取本地文件 {args.file}")
        else:
            text = fetch()
            log(f"抓取 {URL} 成功，{len(text)} 字符")
    except Exception as e:  # noqa: BLE001
        log(f"抓取失败：{e}")
        return 1

    try:
        parsed = etfdata.parse_page(text)
    except Exception as e:  # noqa: BLE001
        log(f"解析失败（原站结构可能已变化）：{e}")
        return 2

    old = etfdata.load()
    new_last = parsed["dates"][-1]
    old_last = old["dates"][-1]
    if args.check:
        log(f"本地最新 {old_last}，线上最新 {new_last}")
        return 0 if new_last > old_last else 3

    if new_last < old_last:
        log(f"线上最新日期 {new_last} 早于本地 {old_last}，可能是原站回滚或镜像滞后，已跳过")
        return 4

    merged, logs = etfdata.merge(old, parsed)
    changed = merged["dates"] != old["dates"]
    etfdata.save(merged)
    if not args.no_snapshot:
        keep_snapshot(text)
        shutil.copyfile(ROOT / "source" / "original.html", ROOT / "source" / "original.prev.html")
        SOURCE.write_text(text, encoding="utf-8")
    build.main()

    for line in logs:
        log(line)
    if changed:
        log(f"更新完成：{old_last} -> {merged['dates'][-1]}，共 {merged['meta']['days']} 个交易日")
    else:
        log(f"无新增交易日（最新 {merged['dates'][-1]}），已用最新数据重建页面")
    return 0


if __name__ == "__main__":
    sys.exit(main())
