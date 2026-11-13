#!/usr/bin/env bash
# Выборочный прогон PHPUnit Talk на системном php раннера S22 (NAS_CLOUD#129).
# Сервер Nextcloud (ветка stable<min-version из appinfo/info.xml>) клонируется в $RUNNER_TEMP/ket4tec-phpunit,
# sqlite, composer.phar лежит там же. Чистка: шаг workflow `if: always()` (rm -rf этой папки).
# Недостающие php-расширения ставятся из штатного репозитория Ubuntu (идемпотентно, только недостающее).
set -euxo pipefail
NC=$(grep -o 'nextcloud min-version="[0-9]*"' appinfo/info.xml | grep -o '[0-9]*')
APP=$PWD
W="${RUNNER_TEMP:-/tmp}/ket4tec-phpunit"
rm -rf "$W"; mkdir -p "$W"

df -h /; free -m

declare -A PKG=([dom]=xml [SimpleXML]=xml [xmlreader]=xml [xmlwriter]=xml [xml]=xml [mbstring]=mbstring [curl]=curl [pdo_sqlite]=sqlite3 [gd]=gd [zip]=zip [intl]=intl)
MISSING=()
for m in "${!PKG[@]}"; do
	php -m | grep -qix "$m" || MISSING+=("php8.3-${PKG[$m]}")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
	PKGS=$(printf '%s\n' "${MISSING[@]}" | sort -u | tr '\n' ' ')
	# проверка: без веб-сервера и fpm в зависимостях
	if sudo -n apt-get install -s -y --no-install-recommends $PKGS | grep -E '^Inst (apache2|php8.3-fpm|libapache2)'; then
		echo "apt тянет веб-сервер или fpm, останов" >&2; exit 1
	fi
	sudo -n apt-get install -y --no-install-recommends $PKGS
	df -h /; free -m
fi

git clone -q --depth 1 --recurse-submodules --shallow-submodules -b "stable${NC}" https://github.com/nextcloud/server "$W/server"
cd "$W/server"
php occ maintenance:install --database sqlite --admin-user admin --admin-pass admin
cp -a "$APP" apps/spreed
cd apps/spreed

# composer по официальной инструкции getcomposer.org (проверка подписи установщика), локально
EXPECTED=$(curl -sSf https://composer.github.io/installer.sig)
php -r "copy('https://getcomposer.org/installer', '$W/composer-setup.php');"
ACTUAL=$(php -r "echo hash_file('sha384', '$W/composer-setup.php');")
[ "$EXPECTED" = "$ACTUAL" ] || { echo "подпись установщика composer не совпала" >&2; exit 1; }
php "$W/composer-setup.php" --quiet --install-dir="$W"
php "$W/composer.phar" install --no-interaction --no-progress -q
php ../../occ app:enable spreed

for f in tests/php/Service/ParticipantServiceEmptyCallTest.php tests/php/BackgroundJob/EndEmptyCallTest.php tests/php/Service/ParticipantServiceTest.php tests/php/Service/ParticipantServiceParticipantTypeTest.php; do
	php vendor-bin/phpunit/vendor/bin/phpunit -c tests/php/phpunit.xml "$f"
done
df -h /; free -m
