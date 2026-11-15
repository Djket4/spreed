/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * ket4tec (NAS_CLOUD#183): ступени возврата после обрыва своего канала (HPB), без действий пользователя.
 * 0 — возобновить ту же сигнальную сессию и перезапустить ICE (остальные ничего не видят);
 * 1 — пересоздать свои соединения в той же сессии;
 * 2 — штатный путь Talk: вход новой сессией (у остальных плитка держится, см. призрак в webrtc.js), дальше раз в 20 с.
 * После каждой ступени ждём K4_WAIT[ступень]: связь вернулась — лестница сброшена, нет — следующая ступень.
 */
export const K4_WAIT = [5000, 6000, 20000]

/**
 * @param {object} p
 * @param {Function} p.up связь есть (сигнальный сокет и свой поток)
 * @param {Function} [p.live] медиа уже идёт (свой поток соединён), даже если сокет ещё нет — ступени не нужны
 * @param {Function} p.run выполнить ступень (номер 0..2, alive) — alive() ложно, если лестницу уже остановили
 * @return {{go: Function, ok: Function, stop: Function, step: Function}}
 */
export function k4Ladder({ up, live = () => false, run }) {
	let step = 0
	let timer = null
	let epoch = 0
	const go = () => {
		if (timer) {
			return false // ступень уже идёт, её проверка решит, нужна ли следующая
		}
		if (live()) {
			step = 0 // связь вернулась сама — живое не рвём (сокет переподключится своим ходом)
			return false
		}
		const s = Math.min(step++, 2)
		timer = setTimeout(() => {
			timer = null
			up() ? (step = 0) : go()
		}, K4_WAIT[s])
		const my = epoch
		run(s, () => my === epoch)
		return true
	}
	const stop = () => {
		clearTimeout(timer)
		timer = null
		step = 0
		epoch++ // отложенные действия ступени (после resume) больше не выполняются
	}
	return {
		go,
		/** связь вернулась раньше проверки */
		ok: () => up() && stop(),
		stop,
		step: () => step,
	}
}

/**
 * Остановить лестницу в самом начале явного выхода из звонка (не при выходе ради переподключения).
 *
 * @param {object} signaling сигналинг (on)
 * @param {{stop: Function}} ladder лестница
 */
export function k4StopOnLeave(signaling, ladder) {
	signaling.on('beforeLeaveCall', (token, reconnect) => {
		if (!reconnect) {
			ladder.stop()
		}
	})
}

/**
 * Связь своего канала действительно восстановлена.
 *
 * @param {object} p
 * @param {boolean} p.connected сигнальный сокет открыт
 * @param {boolean} p.inCall сервер считает нас в звонке (после выхода ради переподключения — нет, пока не войдём снова)
 * @param {boolean} p.need свой поток нужен (MCU и есть кому показывать)
 * @param {boolean} [p.own] свой поток соединён; undefined — потока нет
 * @param {boolean} [p.screen] свой экран соединён; undefined — экран не показываем
 * @param {boolean[]} p.subs входящие потоки: соединён ли каждый
 * @return {boolean}
 */
export function k4Up({ connected, inCall, need, own, screen, subs }) {
	if (!connected || !inCall || screen === false) {
		return false
	}
	if (own !== undefined) {
		return own
	}
	if (need) {
		return false // поток нужен, но ещё не пересоздан
	}
	// только смотрю: сеть моя жива, если жив хоть один входящий поток
	return !subs.length || subs.some(Boolean)
}

/**
 * Держать ли плитку ушедшего участника.
 *
 * @param {object} p
 * @param {boolean} p.gone поток уже стоял / соединение потеряно
 * @param {boolean} p.ghost плитка уже держится
 * @param {boolean} p.inCall мы сами в звонке
 * @param {boolean} p.explicit участник вышел из звонка сам (inCall: 0), а не пропал из комнаты
 * @return {boolean}
 */
export function k4Hold({ gone, ghost, inCall, explicit }) {
	return !!gone && !ghost && !!inCall && !explicit
}

/**
 * Ключ таймера повторного запроса offer: у камеры и экрана одного участника один peer.id.
 *
 * @param {string} id сессия
 * @param {string} type 'video' | 'screen'
 * @return {string}
 */
export function k4OfferKey(id, type) {
	return type === 'screen' ? id + ':screen' : id
}

/**
 * Что делать ступени со своим потоком (камера или экран).
 * «disconnected»/«checking» браузер может вернуть сам, как только вернулась сеть, — такой поток не пересоздаём,
 * иначе второй провал на живом (прогон 15.11: видео вернулось через 0,2 с, пересоздание дало ещё 4–8 с).
 *
 * @param {number} step ступень
 * @param {string} [ice] iceConnectionState
 * @return {'skip'|'restart'|'recreate'}
 */
export function k4OwnAction(step, ice) {
	if (ice === 'connected' || ice === 'completed') {
		return 'skip'
	}
	return step === 1 && (ice === 'failed' || ice === 'closed') ? 'recreate' : 'restart'
}
