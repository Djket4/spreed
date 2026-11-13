#!/usr/bin/env bash
# Выборочный прогон PHPUnit Talk на системном php раннера S22 (NAS_CLOUD#129).
# Сервер Nextcloud (ветка stable<min-version из appinfo/info.xml>) клонируется в $RUNNER_TEMP/ket4tec-phpunit,
# sqlite, composer.phar лежит там же. Чистка: шаг workflow `if: always()` (rm -rf этой папки).
# Недостающие php-расширения ставятся из штатного репозитория Ubuntu (идемпотентно, только недостающее).
set -euxo pipefail
NC=$(grep -o 'nextcloud min-version="[0-9]*"' appinfo/info.xml | grep -o '[0-9]*')
APP=$PWD
# только если PR трогает lib/, tests/php/ или сам прогон (для push без базы запускаем всегда)
if [ -n "${GITHUB_BASE_REF:-}" ]; then
	# HEAD в pull_request — merge-коммит с базой, поэтому двухточечный diff = изменения PR; при ошибке diff прогон НЕ пропускаем
	git fetch -q --depth=1 origin "$GITHUB_BASE_REF" || true
	if CHANGED=$(git diff --name-only "origin/${GITHUB_BASE_REF}" HEAD 2>/dev/null) \
		&& ! grep -qE '^(lib/|tests/php/|\.github/ket4tec-phpunit\.sh|\.github/workflows/ket4tec-ci\.yml)' <<<"$CHANGED"; then
		echo "PR не трогает lib/, tests/php/ и сам прогон: PHPUnit пропущен"
		exit 0
	fi
fi
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
	sudo -n apt-get update -qq
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

RC=0
for f in tests/php/Service/ParticipantServiceEmptyCallTest.php tests/php/BackgroundJob/EndEmptyCallTest.php tests/php/BackgroundJob/RemoveEmptyRoomsTest.php tests/php/Controller/CallControllerEmptyCallTest.php tests/php/Activity/ListenerTest.php tests/php/Chat/SystemMessage/ListenerTest.php tests/php/Service/ParticipantServiceTest.php tests/php/Service/ParticipantServiceParticipantTypeTest.php; do
	php vendor/bin/phpunit -c tests/php/phpunit.xml "$f" || RC=1
done
df -h /; free -m
exit $RC
