#!/usr/bin/env bash
# Одноразовый прогон PHPUnit Talk в docker (образ nextcloud той же версии, что min-version в appinfo/info.xml).
# Запуск: .github/ket4tec-phpunit.sh (из корня репозитория). Без секретов, контейнер --rm.
set -euo pipefail
NC=$(grep -o 'nextcloud min-version="[0-9]*"' appinfo/info.xml | grep -o '[0-9]*')
docker run --rm -v "$PWD":/src:ro "nextcloud:${NC}" bash -ec '
  apt-get update -qq && apt-get install -y -qq git unzip >/dev/null
  cd /var/www/html
  # в образе нет tests/ сервера (bootstrap, Test\TestCase): берём из той же ветки сервера
  git clone -q --depth 1 --filter=blob:none --sparse -b "stable'"${NC}"'" https://github.com/nextcloud/server /tmp/server
  git -C /tmp/server sparse-checkout set tests >/dev/null
  cp -a /tmp/server/tests ./tests
  php occ maintenance:install --database sqlite --admin-user admin --admin-pass admin >/dev/null
  cp -a /src apps/spreed
  cd apps/spreed
  curl -sS https://getcomposer.org/installer | php -- --quiet
  php composer.phar install --no-interaction --no-progress -q
  cd /var/www/html && php occ app:enable spreed
  cd apps/spreed
  for f in tests/php/Service/ParticipantServiceEmptyCallTest.php tests/php/BackgroundJob/EndEmptyCallTest.php tests/php/Activity/ListenerTest.php tests/php/Service/ParticipantServiceTest.php tests/php/Service/ParticipantServiceParticipantTypeTest.php; do
    php vendor-bin/phpunit/vendor/bin/phpunit -c tests/php/phpunit.xml "$f"
  done
'
