#!/usr/bin/env bash
# Одноразовый прогон PHPUnit Talk на системном php раннера: сервер Nextcloud (та же ветка, что min-version
# в appinfo/info.xml) клонируется во временную папку, sqlite, приложение копируется в apps/spreed.
# Запуск из корня репозитория. Без секретов, без постоянных контейнеров и данных.
set -euo pipefail
NC=$(grep -o 'nextcloud min-version="[0-9]*"' appinfo/info.xml | grep -o '[0-9]*')
APP=$PWD
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT
php -v | head -1
git clone -q --depth 1 --recurse-submodules --shallow-submodules -b "stable${NC}" https://github.com/nextcloud/server "$W/server"
cd "$W/server"
php occ maintenance:install --database sqlite --admin-user admin --admin-pass admin >/dev/null
cp -a "$APP" apps/spreed
cd apps/spreed
curl -sS https://getcomposer.org/installer | php -- --quiet
php composer.phar install --no-interaction --no-progress -q
php ../../occ app:enable spreed
for f in tests/php/Service/ParticipantServiceEmptyCallTest.php tests/php/BackgroundJob/EndEmptyCallTest.php tests/php/Activity/ListenerTest.php tests/php/Service/ParticipantServiceTest.php tests/php/Service/ParticipantServiceParticipantTypeTest.php; do
	php vendor-bin/phpunit/vendor/bin/phpunit -c tests/php/phpunit.xml "$f"
done
