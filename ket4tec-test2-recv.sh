#!/bin/bash
# ket4tec (NAS_CLOUD#139): приёмник автовыкладки на test2. Живёт на S18 в /home/dev/ops/talk-test2-recv.sh.
# В ~/.ssh/authorized_keys ключ раннера S22 привязан к нему: from="192.168.88.60",command="/home/dev/ops/talk-test2-recv.sh",restrict.
# Ключ умеет только одно: принять tar сборки на stdin и разложить в test2 (как TARGET=test ./ket4tec-deploy.sh). Боевое недостижимо.
# SSH_ORIGINAL_COMMAND - короткий sha коммита, только [0-9a-f]. Копии spreed-*.bak-<дата> рядом, как у ручной выкладки.
set -euo pipefail
BASE=/home/dev/talkdraw-test; APP=tdtest_app; R=$BASE/html/custom_apps/spreed
sha=${SSH_ORIGINAL_COMMAND:-}; [[ "$sha" =~ ^[0-9a-f]{7,40}$ ]] || { echo "нужен sha"; exit 2; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
tar -x -C "$T" --no-same-owner --no-same-permissions -f - js css lib appinfo l10n img
live=$(grep -m1 -o '<version>[^<]*' $R/appinfo/info.xml | cut -d'>' -f2); mine=$(grep -m1 -o '<version>[^<]*' "$T/appinfo/info.xml" | cut -d'>' -f2)
[ "$live" = "$mine" ] || { echo "на test2 Talk $live, сборка $mine"; exit 1; }
calls=$(docker exec -u 33 $APP php occ talk:active-calls --output=json | grep -o '"participants": *[0-9]*' | grep -o '[0-9]*$') || true
[ "${calls:-x}" = 0 ] || { echo "на test2 идёт звонок (участников: ${calls:-?}), выкладка пропущена"; exit 3; }
d=$(date +%F-%H%M)
for x in js css lib appinfo l10n; do sudo -n cp -a $R/$x $BASE/spreed-$x.bak-$d; done
for x in js css lib appinfo l10n img; do sudo -n rsync -rt --chmod=F644,D755 --chown=33:33 "$T/$x/" "$R/$x/"; done
docker exec $APP sh -c 'kill -USR1 1'
printf '%s %s %s\n' "$(sha256sum "$T/js/talk-main.js" | cut -d' ' -f1)" "$sha" "$d" | sudo -n tee $R/.ket4tec-build >/dev/null
O="docker exec -u 33 $APP php occ"; CB=$($O config:app:get theming cachebuster || echo 0); $O config:app:set theming cachebuster --value=$((CB+1)) >/dev/null
echo "выложено на test2 ($sha), копия: $BASE/spreed-*.bak-$d"
