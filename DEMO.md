# AETHER Demo 快速上手（只需 Python + numpy/scikit-learn/Pillow/scipy/joblib，无需 fastapi/GPU）

```bash
# 1) 生成数据（一次，约 3 秒）
PYTHONPATH=. python3 data/build_datasets.py
# 2) 一条命令自检（20 个中英文问答 + 6 个分诊预设，应显示 TOTAL 26/26）
python3 -I scripts/demo_selftest.py .
# 3) 启动 demo（浏览器打开 http://127.0.0.1:8000）
python3 scripts/demo_server.py . 8000
```
接口：`POST /ask {"question":"血糖很低怎么办"}` · `POST /triage {"goes_proton_flux_pfu":42.5}` · `POST /early {"history":[...每天一条...]}` · `GET /health`

能回答什么：10 类情况（太阳粒子事件、辐射累积、舱内CO2/灰尘/缺氧、宇航服/锁骨冲击、骨/肌肉流失、睡眠/情绪、低血压/心率、血糖/发烧、视力(SANS)、正常），
返回匹配的 NASA-STD-3001 规程、机组动作、硬件指令、药箱建议；置信度低时会提示问题太模糊。
**不能做：** 开放式医学聊天、诊断、真实临床建议（原型，非医疗器械）。中文仅为关键词映射，不是真正的多语言模型。


## 部署成 API（API Key + 公开链接 + AI 连接）
1. 把 `04_AETHER_Deploy_API.ipynb` 上传到 Google Colab（或 Drive 里双击打开）→ **Runtime → Run all**（CPU 即可，约 5 分钟）。
2. 最后一个单元会打印 **PUBLIC URL** 和 **API KEY**（留空会自动生成强密钥）。
3. 调用：`curl -X POST <URL>/ask -H "X-API-Key: <KEY>" -d '{"question":"CO2 is 4 mmHg"}'`；`<URL>/openapi.json` 给 Postman/AI 代理；`<URL>/tools` 给 Claude/OpenAI 工具定义。
4. **AI 连接链接（MCP）：** `<URL>/k/<KEY>/mcp`（工具：aether_ask / aether_triage / aether_early_warning）。
安全：拿到 URL+Key 的人都能调用；每次运行 URL 会变；停止最后一个单元即关闭；每分钟 60 次限流；请勿输入真实病人数据。
本地同样可用：`AETHER_API_KEY=xxx python3 scripts/demo_server.py . 8000`
