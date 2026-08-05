#!/bin/bash
# pi-web-switch dev server 启动脚本（脱离终端运行，避免进程随终端退出）
# 用法: ./scripts/start-dev.sh   或   bash scripts/start-dev.sh
cd "$(dirname "$0")/.."

# 若已在运行则提示
if lsof -ti :5176 >/dev/null 2>&1; then
  echo "dev server 已在运行: http://localhost:5176/ (PID $(lsof -ti :5176 | head -1))"
  exit 0
fi

nohup npm run dev > /tmp/pi-web-dev.log 2>&1 &
disown
sleep 3
if lsof -ti :5176 >/dev/null 2>&1; then
  echo "✅ dev server 已启动: http://localhost:5176/ (日志: /tmp/pi-web-dev.log)"
else
  echo "❌ 启动失败，查看日志: /tmp/pi-web-dev.log"
fi
