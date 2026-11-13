/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ket4tec: статистика звонка для тестового режима (NAS_CLOUD#189).
// ЭТО КОНТРАКТ для интерфейса (вкладка и плитки): форма `k4stats` не меняется, реализация приходит следующим коммитом.
import { reactive } from 'vue'

/**
 * Предупреждение по участнику.
 *
 * @typedef {object} K4Warn
 * @property {'drop'|'loss'|'rtt'|'jit'|'novideo'|'noaudio'|'fps'|'own'} w вид: обрыв, потери, задержка, дрожание звука,
 *   нет видео, нет звука, видео рывками, свой канал (только у 'local')
 * @property {'yellow'|'red'} lvl уровень
 */

/**
 * Последние числа по одному участнику. Нет данных (Safari, ещё не было замера) = `null`, не 0.
 *
 * @typedef {object} K4PeerStats
 * @property {number|null} kbps битрейт, кбит/с: у чужого участника входящий, у 'local' исходящий
 * @property {number|null} loss потери за окно замера, %, 0..100
 * @property {number|null} rtt задержка до сервера/пира, мс (candidate-pair currentRoundTripTime)
 * @property {number|null} jit дрожание входящего звука, мс
 * @property {number|null} fps кадров/с входящего видео
 * @property {'host'|'srflx'|'relay'|'prflx'|null} path тип пары кандидатов; 'relay' = TURN
 * @property {K4Warn[]} warn активные предупреждения (пустой массив = всё хорошо)
 */

/**
 * Единственный реактивный объект. Подписка: `import { k4stats } from '../../utils/k4stats.js'`, читать в
 * computed/template или `watch(() => k4stats.peers[id], ...)`. Писать в него извне нельзя.
 *
 * - `testmode`: true, только если feed ответил 200 (владелец). Иначе интерфейс ничего не показывает.
 * - `peers`: ключ `'local'` (своя исходящая сторона) или id сессии участника в звонке (`CallParticipantModel.attributes.peerId`).
 *   Записи появляются после первого замера и удаляются, когда участник уходит или звонок кончился.
 *   Обновляются раз в 3 с.
 *
 * @type {{ testmode: boolean, peers: Object<string, K4PeerStats> }}
 */
export const k4stats = reactive({
	testmode: false,
	peers: {},
})
