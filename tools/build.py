# -*- coding: utf-8 -*-
"""把 data/etf_flow.json 打包成可离线打开的页面。

产物：
  dist/data.js              供 dist/index.html 使用
  ETF资金流向_离线版.html     单文件版本（含 ECharts 与全部数据，双击即开）
"""
import datetime
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "etf_flow.json"
DIST = ROOT / "dist"
STANDALONE = ROOT / "ETF资金流向_离线版.html"


def load():
    return json.loads(DATA.read_text(encoding="utf-8"))


def dump_js(data):
    return "window.ETF_DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"


def main():
    data = load()
    data["meta"]["generated_at"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    js = dump_js(data)
    (DIST / "data.js").write_text(js, encoding="utf-8")

    def read_clean(path):
        return path.read_text(encoding="utf-8").lstrip("\ufeff")

    html = read_clean(DIST / "index.html")
    css = read_clean(DIST / "assets" / "style.css")
    app = read_clean(DIST / "assets" / "app.js")
    echarts = read_clean(DIST / "assets" / "echarts.min.js")

    single = html
    single = single.replace('<link rel="stylesheet" href="assets/style.css">', "<style>\n" + css + "\n</style>")
    single = single.replace('<script src="assets/echarts.min.js"></script>', "<script>\n" + echarts + "\n</script>")
    single = single.replace('<script src="data.js"></script>', "<script>\n" + js + "</script>")
    single = single.replace('<script src="assets/app.js"></script>', "<script>\n" + app + "\n</script>")
    if os.environ.get("ETF_NO_STANDALONE") != "1":
        STANDALONE.write_text(single, encoding="utf-8")

    print("data.js       ", (DIST / "data.js").stat().st_size, "bytes")
    if STANDALONE.exists() and os.environ.get("ETF_NO_STANDALONE") != "1":
        print("standalone    ", STANDALONE.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
