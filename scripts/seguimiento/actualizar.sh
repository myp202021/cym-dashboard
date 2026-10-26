#!/bin/zsh
# CyM — actualización automática del panel (pagado por API Meta + piloto), 26 oct 2026.
# Corre con launchd (~/Library/LaunchAgents/cl.myp.cym-panel.plist) a las 08:00 y 15:00.
# El 1 de cada mes crea la pestaña del mes nuevo y cierra el mes anterior completo.
set -e
cd ~/cym-dashboard
git pull -q --rebase --autostash
MES=$(TZ=America/Santiago date +%Y-%m)
DIA=$(TZ=America/Santiago date +%d)
if [ "$DIA" -le 3 ]; then
  ANT=$(TZ=America/Santiago date -v1d -v-1m +%Y-%m)
  python3 scripts/seguimiento/meta-api.py $ANT
  python3 scripts/seguimiento/build.py $ANT
fi
python3 scripts/seguimiento/meta-api.py $MES
python3 scripts/seguimiento/build.py $MES
git add data/
git diff --cached --quiet || { git commit -qm "Panel CyM: pagado automático $(TZ=America/Santiago date '+%Y-%m-%d %H:%M')"; git push -q; }
echo "OK $(date)"
