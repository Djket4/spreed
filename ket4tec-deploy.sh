#!/bin/bash
# ket4tec: сборка Talk из этого форка и выкладка на S18 (облако переехало с NAS 05.11.2026).
#   TARGET=test ./ket4tec-deploy.sh   — тестовое облако test2.ket4tec.online (~/talkdraw-test)
#   TARGET=test1 ./ket4tec-deploy.sh  — test1.ket4tec.online (~/nc-spike, SQLite: звонки в БД не проверяются, перед выкладкой полная копия spreed)
#   TARGET=prod ./ket4tec-deploy.sh   — боевое cloud.ket4tec.online, только по слову владельца
# Версия форка должна совпадать с установленной (appinfo/info.xml), иначе сначала перенести ветку на новый тег.
# Перед выкладкой: нет активных звонков, копия js/css/lib/appinfo рядом. Откат — вернуть копию и поднять cachebuster.
# После выкладки пишет custom_apps/spreed/.ket4tec-build (sha256 talk-main.js) — по нему talk-guard (NAS_CLOUD s18/talk-guard)
# узнаёт, что магазин приложений затёр сборку.
# Медиа гифок и стикеров (img/k4stk, ~14 МБ, вне git): нет локально — тянется с NAS (pnr-base/.../talk-media-k7m2x), потом rsync на сервер.
set -euo pipefail
cd "$(dirname "$0")"
case "${TARGET:-}" in
  test) BASE=/home/dev/talkdraw-test; APP=tdtest_app; DB=tdtest_db ;;
  test1) BASE=/home/dev/nc-spike; APP=ncspike_app; DB= ;;
  prod) BASE=/home/dev/nextcloud; APP=nextcloud_app; DB=nextcloud_db ;;
  *) echo "TARGET=test|prod"; exit 1 ;;
esac
H=s18; R=$BASE/html/custom_apps/spreed
n() { ssh "$H" "$@"; }

live=$(n "grep -m1 -o '<version>[^<]*' $R/appinfo/info.xml" | cut -d'>' -f2)
mine=$(grep -m1 -o '<version>[^<]*' appinfo/info.xml | cut -d'>' -f2)
[ "$live" = "$mine" ] || { echo "на $TARGET Talk $live, форк $mine — сначала перенести правки на $live"; exit 1; }
[ -z "$DB" ] && calls=0 || calls=$(n "docker exec $DB sh -c 'psql -U \$POSTGRES_USER -d \$POSTGRES_DB -At -c \"select count(*) from oc_talk_rooms where active_since is not null\"'")
[ "$calls" = 0 ] || [ "${FORCE:-}" = 1 ] || { echo "идёт звонков: $calls; FORCE=1 чтобы выложить всё равно"; exit 1; }

[ -d img/k4stk ] || { mkdir -p img/k4stk && rsync -rt nas:/Volume1/homes/ANNANAS/pnr-base/docs/site/_gdoc/talk-media-k7m2x/ img/k4stk/; }
[ "${NOBUILD:-}" = 1 ] || npm run build
d=$(date +%F-%H%M)
[ -n "$DB" ] || n "sudo -n cp -a $R $BASE/spreed-stock.bak-$d"   # test1: полная копия приложения
n "sudo -n cp -a $R/js $BASE/spreed-js.bak-$d && sudo -n cp -a $R/css $BASE/spreed-css.bak-$d && sudo -n cp -a $R/lib $BASE/spreed-lib.bak-$d && sudo -n cp -a $R/appinfo $BASE/spreed-appinfo.bak-$d && sudo -n cp -a $R/l10n $BASE/spreed-l10n.bak-$d"
rsync -rtz --chmod=F644 --chown=33:33 --rsync-path="sudo -n rsync" js css "$H:$R/"
rsync -rt --chmod=F644,D755 --chown=33:33 --rsync-path="sudo -n rsync" img/k4stk/ "$H:$R/img/k4stk/"   # k4stk: медиа гифок/стикеров
# PHP форка (k4draw, снимок): lib/ и appinfo/; атрибутные маршруты кэшируются — сбросить кэш opcache graceful-ом apache
rsync -rtz --chmod=F644,D755 --chown=33:33 --rsync-path="sudo -n rsync" lib appinfo l10n "$H:$R/"   # l10n: русские строки форка (без неё новые подписи по-английски)
n "docker exec $APP sh -c 'kill -USR1 1'"
sum=$(shasum -a 256 js/talk-main.js | cut -d' ' -f1)
n "printf '%s %s %s\n' '$sum' '$(git rev-parse --short HEAD)' '$d' | sudo -n tee $R/.ket4tec-build >/dev/null"
n "O='docker exec -u 33 $APP php occ'; CB=\$(\$O config:app:get theming cachebuster || echo 0); \$O config:app:set theming cachebuster --value=\$((CB+1)) >/dev/null"
echo "выложено на $TARGET ($(git rev-parse --short HEAD)), копия: $BASE/spreed-{js,css,lib,appinfo}.bak-$d"
