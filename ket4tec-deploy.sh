#!/bin/bash
# ket4tec: сборка Talk из этого форка и выкладка на NAS (cloud.ket4tec.online).
# Версия форка должна совпадать с установленной (appinfo/info.xml), иначе сначала обновить ветку на новый тег.
# Перед выкладкой: нет активных звонков, копия js/css на NAS. Откат — вернуть копию и сбросить cachebuster.
set -euo pipefail
cd "$(dirname "$0")"
K="$HOME/.ssh/ai_server_ed25519"; H=ANNANAS@192.168.88.121; R=/home/ANNANAS/nextcloud/html/custom_apps/spreed
n() { ssh -i "$K" -o IdentitiesOnly=yes "$H" "$@"; }

live=$(n "grep -m1 -o '<version>[^<]*' $R/appinfo/info.xml" | cut -d'>' -f2)
mine=$(grep -m1 -o '<version>[^<]*' appinfo/info.xml | cut -d'>' -f2)
[ "$live" = "$mine" ] || { echo "на NAS Talk $live, форк $mine — сначала перенести правки на $live"; exit 1; }
calls=$(n '/Volume1/@apps/DockerEngine/dockerd/bin/docker exec nextcloud_db sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -At -c \"select count(*) from oc_talk_rooms where active_since is not null\""')
[ "$calls" = 0 ] || [ "${FORCE:-}" = 1 ] || { echo "идёт звонков: $calls; FORCE=1 чтобы выложить всё равно"; exit 1; }

npm run build
d=$(date +%F-%H%M)
n "cp -a $R/js ~/nextcloud/spreed-js.bak-$d && cp -a $R/css ~/nextcloud/spreed-css.bak-$d"
rsync -rtz --chmod=F644 -e "ssh -i $K -o IdentitiesOnly=yes -o ControlPath=none" js css "$H:$R/"
n 'O="/Volume1/@apps/DockerEngine/dockerd/bin/docker exec -u 33 nextcloud_app php occ"; CB=$($O config:app:get theming cachebuster); $O config:app:set theming cachebuster --value=$((CB+1))'
echo "выложено, копия: ~/nextcloud/spreed-{js,css}.bak-$d"
